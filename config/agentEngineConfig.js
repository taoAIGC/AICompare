(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AICompareAgentEngineConfig = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const KEY_MASK = 'AICompare::AgentEngine::2026';

  function xorTransform(input, key) {
    const normalizedInput = String(input || '');
    const normalizedKey = String(key || '');
    if (!normalizedInput || !normalizedKey) {
      return normalizedInput;
    }

    let output = '';
    for (let index = 0; index < normalizedInput.length; index += 1) {
      output += String.fromCharCode(
        normalizedInput.charCodeAt(index) ^ normalizedKey.charCodeAt(index % normalizedKey.length)
      );
    }
    return output;
  }

  function encodeBase64(input) {
    if (typeof btoa === 'function') {
      return btoa(input);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(input, 'latin1').toString('base64');
    }
    throw new Error('Base64 encoder is unavailable');
  }

  function decodeBase64(input) {
    if (typeof atob === 'function') {
      return atob(input);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(String(input || ''), 'base64').toString('latin1');
    }
    throw new Error('Base64 decoder is unavailable');
  }

  function encryptApiKey(apiKey) {
    const normalizedApiKey = String(apiKey || '');
    if (!normalizedApiKey) {
      return '';
    }
    return encodeBase64(xorTransform(normalizedApiKey, KEY_MASK));
  }

  function decryptApiKey(cipherText) {
    const normalizedCipherText = String(cipherText || '').trim();
    if (!normalizedCipherText) {
      return '';
    }

    try {
      return xorTransform(decodeBase64(normalizedCipherText), KEY_MASK);
    } catch (_) {
      return '';
    }
  }

  const DEFAULTS = Object.freeze({
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    encryptedApiKey: 'IDsoQglEAxdVCQMiSlJYTHZDUwhfARdYUwYAG3F9JVlaQAURVwkNJ0oAWEVyXQ==',
    model: 'glm-5.1',
    concurrency: 2,
    systemPrompt: ''
  });

  function getDefaults() {
    return {
      ...DEFAULTS,
      apiKey: decryptApiKey(DEFAULTS.encryptedApiKey)
    };
  }

  return {
    DEFAULTS,
    decryptApiKey,
    encryptApiKey,
    getDefaults
  };
});
