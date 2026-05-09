import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SITE_HANDLERS_PATH = path.resolve(__dirname, "../../config/siteHandlers.json");

let cachedSiteHandlers = null;

function loadSiteHandlers() {
  if (cachedSiteHandlers) {
    return cachedSiteHandlers;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(SITE_HANDLERS_PATH, "utf8"));
    cachedSiteHandlers = Array.isArray(parsed?.sites) ? parsed.sites : [];
  } catch (_) {
    cachedSiteHandlers = [];
  }

  return cachedSiteHandlers;
}

function getSiteConfigByName(siteName) {
  const normalizedName = String(siteName || "").trim();
  if (!normalizedName) return null;
  return loadSiteHandlers().find((site) => String(site?.name || "").trim() === normalizedName) || null;
}

function getSiteRuntimeConfig(siteName) {
  return getSiteConfigByName(siteName)?.openclawRuntime || {};
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function matchesConfiguredPatterns(text, patternConfigs) {
  const normalizedText = String(text || "");
  return toArray(patternConfigs).some((patternConfig) => {
    try {
      return new RegExp(patternConfig, "i").test(normalizedText);
    } catch (_) {
      return false;
    }
  });
}

function isRootLikeUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    return parsed.pathname === "/" || parsed.pathname === "/chat" || parsed.pathname === "/home";
  } catch (_) {
    return false;
  }
}

function isConfiguredNotSubmitted(siteName, url, content) {
  const notSubmittedConfig = getSiteRuntimeConfig(siteName).notSubmitted || {};
  const normalizedContent = String(content || "").trim();
  if (!normalizedContent) return false;

  if (notSubmittedConfig.requireRootLikeUrl === true && !isRootLikeUrl(url)) {
    return false;
  }

  const urlPatterns = toArray(notSubmittedConfig.urlPatterns);
  if (urlPatterns.length > 0 && !matchesConfiguredPatterns(url || "", urlPatterns)) {
    return false;
  }

  const contentPatterns = toArray(notSubmittedConfig.contentPatterns);
  if (contentPatterns.length === 0) {
    return false;
  }

  return matchesConfiguredPatterns(normalizedContent, contentPatterns);
}

function isConfiguredRateLimited(siteName, content) {
  return matchesConfiguredPatterns(content, getSiteRuntimeConfig(siteName).rateLimitedPatterns);
}

export function truncateContent(content, maxChars) {
  const text = String(content || "").trim();
  if (!text) return text;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function sanitizeDisplayContent(content) {
  return String(content || "")
    .replace(/^\[\]\(\/\)\s*/u, "")
    .replace(/(?:\r?\n){3,}/g, "\n\n")
    .trim();
}

function buildInlinePreview(content, maxChars = 120) {
  const normalized = sanitizeDisplayContent(content).replace(/\s+/g, " ").trim();
  if (!normalized) return "(empty)";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function normalizeSiteForDisplay(site) {
  const normalized = {
    ...(site || {})
  };
  const content = sanitizeDisplayContent(site?.content || "");
  const url = String(site?.url || "").trim();
  const siteName = String(site?.siteName || "").trim();
  normalized.content = content;

  if (isConfiguredRateLimited(siteName, content)) {
    normalized.status = "rate_limited";
    normalized.error = normalized.error || "rate_limited";
    return normalized;
  }

  if (isConfiguredNotSubmitted(siteName, url, content)) {
    normalized.status = "not_submitted";
    normalized.error = normalized.error || "not_submitted";
    return normalized;
  }

  return normalized;
}

function formatSiteBlock(site, maxChars) {
  const normalized = normalizeSiteForDisplay(site);
  const lines = [`## ${normalized.siteName}`];
  lines.push(`Status: ${normalized.status || "unknown"}`);
  if (normalized.url) lines.push(`URL: ${normalized.url}`);
  if (normalized.error) lines.push(`Error: ${normalized.error}`);
  lines.push("");
  lines.push(truncateContent(normalized.content || "", maxChars) || "(empty)");
  return lines.join("\n");
}

function formatSiteOverview(site) {
  const parts = [
    `${site.siteName || "Unknown"}: ${site.status || "unknown"}`
  ];
  if (site.length) {
    parts.push(`${site.length} chars`);
  }
  if (site.error) {
    parts.push(site.error);
  }
  parts.push(buildInlinePreview(site.content || "", 100));
  return `- ${parts.join(" | ")}`;
}

function getSiteDisplayPriority(site) {
  return site && site.status && site.status !== "ok" ? 0 : 1;
}

function sortSitesForDisplay(sites) {
  return [...sites].sort((left, right) => {
    const priorityDiff = getSiteDisplayPriority(left) - getSiteDisplayPriority(right);
    if (priorityDiff !== 0) return priorityDiff;
    return String(left?.siteName || "").localeCompare(String(right?.siteName || ""));
  });
}

export function buildFailureMessage(params) {
  const detail = params.detail || "Unknown error";
  const lines = [
    `AI Compare hard route failed for query: ${params.query}`,
    "",
    detail
  ];
  if (params.stderr) {
    lines.push("", "stderr:", "```text", params.stderr.trim(), "```");
  }
  return lines.join("\n");
}

export function buildMissingRunnerMessage(pluginDir) {
  return [
    "AI Compare hard route matched this search request, but the bundled GUI runner was not found.",
    "",
    `Expected bundled runner: ${path.resolve(pluginDir, "bin/ai-compare-openclaw-fast.cjs")}`,
    "",
    "If you moved files around, restore the packaged bin/ directory or reinstall the plugin archive."
  ].join("\n");
}

export function buildMissingExtensionMessage(pluginConfig = {}) {
  const installUrl = typeof pluginConfig.installUrl === "string" && pluginConfig.installUrl.trim()
    ? pluginConfig.installUrl.trim()
    : (typeof process !== "undefined" && process.env && typeof process.env.AI_COMPARE_INSTALL_URL === "string" && process.env.AI_COMPARE_INSTALL_URL.trim()
      ? process.env.AI_COMPARE_INSTALL_URL.trim()
      : "<set AI_COMPARE_INSTALL_URL or plugins.entries.ai-compare-hard-router.config.installUrl>");

  return [
    "这次没有通过 AI Compare 返回站点结果，因为当前 Chrome profile 里还没有可用的 AI Compare 扩展。",
    "",
    `安装插件：${installUrl}`,
    "",
    "或者加载本地开发版：",
    "- 打开 `chrome://extensions`",
    "- 开启 `Developer mode`",
    "- 点击 `Load unpacked`",
    "- 选择 AI Compare 仓库目录",
    "",
    "如果扩展已经装过，再点一次 `Reload` 后告诉我，我再重试。"
  ].join("\n");
}

export function formatRunnerPayload(payload, options) {
  const {
    query,
    pluginConfig
  } = options;

  if (!payload || typeof payload !== "object") {
    return buildFailureMessage({
      query,
      detail: "Runner returned unreadable JSON payload."
    });
  }

  if (payload.ok !== true) {
    const errorText = String(payload.error || "").trim();
    if (/browser extension is not available|missing_extension|automation bridge is missing/i.test(errorText)) {
      return buildMissingExtensionMessage(pluginConfig);
    }
    return buildFailureMessage({
      query,
      detail: errorText || "Runner returned ok=false."
    });
  }

  const result = payload.result && typeof payload.result === "object" ? payload.result : null;
  if (result && typeof result === "object") {
    return JSON.stringify(payload, null, 2);
  }

  return JSON.stringify(payload, null, 2);
}
