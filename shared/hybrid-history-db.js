(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AICompareHybridHistoryDB = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const DB_NAME = 'ai_compare_hybrid_history';
  const DB_VERSION = 1;
  const SESSION_STORE = 'compare_sessions';

  function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function normalizeSessionRecord(record = {}) {
    const isFavorite = record.isFavorite === true;
    return {
      id: String(record.id || '').trim(),
      mode: String(record.mode || 'hybrid').trim() || 'hybrid',
      query: String(record.query || '').trim(),
      createdAt: Number(record.createdAt) || Date.now(),
      updatedAt: Number(record.updatedAt) || Date.now(),
      isFavorite,
      favoriteFolder: isFavorite
        ? (String(record.favoriteFolder || '').trim() || 'default')
        : '',
      panelOrder: Array.isArray(record.panelOrder) ? cloneJson(record.panelOrder) : [],
      openSiteNames: Array.isArray(record.openSiteNames) ? cloneJson(record.openSiteNames) : [],
      openAgentIds: Array.isArray(record.openAgentIds) ? cloneJson(record.openAgentIds) : [],
      panels: cloneJson(record.panels || {}),
      timelineEntries: Array.isArray(record.timelineEntries) ? cloneJson(record.timelineEntries) : [],
      summary: cloneJson(record.summary || {})
    };
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('indexedDB is not available'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SESSION_STORE)) {
          const sessionStore = db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
          sessionStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          sessionStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function runStore(storeName, mode, executor) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let settled = false;

      transaction.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve(undefined);
        }
        db.close();
      };

      transaction.onerror = () => {
        if (!settled) {
          settled = true;
          reject(transaction.error || new Error('IndexedDB transaction failed'));
        }
        db.close();
      };

      transaction.onabort = () => {
        if (!settled) {
          settled = true;
          reject(transaction.error || new Error('IndexedDB transaction aborted'));
        }
        db.close();
      };

      Promise.resolve(executor(store, transaction))
        .then((result) => {
          if (!settled) {
            settled = true;
            resolve(result);
          }
        })
        .catch((error) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
          try {
            transaction.abort();
          } catch (_) {}
        });
    });
  }

  async function saveSession(record) {
    const normalized = normalizeSessionRecord(record);
    if (!normalized.id) {
      throw new Error('Session id is required');
    }

    await runStore(SESSION_STORE, 'readwrite', (store) => {
      store.put(normalized);
    });
    return cloneJson(normalized);
  }

  async function getSession(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) return null;

    return runStore(SESSION_STORE, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onerror = () => reject(request.error || new Error('Failed to read session'));
        request.onsuccess = () => resolve(cloneJson(request.result || null));
      });
    });
  }

  async function deleteSession(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) return false;

    await runStore(SESSION_STORE, 'readwrite', (store) => {
      store.delete(id);
    });
    return true;
  }

  async function clearAllSessions() {
    await runStore(SESSION_STORE, 'readwrite', (store) => {
      store.clear();
    });
  }

  async function listSessions(options = {}) {
    const limit = Math.max(1, Number(options.limit) || 200);
    const sessions = await runStore(SESSION_STORE, 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const index = store.index('updatedAt');
        const request = index.getAll();
        request.onerror = () => reject(request.error || new Error('Failed to list sessions'));
        request.onsuccess = () => resolve(cloneJson(request.result || []));
      });
    });

    return sessions
      .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
      .slice(0, limit);
  }

  return {
    DB_NAME,
    DB_VERSION,
    SESSION_STORE,
    clearAllSessions,
    deleteSession,
    getSession,
    listSessions,
    normalizeSessionRecord,
    openDatabase,
    saveSession
  };
});
