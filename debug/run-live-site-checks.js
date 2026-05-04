#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_REPORT_DIR = path.join(__dirname, 'reports');
const DEFAULT_GROUP = 'core';
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;

const CHECKS = [
  {
    id: 'static-config',
    kind: 'static',
    label: 'siteHandlers schema and verifier drift',
    script: 'debug/validate-site-configs.js',
    groups: ['core', 'full'],
    siteNames: []
  },
  {
    id: 'claude',
    kind: 'live',
    label: 'Claude real-browser verifier',
    script: 'debug/verify-claude-live.js',
    groups: ['core', 'full'],
    siteNames: ['Claude']
  },
  {
    id: 'chatgpt',
    kind: 'live',
    label: 'ChatGPT extension end-to-end verifier',
    script: 'debug/verify-chatgpt-live.js',
    groups: ['core', 'full'],
    siteNames: ['ChatGPT']
  },
  {
    id: 'gemini',
    kind: 'live',
    label: 'Gemini extension end-to-end verifier',
    script: 'debug/verify-gemini-live.js',
    groups: ['core', 'full'],
    siteNames: ['Gemini']
  },
  {
    id: 'grok',
    kind: 'live',
    label: 'Grok real-browser verifier',
    script: 'debug/verify-grok-live.js',
    groups: ['core', 'full'],
    siteNames: ['Grok']
  },
  {
    id: 'minimax',
    kind: 'live',
    label: 'MiniMax real-browser verifier',
    script: 'debug/verify-minimax-live.js',
    groups: ['core', 'full'],
    siteNames: ['MiniMax']
  },
  {
    id: 'manus',
    kind: 'live',
    label: 'Manus real-browser verifier',
    script: 'debug/verify-manus-live.js',
    groups: ['core', 'full'],
    siteNames: ['Manus']
  },
  {
    id: 'deepseek',
    kind: 'live',
    label: 'DeepSeek extension end-to-end verifier',
    script: 'debug/verify-deepseek-live.js',
    groups: ['core', 'full'],
    siteNames: ['DeepSeek']
  },
  {
    id: 'ai-studio',
    kind: 'live',
    label: 'AI Studio real-browser verifier',
    script: 'debug/verify-ai-studio-live.js',
    groups: ['full'],
    siteNames: ['AI Studio']
  },
  {
    id: 'dots-ai',
    kind: 'live',
    label: 'dots.ai real-browser verifier',
    script: 'debug/verify-dots-ai-live.js',
    groups: ['core', 'full'],
    siteNames: ['点点']
  },
  {
    id: 'nano-banana-live',
    kind: 'live',
    label: 'Nano Banana extension end-to-end verifier',
    script: 'debug/verify-nano-banana-live.js',
    groups: ['core', 'full'],
    siteNames: ['Nano Banana']
  },
  {
    id: 'translate-sites',
    kind: 'live',
    label: 'Google/Bing Translate real-browser verifier',
    script: 'debug/verify-translate-sites-live.js',
    groups: ['core', 'full'],
    siteNames: ['Google Translate', 'Bing Translate']
  },
  {
    id: 'doubao',
    kind: 'live',
    label: 'Doubao real-browser verifier',
    script: 'debug/verify-doubao-live.js',
    groups: ['full'],
    siteNames: ['豆包']
  },
  {
    id: 'yuanbao',
    kind: 'live',
    label: 'Yuanbao real-browser verifier',
    script: 'debug/verify-yuanbao-live.js',
    groups: ['full'],
    siteNames: ['元宝']
  },
  {
    id: 'kimi',
    kind: 'live',
    label: 'Kimi real-browser verifier',
    script: 'debug/verify-kimi-live.js',
    groups: ['full'],
    siteNames: ['Kimi']
  },
  {
    id: 'qianwen',
    kind: 'live',
    label: 'Qianwen real-browser verifier',
    script: 'debug/verify-qianwen-live.js',
    groups: ['full'],
    siteNames: ['千问']
  },
  {
    id: 'qwen',
    kind: 'live',
    label: 'Qwen real-browser verifier',
    script: 'debug/verify-qwen-live.js',
    groups: ['full'],
    siteNames: ['Qwen']
  },
  {
    id: 'metaso',
    kind: 'live',
    label: 'Metaso real-browser verifier',
    script: 'debug/verify-metaso-live.js',
    groups: ['full'],
    siteNames: ['秘塔']
  },
  {
    id: 'perplexity',
    kind: 'live',
    label: 'Perplexity real-browser verifier',
    script: 'debug/verify-perplexity-live.js',
    groups: ['full'],
    siteNames: ['Perplexity']
  },
  {
    id: 'zhipu',
    kind: 'live',
    label: 'Zhipu real-browser verifier',
    script: 'debug/verify-zhipu-live.js',
    groups: ['full'],
    siteNames: ['智谱']
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

const EXTERNAL_STATUS_PATTERNS = [
  { status: 'login_required', pattern: /sign in|log in|login|登录|请先登录|continue with google/i },
  { status: 'rate_limited', pattern: /rate limit|usage limit|quota|credits?|pricing|消息限制|额度|限流/i },
  { status: 'blocked', pattern: /captcha|verify you are human|access denied|blocked|temporarily unavailable|访问受限/i }
];

function parseArgs(argv) {
  const options = {
    group: DEFAULT_GROUP,
    writeReport: false,
    reportPath: '',
    strictExternal: false,
    failOnCoverageGap: false,
    list: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    selectedIds: [],
    selectedSites: [],
    staticOnly: false,
    liveOnly: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--group' && argv[index + 1]) {
      options.group = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (token === '--timeout-ms' && argv[index + 1]) {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        options.timeoutMs = value;
      }
      index += 1;
      continue;
    }

    if (token === '--checks' && argv[index + 1]) {
      options.selectedIds = argv[index + 1].split(',').map((item) => item.trim()).filter(Boolean);
      index += 1;
      continue;
    }

    if (token === '--sites' && argv[index + 1]) {
      options.selectedSites = argv[index + 1].split(',').map((item) => item.trim()).filter(Boolean);
      index += 1;
      continue;
    }

    if (token === '--write-report') {
      options.writeReport = true;
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        options.reportPath = next;
        index += 1;
      }
      continue;
    }

    if (token === '--strict-external') {
      options.strictExternal = true;
      continue;
    }

    if (token === '--fail-on-coverage-gap') {
      options.failOnCoverageGap = true;
      continue;
    }

    if (token === '--list') {
      options.list = true;
      continue;
    }

    if (token === '--static-only') {
      options.staticOnly = true;
      continue;
    }

    if (token === '--live-only') {
      options.liveOnly = true;
    }
  }

  return options;
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeReadConfigSites() {
  try {
    const configPath = path.join(REPO_ROOT, 'config', 'siteHandlers.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return Array.isArray(config?.sites) ? config.sites : [];
  } catch (_) {
    return [];
  }
}

function normalizeSet(values) {
  return new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean));
}

