export const SITE_ALIAS_RULES = [
  { name: "ChatGPT", patterns: ["\\bchatgpt\\b"] },
  { name: "Gemini", patterns: ["\\bgemini\\b"] },
  { name: "Claude", patterns: ["\\bclaude\\b"] },
  { name: "Grok", patterns: ["\\bgrok\\b"] },
  { name: "Perplexity", patterns: ["\\bperplexity\\b"] },
  { name: "DeepSeek", patterns: ["\\bdeepseek\\b"] },
  { name: "Kimi", patterns: ["\\bkimi\\b"] },
  { name: "Qwen", patterns: ["\\bqwen\\b", "通义千问"] },
  { name: "Doubao", patterns: ["\\bdoubao\\b", "豆包"] },
  { name: "Minimax", patterns: ["\\bminimax\\b"] },
  { name: "ChatGLM", patterns: ["\\bchatglm\\b", "智谱"] }
];

export const SEARCH_PREFIX_RULES = [
  "^(?:请\\s*)?(?:帮我\\s*)?(?:直接\\s*)?(?:用\\s*)?(?:去\\s*)?(?:搜索一下|搜索|搜一下|搜下|查一下|查下|帮我搜|替我搜|我要搜索)\\s*",
  "^(?:please\\s+)?(?:search\\s+for|search|look\\s+up)\\s+"
];

export const SOFT_SEARCH_PREFIX_RULES = [
  "^(?:请\\s*)?(?:帮我\\s*)?(?:了解一下|了解下|研究一下|研究下|找一下|找下|查查|看看|看下|帮我看看|帮我看下|想了解一下|想研究一下|比较一下|对比一下)\\s*",
  "^(?:please\\s+)?(?:learn\\s+about|look\\s+into|research|find\\s+information\\s+about|find\\s+info\\s+on|compare)\\s+"
];

export const ALT_TOOL_RULES = [
  "网页搜索",
  "新闻搜索",
  "\\bweb\\s+search\\b",
  "\\bgoogle\\s+search\\b",
  "\\bbing\\s+search\\b",
  "\\bbaidu\\s+search\\b"
];

export const RESPONSE_DIRECTIVE_RULES = [];

export const LOCAL_TASK_GUARD_RULES = [
  "^(?:这个|这段|这份|当前|本地)",
  "报错",
  "错误日志",
  "日志",
  "代码",
  "函数",
  "方法",
  "文件",
  "脚本",
  "仓库",
  "接口",
  "配置",
  "单测",
  "测试失败",
  "\\bbug\\b",
  "\\berror\\b",
  "\\bstack\\b",
  "\\btrace\\b",
  "\\btest\\b",
  "\\btests\\b",
  "\\bfunction\\b",
  "\\bfile\\b",
  "\\bscript\\b",
  "\\brepo\\b",
  "\\bconfig\\b",
  "\\bcode\\b"
];
