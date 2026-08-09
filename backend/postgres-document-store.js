const { Pool } = require('pg');
const crypto = require('crypto');

const OP_KEY = '__aicompareDocumentStoreOperation';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function applyPatch(current, patch, merge) {
  const result = merge ? { ...(current || {}) } : {};
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (value && typeof value === 'object' && value[OP_KEY] === 'increment') {
      result[key] = (Number(result[key]) || 0) + value.amount;
    } else if (value && typeof value === 'object' && value[OP_KEY] === 'serverTimestamp') {
      result[key] = new Date().toISOString();
    } else {
      result[key] = clone(value);
    }
  });
  return result;
}

class Snapshot {
  constructor(path, data) { this.ref = { path }; this.id = path.split('/').pop(); this._data = data; this.exists = data !== null; }
  data() { return this._data === null ? undefined : clone(this._data); }
}

class Query {
  constructor(store, collectionPath, filters = [], order = null, max = null) {
    this.store = store; this.collectionPath = collectionPath; this.filters = filters; this.order = order; this.max = max;
  }
  where(field, op, value) { return new Query(this.store, this.collectionPath, [...this.filters, { field, op, value }], this.order, this.max); }
  orderBy(field, direction = 'asc') { return new Query(this.store, this.collectionPath, this.filters, { field, direction }, this.max); }
  limit(max) { return new Query(this.store, this.collectionPath, this.filters, this.order, max); }
  async get() {
    const rows = await this.store._query('SELECT path, data FROM app_documents WHERE collection_path = $1', [this.collectionPath]);
    let docs = rows.map((row) => new Snapshot(row.path, row.data));
    docs = docs.filter((doc) => this.filters.every(({ field, op, value }) => {
      const actual = doc.data()?.[field];
      if (op === '==') return actual === value;
      if (op === '>=') return actual >= value;
      if (op === '<=') return actual <= value;
      if (op === '>') return actual > value;
      if (op === '<') return actual < value;
      return false;
    }));
    if (this.order) docs.sort((a, b) => {
      const av = a.data()?.[this.order.field]; const bv = b.data()?.[this.order.field];
      const comparison = av === bv ? 0 : av > bv ? 1 : -1;
      return this.order.direction === 'desc' ? -comparison : comparison;
    });
    if (this.max !== null) docs = docs.slice(0, this.max);
    return { docs, empty: docs.length === 0, forEach(callback) { docs.forEach(callback); } };
  }
}

class DocumentReference {
  constructor(store, path) { this.store = store; this.path = path; this.id = path.split('/').pop(); }
  collection(name) { return new CollectionReference(this.store, `${this.path}/${name}`); }
  async get() { const rows = await this.store._query('SELECT data FROM app_documents WHERE path = $1', [this.path]); return new Snapshot(this.path, rows[0]?.data ?? null); }
  async set(data, options = {}) { return this.store._set(this.path, data, Boolean(options.merge)); }
  async update(data) { return this.store._set(this.path, data, true); }
  async delete() { await this.store._query('DELETE FROM app_documents WHERE path = $1 OR path LIKE $2', [this.path, `${this.path}/%`]); }
}

class CollectionReference extends Query {
  constructor(store, collectionPath) { super(store, collectionPath); this.path = collectionPath; }
  doc(id = crypto.randomUUID()) { return new DocumentReference(this.store, `${this.collectionPath}/${id}`); }
  async add(data) { const ref = this.doc(); await ref.set(data); return ref; }
}

class PostgresDocumentStore {
  constructor(connectionString) { this.pool = new Pool({ connectionString, max: 10 }); }
  async initialize() { await this._query('SELECT 1'); }
  async close() { await this.pool.end(); }
  collection(name) { return new CollectionReference(this, name); }
  serverTimestamp() { return { [OP_KEY]: 'serverTimestamp' }; }
  increment(amount) { return { [OP_KEY]: 'increment', amount: Number(amount) || 0 }; }
  timestampFromMillis(value) { return new Date(Number(value)).toISOString(); }
  timestampFromDate(value) { return new Date(value).toISOString(); }
  async _query(sql, params, client = null) { return (await (client || this.pool).query(sql, params)).rows; }
  async _set(path, data, merge, client = null) {
    const existing = await this._query('SELECT data FROM app_documents WHERE path = $1 FOR UPDATE', [path], client);
    const next = applyPatch(existing[0]?.data || {}, data, merge);
    const parts = path.split('/'); const collectionPath = parts.slice(0, -1).join('/');
    await this._query(`INSERT INTO app_documents (path, collection_path, document_id, data) VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`, [path, collectionPath, parts.at(-1), JSON.stringify(next)], client);
  }
  async getAll(...refs) { return Promise.all(refs.map((ref) => ref.get())); }
  batch() { const operations = []; return { set: (ref, data, options) => operations.push(() => ref.set(data, options)), delete: (ref) => operations.push(() => ref.delete()), commit: async () => { for (const operation of operations) await operation(); } }; }
  async runTransaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const transaction = {
        get: async (ref) => { const rows = await this._query('SELECT data FROM app_documents WHERE path = $1 FOR UPDATE', [ref.path], client); return new Snapshot(ref.path, rows[0]?.data ?? null); },
        set: (ref, data, options = {}) => this._set(ref.path, data, Boolean(options.merge), client),
        update: (ref, data) => this._set(ref.path, data, true, client),
        delete: (ref) => this._query('DELETE FROM app_documents WHERE path = $1 OR path LIKE $2', [ref.path, `${ref.path}/%`], client)
      };
      const result = await callback(transaction); await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}

function createDocumentStore(connectionString) {
  if (!connectionString) throw new Error('POSTGRES_URL is not configured');
  return new PostgresDocumentStore(connectionString);
}

module.exports = { createDocumentStore };