function resolveChecks(options) {
  let checks = CHECKS.filter((check) => check.groups.includes(options.group));

  if (options.group === 'all') {
    checks = CHECKS.slice();
  }

  if (options.staticOnly) {
    checks = checks.filter((check) => check.kind === 'static');
  }

  if (options.liveOnly) {
    checks = checks.filter((check) => check.kind !== 'static');
  }

  if (options.selectedIds.length > 0) {
    const selected = normalizeSet(options.selectedIds);
    checks = checks.filter((check) => selected.has(check.id));
  }

  if (options.selectedSites.length > 0) {
    const selected = normalizeSet(options.selectedSites);
    checks = checks.filter((check) => check.siteNames.some((siteName) => selected.has(siteName)));
  }

  return checks;
}

function buildCoverageReport() {
  const configSites = safeReadConfigSites();
  const allSiteNames = configSites.map((site) => String(site?.name || '').trim()).filter(Boolean);
  const liveCovered = new Set(
    CHECKS
      .filter((check) => check.kind === 'live')
      .flatMap((check) => check.siteNames)
      .map((name) => String(name || '').trim())
      .filter(Boolean)
  );

  const uncovered = allSiteNames.filter((name) => !liveCovered.has(name));
  return {
    totalConfiguredSites: allSiteNames.length,
    liveCoveredSites: Array.from(liveCovered).sort((left, right) => left.localeCompare(right)),
    uncoveredSites: uncovered.sort((left, right) => left.localeCompare(right))
  };
}

