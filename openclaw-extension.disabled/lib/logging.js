import fs from "node:fs";

import { DEFAULT_DEBUG_LOG_PATH } from "./defaults.js";

function resolveDebugLogPath(pluginConfig = {}) {
  return typeof pluginConfig.debugLogPath === "string" && pluginConfig.debugLogPath.trim()
    ? pluginConfig.debugLogPath.trim()
    : DEFAULT_DEBUG_LOG_PATH;
}

export function createDebugLogger(pluginConfig = {}) {
  const debugLogPath = resolveDebugLogPath(pluginConfig);

  return function appendDebugLog(stage, payload = {}) {
    try {
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        stage,
        payload
      });
      fs.appendFileSync(debugLogPath, `${line}\n`);
    } catch (_) {
      // Best-effort logging only. Never break the hook path on log write failures.
    }
  };
}

