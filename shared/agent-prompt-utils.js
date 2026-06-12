(function(root, factory) {
  const api = factory(root);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AICompareAgentPromptUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  function normalizeString(value) {
    return String(value || '').trim();
  }

  function normalizeMultilineString(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
  }

  function isImageMimeType(type = '') {
    return normalizeString(type).startsWith('image/');
  }

  function getAttachmentMediaCategory(_name = '', type = '') {
    return isImageMimeType(type) ? 'image' : 'binary';
  }

  function toUint8Array(value) {
    if (!value) {
      throw new Error('No attachment data provided');
    }

    if (value instanceof Uint8Array) {
      return value;
    }

    if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }

    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }

    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }

    throw new Error('Unsupported binary attachment data');
  }

  async function readSourceAsArrayBuffer(source) {
    if (!source) {
      throw new Error('No attachment source provided');
    }

    if (typeof source.arrayBuffer === 'function') {
      return source.arrayBuffer();
    }

    if (source instanceof ArrayBuffer) {
      return source;
    }

    if (ArrayBuffer.isView(source)) {
      return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    }

    if (source.blob && typeof source.blob.arrayBuffer === 'function') {
      return source.blob.arrayBuffer();
    }

    if (source.data && typeof source.data.arrayBuffer === 'function') {
      return source.data.arrayBuffer();
    }

    if (source.file && typeof source.file.arrayBuffer === 'function') {
      return source.file.arrayBuffer();
    }

    throw new Error('Attachment source does not support arrayBuffer()');
  }

  function bytesToBase64(bytes) {
    const normalizedBytes = toUint8Array(bytes);

    if (typeof Buffer !== 'undefined' && Buffer.from) {
      return Buffer.from(
        normalizedBytes.buffer,
        normalizedBytes.byteOffset,
        normalizedBytes.byteLength
      ).toString('base64');
    }

    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < normalizedBytes.length; index += chunkSize) {
      const chunk = normalizedBytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }

    if (typeof btoa === 'function') {
      return btoa(binary);
    }

    throw new Error('Base64 encoding is not available in this environment');
  }

  async function readSourceAsDataUrl(source, mimeType = '') {
    const arrayBuffer = await readSourceAsArrayBuffer(source);
    const bytes = new Uint8Array(arrayBuffer);
    const normalizedMimeType = normalizeString(mimeType) || 'application/octet-stream';
    return `data:${normalizedMimeType};base64,${bytesToBase64(bytes)}`;
  }

  async function buildAttachmentPayloadFromSource(source, options = {}) {
    const normalizedSource = source && typeof source === 'object'
      ? source
      : {};
    const attachmentName = normalizeString(
      options.name ||
      normalizedSource.name ||
      normalizedSource.fileName ||
      normalizedSource.originalName
    );
    if (!attachmentName) {
      return null;
    }

    const attachmentType = normalizeString(options.type || normalizedSource.type);
    const attachmentSize = Math.max(0, Number(options.size ?? normalizedSource.size) || 0);
    return normalizeAttachment({
      id: String(options.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      name: attachmentName,
      type: attachmentType,
      size: attachmentSize,
      mediaCategory: getAttachmentMediaCategory(attachmentName, attachmentType)
    });
  }

  function resolveBundledAgentEngineDefaults() {
    const bundledConfig = root?.AICompareAgentEngineConfig;
    if (bundledConfig && typeof bundledConfig.getDefaults === 'function') {
      return bundledConfig.getDefaults();
    }

    if (typeof module !== 'undefined' && module.exports) {
      try {
        const nodeConfig = require('../config/agentEngineConfig.js');
        if (nodeConfig && typeof nodeConfig.getDefaults === 'function') {
          return nodeConfig.getDefaults();
        }
      } catch (_) {
        // Ignore missing config in non-browser environments.
      }
    }

    return {
      baseUrl: '',
      apiKey: '',
      model: '',
      concurrency: 10,
      systemPrompt: ''
    };
  }

  const AGENT_ENGINE_DEFAULTS = resolveBundledAgentEngineDefaults();
  const DEFAULT_MODEL = normalizeString(AGENT_ENGINE_DEFAULTS.model);
  const DEFAULT_BASE_URL = normalizeString(AGENT_ENGINE_DEFAULTS.baseUrl).replace(/\/+$/, '');
  const DEFAULT_API_KEY = normalizeString(AGENT_ENGINE_DEFAULTS.apiKey);
  const DEFAULT_CONCURRENCY = Math.max(1, Number(AGENT_ENGINE_DEFAULTS.concurrency) || 10);
  const DEFAULT_SYSTEM_PROMPT = normalizeMultilineString(AGENT_ENGINE_DEFAULTS.systemPrompt);
  const LEGACY_AUTO_MIGRATED_MODEL = 'glm-5.1';
  const LEGACY_AUTO_MIGRATED_BASE_URL = 'https://ark.cn-beijing.volces.com/api/coding/v3';
  const AGENT_ENGINE_SOURCE_OFFICIAL = 'official';
  const AGENT_ENGINE_SOURCE_CUSTOM = 'custom';

  function migrateLegacyApiConfig(config = {}) {
    return config && typeof config === 'object'
      ? { ...config }
      : {};
  }

  function buildSystemPrompt(agent, engineConfig = {}) {
    const personaPrompt = normalizeMultilineString(agent?.personaPrompt);
    const languageRule = [
      '[Language rule / 语言规则]',
      '- Respond in the same language as the user\'s latest message unless the user explicitly asks for another language.',
      '- Do not default to English just because the persona prompt is written in English.',
      '- 如果用户使用中文提问，默认使用中文回答；只有在用户明确要求英文或其他语言时才切换。',
      '- Keep proper nouns, product names, and direct quotes in their original form when useful, but keep the main answer in the user\'s language.'
    ].join('\n');

    return [personaPrompt, languageRule].filter(Boolean).join('\n\n').trim();
  }

  function normalizeAttachment(attachment = {}) {
    if (!attachment || typeof attachment !== 'object') {
      return null;
    }

    const name = normalizeString(attachment.name || attachment.fileName);
    if (!name) {
      return null;
    }

    return {
      id: normalizeString(attachment.id),
      name,
      type: normalizeString(attachment.type),
      size: Math.max(0, Number(attachment.size) || 0),
      dataUrl: typeof attachment.dataUrl === 'string' ? attachment.dataUrl : '',
      textContent: typeof attachment.textContent === 'string' ? attachment.textContent : '',
      textPreview: typeof attachment.textPreview === 'string' ? attachment.textPreview : '',
      fileId: normalizeString(attachment.fileId),
      uploadMode: normalizeString(attachment.uploadMode),
      mediaCategory: normalizeString(attachment.mediaCategory),
      extractedAsText: attachment.extractedAsText === true
    };
  }

  function normalizeAttachments(attachments = []) {
    if (!Array.isArray(attachments)) {
      return [];
    }
    return attachments.map((attachment) => normalizeAttachment(attachment)).filter(Boolean);
  }

  function buildAttachmentTextBlock(attachments = []) {
    const normalizedAttachments = normalizeAttachments(attachments);
    if (!normalizedAttachments.length) {
      return '';
    }

    const blocks = normalizedAttachments.map((attachment, index) => {
      const lines = [
        `[Attachment ${index + 1}]`,
        `Name: ${attachment.name}`
      ];
      if (attachment.type) {
        lines.push(`Type: ${attachment.type}`);
      }
      if (attachment.size > 0) {
        lines.push(`Size: ${attachment.size} bytes`);
      }
      if (attachment.mediaCategory === 'image') {
        lines.push('Raw image attached.');
      } else {
        lines.push('Raw file attached.');
      }
      return lines.join('\n');
    });

    return `User attached the following files:\n\n${blocks.join('\n\n')}`;
  }

  function buildMessageContent(message = {}, options = {}) {
    const content = normalizeString(message?.content);
    const attachments = normalizeAttachments(message?.attachments);
    const attachmentTextBlock = buildAttachmentTextBlock(attachments);
    const allowMultimodal = options?.allowMultimodal !== false;
    const hasImages = attachments.some((attachment) => {
      return attachment.mediaCategory === 'image' && attachment.dataUrl;
    });

    if (!attachments.length) {
      return content;
    }

    const textParts = [];
    if (content) {
      textParts.push(content);
    }
    if (attachmentTextBlock) {
      textParts.push(attachmentTextBlock);
    }
    const combinedText = textParts.join('\n\n').trim();

    if (!hasImages || !allowMultimodal) {
      return combinedText;
    }

    const multimodalParts = [];
    if (combinedText) {
      multimodalParts.push({
        type: 'text',
        text: combinedText
      });
    }

    attachments.forEach((attachment) => {
      if (attachment.mediaCategory === 'image' && attachment.dataUrl) {
        multimodalParts.push({
          type: 'image_url',
          image_url: {
            url: attachment.dataUrl
          }
        });
      }
    });

    return multimodalParts;
  }

  function normalizeApiConfig(config = {}, options = {}) {
    const migratedConfig = migrateLegacyApiConfig(config);
    const useBundledDefaults = options?.useBundledDefaults !== false;
    const defaultApiKey = useBundledDefaults ? DEFAULT_API_KEY : '';
    const defaultBaseUrl = useBundledDefaults ? DEFAULT_BASE_URL : '';
    const defaultModel = useBundledDefaults ? DEFAULT_MODEL : '';
    const defaultConcurrency = useBundledDefaults ? DEFAULT_CONCURRENCY : 2;
    const defaultSystemPrompt = useBundledDefaults ? DEFAULT_SYSTEM_PROMPT : '';
    const apiKey = normalizeString(migratedConfig.apiKey) || defaultApiKey;
    let baseUrl = normalizeString(migratedConfig.baseUrl).replace(/\/+$/, '') || defaultBaseUrl;
    let model = normalizeString(migratedConfig.model) || defaultModel;
    const concurrency = Math.max(1, Number(migratedConfig.concurrency) || defaultConcurrency);
    const systemPrompt = normalizeMultilineString(migratedConfig.systemPrompt) || defaultSystemPrompt;

    // Older builds forcibly rewrote the pptoken defaults to Ark defaults.
    // If the saved key is still an `sk-*` style key, restore the expected
    // pptoken-compatible defaults automatically.
    if (
      apiKey.startsWith('sk-') &&
      baseUrl === LEGACY_AUTO_MIGRATED_BASE_URL &&
      model === LEGACY_AUTO_MIGRATED_MODEL
    ) {
      baseUrl = DEFAULT_BASE_URL;
      model = DEFAULT_MODEL;
    }

    return {
      apiKey,
      baseUrl,
      model,
      concurrency,
      systemPrompt
    };
  }

  function isApiConfigConfigured(config = {}) {
    return Boolean(
      normalizeString(config.apiKey) &&
      normalizeString(config.baseUrl) &&
      normalizeString(config.model) &&
      Math.max(1, Number(config.concurrency) || 0) >= 1
    );
  }

  function areApiConfigsEquivalent(leftConfig = {}, rightConfig = {}) {
    const left = normalizeApiConfig(leftConfig, { useBundledDefaults: false });
    const right = normalizeApiConfig(rightConfig, { useBundledDefaults: false });

    return (
      left.apiKey === right.apiKey &&
      left.baseUrl === right.baseUrl &&
      left.model === right.model &&
      left.concurrency === right.concurrency &&
      left.systemPrompt === right.systemPrompt
    );
  }

  function getEmptyCustomApiConfig() {
    return normalizeApiConfig({}, { useBundledDefaults: false });
  }

  function normalizeAgentEngineSecret(secret = {}) {
    if (typeof secret === 'string') {
      const normalizedSecret = normalizeString(secret);
      return {
        apiKey: normalizedSecret,
        customApiKey: normalizedSecret
      };
    }

    const normalizedSecret = secret && typeof secret === 'object'
      ? secret
      : {};
    const apiKey = normalizeString(normalizedSecret.apiKey);
    const customApiKey = normalizeString(normalizedSecret.customApiKey) || apiKey;

    return {
      apiKey,
      customApiKey
    };
  }

  function resolveAgentEngineSettings(syncConfig = {}, localSecret = {}) {
    const normalizedSyncConfig = syncConfig && typeof syncConfig === 'object'
      ? syncConfig
      : {};
    const normalizedLocalSecret = normalizeAgentEngineSecret(localSecret);
    const officialConfig = normalizeApiConfig({}, { useBundledDefaults: true });
    const hasStructuredSettings = (
      Object.prototype.hasOwnProperty.call(normalizedSyncConfig, 'selectedSource') ||
      Object.prototype.hasOwnProperty.call(normalizedSyncConfig, 'customConfig')
    );

    if (hasStructuredSettings) {
      const customRawConfig = normalizedSyncConfig.customConfig && typeof normalizedSyncConfig.customConfig === 'object'
        ? normalizedSyncConfig.customConfig
        : {};
      const customConfig = normalizeApiConfig({
        ...customRawConfig,
        apiKey: normalizedLocalSecret.customApiKey || normalizedLocalSecret.apiKey || ''
      }, { useBundledDefaults: false });
      const selectedSource = normalizedSyncConfig.selectedSource === AGENT_ENGINE_SOURCE_CUSTOM
        ? AGENT_ENGINE_SOURCE_CUSTOM
        : AGENT_ENGINE_SOURCE_OFFICIAL;

      return {
        selectedSource,
        officialConfig,
        customConfig,
        effectiveConfig: selectedSource === AGENT_ENGINE_SOURCE_CUSTOM ? customConfig : officialConfig
      };
    }

    const legacyCustomConfig = normalizeApiConfig({
      ...normalizedSyncConfig,
      apiKey: normalizedLocalSecret.apiKey || ''
    }, { useBundledDefaults: false });
    const shouldUseLegacyCustomConfig = (
      isApiConfigConfigured(legacyCustomConfig) &&
      !areApiConfigsEquivalent(legacyCustomConfig, officialConfig)
    );
    const selectedSource = shouldUseLegacyCustomConfig
      ? AGENT_ENGINE_SOURCE_CUSTOM
      : AGENT_ENGINE_SOURCE_OFFICIAL;
    const customConfig = shouldUseLegacyCustomConfig
      ? legacyCustomConfig
      : getEmptyCustomApiConfig();

    return {
      selectedSource,
      officialConfig,
      customConfig,
      effectiveConfig: selectedSource === AGENT_ENGINE_SOURCE_CUSTOM ? customConfig : officialConfig
    };
  }

  function buildChatMessages(agent, threadMessages = [], engineConfig = {}, options = {}) {
    const normalizedThreadMessages = Array.isArray(threadMessages) ? threadMessages : [];
    const systemPrompt = buildSystemPrompt(agent, engineConfig);
    const messages = [{ role: 'system', content: systemPrompt }];

    normalizedThreadMessages.forEach((message) => {
      const role = normalizeString(message?.role) || 'user';
      const content = buildMessageContent(message, options);
      if (!content) {
        return;
      }

      if (role === 'assistant' || role === 'user' || role === 'system') {
        messages.push({
          role,
          content
        });
      }
    });

    return messages;
  }

  return {
    DEFAULT_BASE_URL,
    DEFAULT_API_KEY,
    DEFAULT_MODEL,
    DEFAULT_CONCURRENCY,
    AGENT_ENGINE_SOURCE_OFFICIAL,
    AGENT_ENGINE_SOURCE_CUSTOM,
    areApiConfigsEquivalent,
    buildAttachmentPayloadFromSource,
    buildChatMessages,
    buildSystemPrompt,
    buildMessageContent,
    getEmptyCustomApiConfig,
    getAttachmentMediaCategory,
    isApiConfigConfigured,
    isImageMimeType,
    migrateLegacyApiConfig,
    normalizeApiConfig,
    normalizeAgentEngineSecret,
    normalizeAttachment,
    normalizeAttachments,
    readSourceAsDataUrl,
    resolveAgentEngineSettings
  };
});