function parseJsonOutput(output) {
  const trimmed = String(output || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    return null;
  }
}

function classifyFailure(output) {
  const combined = String(output || '');
  if (/timed out|timeout|请求超时/i.test(combined)) {
    return 'timeout';
  }

  for (const item of EXTERNAL_STATUS_PATTERNS) {
    if (item.pattern.test(combined)) {
      return item.status;
    }
  }

  return 'failed';
}

function isHardFailure(status, strictExternal) {
  if (status === 'passed') return false;
  if (status === 'login_required' || status === 'rate_limited' || status === 'blocked') {
    return !!strictExternal;
  }
  return true;
}

function runCheck(check, timeoutMs) {
  const scriptPath = path.join(REPO_ROOT, check.script);
  const startedAt = new Date();
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 20
  });
  const finishedAt = new Date();
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  const combined = `${stdout}\n${stderr}`.trim();
  const parsed = parseJsonOutput(stdout);

  let status = 'passed';
  if (result.error && result.error.code === 'ETIMEDOUT') {
    status = 'timeout';
  } else if (result.status !== 0) {
    status = classifyFailure(combined);
  }

  return {
    id: check.id,
    kind: check.kind,
    label: check.label,
    script: check.script,
    siteNames: check.siteNames,
    status,
    exitCode: typeof result.status === 'number' ? result.status : null,
    signal: result.signal || null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    parsed,
    stdoutPreview: stdout.trim().slice(0, 4000),
    stderrPreview: stderr.trim().slice(0, 4000)
  };
}

function listChecks() {
  const payload = CHECKS.map((check) => ({
    id: check.id,
    kind: check.kind,
    groups: check.groups,
    script: check.script,
    siteNames: check.siteNames
  }));
  console.log(JSON.stringify(payload, null, 2));
}

function summarize(results) {
  return results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.list) {
    listChecks();
    return;
  }

  const checks = resolveChecks(options);
  if (checks.length === 0) {
    throw new Error('No checks selected. Use --list to inspect available checks.');
  }

  const coverage = buildCoverageReport();
  const results = checks.map((check) => runCheck(check, options.timeoutMs));
  const hardFailureCount = results.filter((item) => isHardFailure(item.status, options.strictExternal)).length;
  const coverageGapCount = coverage.uncoveredSites.length;

  const payload = {
    ok: hardFailureCount === 0 && (!options.failOnCoverageGap || coverageGapCount === 0),
    checkedAt: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    options: {
      group: options.group,
      timeoutMs: options.timeoutMs,
      strictExternal: options.strictExternal,
      failOnCoverageGap: options.failOnCoverageGap,
      selectedIds: options.selectedIds,
      selectedSites: options.selectedSites,
      staticOnly: options.staticOnly,
      liveOnly: options.liveOnly
    },
    summary: summarize(results),
    coverage,
    results
  };

  if (options.writeReport) {
    ensureDir(DEFAULT_REPORT_DIR);
    const targetPath = options.reportPath
      ? path.resolve(REPO_ROOT, options.reportPath)
      : path.join(DEFAULT_REPORT_DIR, `site-check-report-${formatTimestamp(new Date())}.json`);
    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    payload.reportPath = targetPath;
  }

  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

try {
  main();
} catch (error) {
  console.error(error.stack || String(error));
  process.exit(1);
}
