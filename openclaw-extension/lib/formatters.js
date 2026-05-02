import os from "node:os";
import path from "node:path";

import { DEFAULT_INSTALL_URL } from "./defaults.js";

export function truncateContent(content, maxChars) {
  const text = String(content || "").trim();
  if (!text) return text;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function normalizeSiteForDisplay(site) {
  const normalized = {
    ...(site || {})
  };
  const content = String(site?.content || "").trim();
  const url = String(site?.url || "").trim();
  const siteName = String(site?.siteName || "").trim();

  if (
    siteName === "Grok"
    && /消息限制已达|SuperGrok|usage limit|wait\s+\d+\s*(?:hour|minute)/i.test(content)
  ) {
    normalized.status = "error";
    normalized.error = normalized.error || "rate_limited";
    return normalized;
  }

  if (
    siteName === "ChatGPT"
    && /^https:\/\/chatgpt\.com\/?$/.test(url)
    && /what(?:'|’)?s on the agenda today\??/i.test(content)
  ) {
    normalized.status = "error";
    normalized.error = normalized.error || "possible_unsubmitted_prompt";
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
    "AI Compare hard route matched this search request, but the GUI runner was not found.",
    "",
    "Expected one of these paths to exist:",
    `- sibling repo runner: ${path.resolve(pluginDir, "../openclaw/ai-compare-openclaw-fast.js")}`,
    `- workspace skill runner: ${path.join(os.homedir(), ".openclaw/workspace/skills/ai-compare-bridge/ai-compare-openclaw-fast.js")}`,
    "",
    "You can also set plugins.entries.ai-compare-hard-router.config.runnerPath in ~/.openclaw/openclaw.json."
  ].join("\n");
}

export function buildMissingExtensionMessage(pluginConfig = {}) {
  const installUrl = typeof pluginConfig.installUrl === "string" && pluginConfig.installUrl.trim()
    ? pluginConfig.installUrl.trim()
    : DEFAULT_INSTALL_URL;

  return [
    "这次没有通过 AI Compare 返回站点结果，因为当前 Chrome profile 里还没有可用的 AI Compare 扩展。",
    "",
    "安装插件：",
    installUrl,
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
    includeRawJson,
    maxChars,
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
  const results = Array.isArray(result?.results) ? result.results : [];
  const header = [
    `AI Compare 搜索结果：${query}`,
    ...(payload.triggerUrl ? [`Trigger URL: ${payload.triggerUrl}`] : [])
  ];

  if (results.length === 0) {
    header.push("", "没有收到任何站点结果。");
  }

  const normalizedResults = results.map((site) => normalizeSiteForDisplay(site));
  const siteBlocks = normalizedResults.map((site) => formatSiteBlock(site, maxChars));
  const failures = normalizedResults
    .filter((site) => site.status && site.status !== "ok")
    .map((site) => `${site.siteName}: ${site.status}${site.error ? ` (${site.error})` : ""}`);

  const parts = [header.join("\n")];
  if (siteBlocks.length > 0) {
    parts.push(siteBlocks.join("\n\n"));
  }
  if (failures.length > 0) {
    parts.push(["失败或不完整站点：", ...failures.map((line) => `- ${line}`)].join("\n"));
  }
  if (includeRawJson) {
    parts.push(["Raw JSON:", "```json", JSON.stringify(payload, null, 2), "```"].join("\n"));
  }
  return parts.join("\n\n");
}

