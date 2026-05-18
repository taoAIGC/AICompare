import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function fileExists(candidate) {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  } catch (_) {
    return false;
  }
}

export function resolveRunnerPath(pluginConfig = {}, pluginDir) {
  const bundledRunner = path.resolve(pluginDir, "bin/ai-compare-openclaw-fast.cjs");
  const configured = typeof pluginConfig.runnerPath === "string" ? pluginConfig.runnerPath.trim() : "";
  const candidates = [bundledRunner, configured].filter(Boolean);
  return candidates.find(fileExists) || "";
}

export function buildRunnerArgs(params) {
  const args = [params.runnerPath, "--query", params.query];
  if (params.sites.length > 0) {
    args.push("--sites", params.sites.join(","));
  }
  if (params.extensionId) {
    args.push("--extension-id", params.extensionId);
  }
  if (params.browserApp) {
    args.push("--browser-app", params.browserApp);
  }
  return args;
}

export function runNodeScript(args, timeoutMs, logger) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      logger?.error?.(`ai-compare-hard-router: failed to run runner: ${error.message}`);
      resolve({
        ok: false,
        timedOut,
        error: error.message,
        stdout,
        stderr
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        timedOut,
        code,
        signal,
        stdout,
        stderr
      });
    });
  });
}

export function extractJsonPayload(stdout) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch (_) {
      return null;
    }
  }
}

export function resolveTimeoutMs(pluginConfig = {}, fallbackTimeoutMs) {
  const rawTimeout = Number(pluginConfig.timeoutMs);
  if (Number.isFinite(rawTimeout)) {
    return Math.max(1000, rawTimeout);
  }
  return fallbackTimeoutMs;
}
