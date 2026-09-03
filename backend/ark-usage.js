const crypto = require('crypto');

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest(encoding);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function toUtcDateParts(date = new Date()) {
  const compact = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return { date: compact.slice(0, 8), timestamp: compact };
}

function getBeijingDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function buildAuthorization({ accessKeyId, secretAccessKey, region, service, host, action = 'GetInferenceUsage', payload, now = new Date() }) {
  const { date, timestamp } = toUtcDateParts(now);
  const payloadHash = sha256(payload);
  const canonicalQuery = `Action=${encodeURIComponent(action)}&Version=2024-01-01`;
  const canonicalHeaders = [
    'content-type:application/json; charset=UTF-8',
    `host:${host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${timestamp}`
  ].join('\n') + '\n';
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalRequest = ['POST', '/', canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${date}/${region}/${service}/request`;
  const stringToSign = ['HMAC-SHA256', timestamp, credentialScope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(secretAccessKey, date), region), service), 'request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  return {
    url: `https://${host}/?${canonicalQuery}`,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      Host: host,
      'X-Date': timestamp,
      'X-Content-Sha256': payloadHash,
      Authorization: `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    }
  };
}

function parseUsageRows(result = {}) {
  const fields = Array.isArray(result.Fields) ? result.Fields.map((field) => field?.Name || '') : [];
  const data = Array.isArray(result.Data) ? result.Data : [];
  return data.map((row) => {
    if (row && typeof row === 'object' && !Array.isArray(row)) return row;
    const values = Array.isArray(row) ? row : (typeof row === 'string' ? row.split(',') : []);
    return fields.reduce((record, field, index) => {
      record[field] = values[index];
      return record;
    }, {});
  });
}

function getNumber(row, candidates) {
  for (const candidate of candidates) {
    const value = Number(row[candidate]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function summarizeUsageByEndpoint(result = {}) {
  return parseUsageRows(result).reduce((summary, row) => {
    const endpoint = String(row.ModelEndpoint || row.EndpointId || row.EndpointID || '').trim();
    if (!endpoint) return summary;
    const inputTokens = getNumber(row, ['InputTokens', 'PromptTokens', 'input_tokens', 'prompt_tokens']);
    const outputTokens = getNumber(row, ['OutputTokens', 'CompletionTokens', 'output_tokens', 'completion_tokens']);
    const totalTokens = getNumber(row, ['TotalTokens', 'total_tokens']) || inputTokens + outputTokens;
    const current = summary[endpoint] || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    current.inputTokens += inputTokens;
    current.outputTokens += outputTokens;
    current.totalTokens += totalTokens;
    summary[endpoint] = current;
    return summary;
  }, {});
}

function summarizeActivationQuota(activation = {}) {
  const initial = activation.InitialInferenceFreeUsage || {};
  const initialTotal = Math.max(0, Number(initial.Total) || 0);
  const initialConsumed = Math.max(0, Number(initial.Consumed) || 0);
  const packs = Array.isArray(activation.FreeResourcePackItems) ? activation.FreeResourcePackItems : [];
  const resourcePacks = packs.map((pack) => {
    const total = Math.max(0, Number(pack?.Total) || 0);
    const consumed = Math.max(0, Number(pack?.Consumed) || 0);
    const reclaimed = Math.max(0, Number(pack?.Reclaimed) || 0);
    return {
      type: String(pack?.Type || 'Unknown'), total, consumed, reclaimed,
      remaining: Math.max(0, total - consumed - reclaimed)
    };
  });
  const total = initialTotal + resourcePacks.reduce((sum, pack) => sum + pack.total, 0);
  const consumed = initialConsumed + resourcePacks.reduce((sum, pack) => sum + pack.consumed, 0);
  const reclaimed = resourcePacks.reduce((sum, pack) => sum + pack.reclaimed, 0);
  return { total, consumed, reclaimed, remaining: Math.max(0, total - consumed - reclaimed), resourcePacks };
}

function createArkUsageClient(options = {}) {
  const accessKeyId = String(options.accessKeyId || '').trim();
  const secretAccessKey = String(options.secretAccessKey || '').trim();
  const region = String(options.region || 'cn-beijing').trim();
  const service = String(options.service || 'ark').trim();
  const host = String(options.host || 'open.volcengineapi.com').trim();
  const projectName = String(options.projectName || 'default').trim();
  const fetchImpl = options.fetchImpl || fetch;

  async function request(action, payloadObject, requestHost = host) {
    if (!accessKeyId || !secretAccessKey) throw new Error('Ark usage query credentials are not configured');
    const payload = JSON.stringify(payloadObject);
    const signed = buildAuthorization({ accessKeyId, secretAccessKey, region, service, host: requestHost, action, payload });
    const response = await fetchImpl(signed.url, { method: 'POST', headers: signed.headers, body: payload });
    const body = await response.text();
    let parsed = {};
    try { parsed = JSON.parse(body); } catch (_) {}
    if (!response.ok) throw new Error(parsed?.ResponseMetadata?.Error?.Message || `Ark ${action} failed: HTTP ${response.status}`);
    return parsed?.Result || {};
  }

  return {
    enabled: Boolean(accessKeyId && secretAccessKey),
    async getTodayUsage(endpointIds = [], now = new Date()) {
      const date = getBeijingDate(now);
      const result = await request('GetInferenceUsage', {
        QueryInterval: 'Day',
        StartTime: date,
        EndTime: date,
        ProjectName: projectName,
        ...(endpointIds.length ? { Filters: [{ Key: 'ModelEndpoint', Values: endpointIds }] } : {})
      });
      return summarizeUsageByEndpoint(result);
    },
    async listPresetModelEndpoints() {
      const result = await request('InnerDescribeModelEndpoints', {}, `ark.${region}.volcengineapi.com`);
      return result.ModelEndpoints || result.Endpoints || result.Items || [];
    },
    async listModelActivations() {
      const result = await request('ListModelActivations', {
        WithFreeUsage: true,
        PageNumber: 1,
        PageSize: 100,
        SortOrder: 'Desc'
      }, `ark.${region}.volcengineapi.com`);
      return result;
    }
  };
}

module.exports = { buildAuthorization, getBeijingDate, parseUsageRows, summarizeUsageByEndpoint, summarizeActivationQuota, createArkUsageClient };
