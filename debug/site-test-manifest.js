const SITE_CHECKS = [
  {
    id: 'claude',
    siteName: 'Claude',
    mode: 'extension_url',
    label: 'Claude extension end-to-end verifier',
    groups: ['core', 'full']
  },
  {
    id: 'chatgpt',
    siteName: 'ChatGPT',
    mode: 'extension_url',
    label: 'ChatGPT extension end-to-end verifier',
    groups: ['core', 'full']
  },
  {
    id: 'gemini',
    siteName: 'Gemini',
    mode: 'extension_url',
    label: 'Gemini extension end-to-end verifier',
    groups: ['core', 'full']
  },
  {
    id: 'grok',
    siteName: 'Grok',
    mode: 'extension_url',
    label: 'Grok extension end-to-end verifier',
    groups: ['core', 'full']
  },
  {
    id: 'minimax',
    siteName: 'MiniMax',
    mode: 'extension_url',
    label: 'MiniMax extension end-to-end verifier',
    groups: ['core', 'full']
  },
  {
    id: 'manus',
    siteName: 'Manus',
    mode: 'extension_url',
    label: 'Manus extension end-to-end verifier',
    groups: ['core', 'full']
  },
  {
    id: 'deepseek',
    siteName: 'DeepSeek',
    mode: 'extension_url',
    label: 'DeepSeek extension end-to-end verifier',
    groups: ['core', 'full']
  },
  {
    id: 'dots-ai',
    siteName: '点点',
    mode: 'extension_url',
    label: 'dots.ai extension end-to-end verifier',
    groups: ['core', 'full']
  },
  {
    id: 'nano-banana-live',
    siteName: 'Nano Banana',
    mode: 'extension_url',
    label: 'Nano Banana extension end-to-end verifier',
    groups: ['core', 'full']
  },
  {
    id: 'ai-studio',
    siteName: 'AI Studio',
    mode: 'extension_url',
    label: 'AI Studio extension end-to-end verifier',
    groups: ['full']
  },
  {
    id: 'doubao',
    siteName: '豆包',
    mode: 'extension_url',
    label: 'Doubao extension end-to-end verifier',
    groups: ['full']
  },
  {
    id: 'yuanbao',
    siteName: '元宝',
    mode: 'extension_url',
    label: 'Yuanbao extension end-to-end verifier',
    groups: ['full']
  },
  {
    id: 'kimi',
    siteName: 'Kimi',
    mode: 'extension_url',
    label: 'Kimi extension end-to-end verifier',
    groups: ['full']
  },
  {
    id: 'qianwen',
    siteName: '千问',
    mode: 'extension_url',
    label: 'Qianwen extension end-to-end verifier',
    groups: ['full']
  },
  {
    id: 'qwen',
    siteName: 'Qwen',
    mode: 'extension_url',
    label: 'Qwen extension end-to-end verifier',
    groups: ['full']
  },
  {
    id: 'metaso',
    siteName: '秘塔',
    mode: 'extension_url',
    label: 'Metaso extension end-to-end verifier',
    groups: ['full']
  }
];

const EXTRA_CHECKS = [
  {
    id: 'static-config',
    kind: 'static',
    label: 'siteHandlers schema and verifier drift',
    script: 'debug/validate-site-configs.js',
    groups: ['core', 'full'],
    siteNames: []
  },
  {
    id: 'arena-side-by-side',
    kind: 'logic',
    label: 'Arena side-by-side config verifier',
    script: 'debug/verify-arena-side-by-side-live.js',
    groups: ['full'],
    siteNames: ['Arena']
  },
  {
    id: 'dots-ai-config',
    kind: 'logic',
    label: 'dots.ai config verifier',
    script: 'debug/verify-dots-ai-config.js',
    groups: ['full'],
    siteNames: ['点点']
  },
  {
    id: 'metaso-extension-flow',
    kind: 'integration',
    label: 'Metaso extension flow verifier',
    script: 'debug/verify-metaso-extension-flow.js',
    groups: ['full'],
    siteNames: ['秘塔']
  },
  {
    id: 'nano-banana-routing',
    kind: 'logic',
    label: 'Nano Banana routing verifier',
    script: 'debug/verify-nano-banana.js',
    groups: ['full'],
    siteNames: ['Nano Banana']
  }
];

function getSiteCheckById(id) {
  return SITE_CHECKS.find((item) => item.id === id) || null;
}

function getSiteCheckByName(siteName) {
  return SITE_CHECKS.find((item) => item.siteName === siteName) || null;
}

function getExtraCheckById(id) {
  return EXTRA_CHECKS.find((item) => item.id === id) || null;
}

module.exports = {
  SITE_CHECKS,
  EXTRA_CHECKS,
  getSiteCheckById,
  getSiteCheckByName,
  getExtraCheckById
};
