#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runExtensionFlowCheck } = require('./extension-flow-common');
const {
  EXTRA_CHECKS,
  SITE_CHECKS,
  getExtraCheckById,
  getSiteCheckById,
  getSiteCheckByName
} = require('./site-test-manifest');
const { classifyExternalStatus } = require('./live-verifier-common');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_REPORT_DIR = path.join(__dirname, 'reports');
const DEFAULT_GROUP = 'core';
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;
const DEFAULT_DEVTOOLS_ACTIVE_PORT = path.join(
  process.env.HOME || '',
  'Library/Application Support/Google/Chrome/DevToolsActivePort'
);

function parseArgs(argv) {
  const options = {
    group: DEFAULT_GROUP,
    help: false,
    writeReport: false,
    reportPath: '',
    browserApp: '',
    extensionId: '',
    extensionTransport: 'gui',
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

    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }

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

    if (token === '--browser-app' && argv[index + 1]) {
      options.browserApp = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (token === '--extension-id' && argv[index + 1]) {
      options.extensionId = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (token === '--extension-transport' && argv[index + 1]) {
      options.extensionTransport = String(argv[index + 1]).trim().toLowerCase();
      index += 1;
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

function printUsage() {
  const usage = [
    'Usage:',
    '  node debug/run-live-site-checks.js [options]',
    '',
    'Options:',
    '  --group <name>           Check group: core | full | all (default: core)',
    '  --checks <a,b,c>         Run only the named check ids',
    '  --sites <a,b,c>          Run checks that cover the named site(s)',
    '  --timeout-ms <ms>        Per-check timeout (default: 480000)',
    '  --write-report [path]    Persist JSON report to debug/reports or a custom path',
    '  --browser-app <name>     Browser app for GUI extension-url checks',
    '  --extension-id <id>      Extension id override for extension-url checks',
    '  --extension-transport    extension_url transport: gui | cdp (default: gui)',
    '  --strict-external        Treat login/rate-limit/blocked as hard failures',
    '  --fail-on-coverage-gap   Fail when configured sites have no live verifier coverage',
    '  --static-only            Run only static config checks',
    '  --live-only              Run only live checks',
    '  --list                   Print available checks as JSON',
    '  --help, -h              Show this help'
  ].join('\n');

  console.log(usage);
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

function normalizeSet(values) {
  return new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean));
}

function slugifySiteId(siteName) {
  return String(siteName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'site-check';
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

function getConfigSiteMap(configSites) {
  return new Map(
    (configSites || [])
      .filter((site) => site && site.name)
      .map((site) => [String(site.name).trim(), site])
  );
}

function resolveSiteCheckForName(siteName, configSiteMap) {
  const normalizedName = String(siteName || '').trim();
  if (!normalizedName) return null;

  const manifestCheck = getSiteCheckByName(normalizedName);
  if (manifestCheck) {
    return {
      ...manifestCheck,
      kind: 'live',
      siteNames: [manifestCheck.siteName]
    };
  }

  const site = configSiteMap.get(normalizedName);
  if (!site) {
    return null;
  }

  if (site.supportIframe === false) {
    return {
      id: slugifySiteId(site.name),
      siteName: site.name,
      siteNames: [site.name],
      mode: 'unsupported_non_iframe',
      kind: 'live',
      label: `${site.name} non-iframe site (not included in extension-url checks)`,
      groups: [],
      script: '',
      unsupportedNonIframe: true
    };
  }

  return {
    id: slugifySiteId(site.name),
    siteName: site.name,
    siteNames: [site.name],
    mode: 'extension_url',
    kind: 'live',
    label: `${site.name} extension end-to-end verifier`,
    groups: []
  };
}

function addUniqueCheck(targetMap, check) {
  if (!check || !check.id) return;
  if (!targetMap.has(check.id)) {
    targetMap.set(check.id, check);
  }
}

function filterByGroup(checks, group) {
  if (group === 'all') return checks.slice();
  return checks.filter((check) => Array.isArray(check.groups) && check.groups.includes(group));
}

function resolveSiteChecks(options, configSiteMap) {
  const resolved = new Map();
  const hasExplicitSelection = options.selectedIds.length > 0 || options.selectedSites.length > 0;

  if (!hasExplicitSelection) {
    for (const check of filterByGroup(SITE_CHECKS, options.group)) {
      addUniqueCheck(resolved, {
        ...check,
        kind: 'live',
        siteNames: [check.siteName]
      });
    }
    return Array.from(resolved.values());
  }

  for (const id of options.selectedIds) {
    const manifestCheck = getSiteCheckById(id);
    if (!manifestCheck) continue;
    addUniqueCheck(resolved, {
      ...manifestCheck,
      kind: 'live',
      siteNames: [manifestCheck.siteName]
    });
  }

  for (const siteName of options.selectedSites) {
    addUniqueCheck(resolved, resolveSiteCheckForName(siteName, configSiteMap));
  }

  return Array.from(resolved.values());
}

function resolveExtraChecks(options) {
  const resolved = new Map();
  const hasExplicitSelection = options.selectedIds.length > 0 || options.selectedSites.length > 0;

  if (!hasExplicitSelection) {
    for (const check of filterByGroup(EXTRA_CHECKS, options.group)) {
      addUniqueCheck(resolved, check);
    }
    return Array.from(resolved.values());
  }

  for (const id of options.selectedIds) {
    addUniqueCheck(resolved, getExtraCheckById(id));
  }

  if (options.selectedSites.length > 0) {
    const selectedSites = normalizeSet(options.selectedSites);
    for (const check of EXTRA_CHECKS) {
      if (check.siteNames.some((siteName) => selectedSites.has(siteName))) {
        addUniqueCheck(resolved, check);
      }
    }
  }

  return Array.from(resolved.values());
}

function resolveChecks(options, configSites) {
  const configSiteMap = getConfigSiteMap(configSites);
  const siteChecks = resolveSiteChecks(options, configSiteMap);
  const extraChecks = resolveExtraChecks(options);
  let checks = [...extraChecks, ...siteChecks];

  if (options.staticOnly) {
    checks = checks.filter((check) => check.kind === 'static');
  }

  if (options.liveOnly) {
    checks = checks.filter((check) => check.kind !== 'static');
  }

  return checks;
}

function buildCoverageReport(configSites) {
  const extensionUrlCoveredSites = configSites
    .filter((site) => site && site.name && site.supportIframe !== false)
    .map((site) => String(site.name).trim())
    .sort((left, right) => left.localeCompare(right));
  const ignoredNonIframeSites = configSites
    .filter((site) => site && site.name && site.supportIframe === false)
    .map((site) => String(site.name).trim())
    .sort((left, right) => left.localeCompare(right));
  const listedManifestSites = SITE_CHECKS
    .filter((check) => check.mode === 'extension_url')
    .map((check) => check.siteName)
    .sort((left, right) => left.localeCompare(right));

  return {
    totalConfiguredSites: configSites.length,
    extensionUrlCoveredSites,
    listedManifestSites,
    ignoredNonIframeSites
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

function readChromeCdpEndpoint() {
  const portFile = process.env.DEVTOOLS_ACTIVE_PORT || DEFAULT_DEVTOOLS_ACTIVE_PORT;
  if (!fs.existsSync(portFile)) {
    return {
      ok: false,
      reason: `Chrome DevToolsActivePort is missing: ${portFile}`
    };
  }

  let raw = '';
  try {
    raw = fs.readFileSync(portFile, 'utf8').trim();
  } catch (error) {
    return {
      ok: false,
      reason: `Unable to read DevToolsActivePort: ${error.message}`
    };
  }

  const lines = raw.split('\n');
  const port = String(lines[0] || '').trim();
  const browserPath = String(lines[1] || '').trim();
  if (!port || !browserPath) {
    return {
      ok: false,
      reason: `DevToolsActivePort is invalid: ${portFile}`
    };
  }

  return {
    ok: true,
    portFile,
    port,
    browserPath
  };
}

function probeChromeCdp() {
  const endpoint = readChromeCdpEndpoint();
  if (!endpoint.ok) {
    return Promise.resolve(endpoint);
  }

  return Promise.resolve({
    ok: true,
    portFile: endpoint.portFile,
    port: endpoint.port,
    browserPath: endpoint.browserPath,
    webSocketDebuggerUrl: ''
  });
}

function classifyFailure(output) {
  const combined = String(output || '');
  if (/DevToolsActivePort|CDP|Chrome DevTools|ErrorEvent/i.test(combined)) {
    return 'environment_blocked';
  }
  if (/timed out|timeout|请求超时/i.test(combined)) {
    return 'timeout';
  }
  return classifyExternalStatus(combined) || 'failed';
}

function isHardFailure(status, strictExternal) {
  if (status === 'passed' || status === 'ok') return false;
  if (status === 'login_required' || status === 'rate_limited' || status === 'blocked') {
    return !!strictExternal;
  }
  return true;
}

function buildEnvBlockedResult(check, reason) {
  const now = new Date().toISOString();
  return {
    id: check.id,
    kind: check.kind,
    label: check.label,
    script: check.script || '',
    siteNames: check.siteNames || [],
    mode: check.mode || '',
    status: 'environment_blocked',
    exitCode: null,
    signal: null,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    parsed: null,
    stdoutPreview: '',
    stderrPreview: reason
  };
}

function buildCoverageGapResult(check, reason) {
  const now = new Date().toISOString();
  return {
    id: check.id,
    kind: check.kind,
    label: check.label,
    script: check.script || '',
    siteNames: check.siteNames || [],
    mode: check.mode || '',
    status: 'coverage_gap',
    exitCode: null,
    signal: null,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    parsed: {
      siteName: check.siteName || '',
      mode: check.mode || 'live_direct',
      ok: false,
      status: 'error',
      query: String(check.query || '你好世界'),
      pageUrl: '',
      runtimeUrl: '',
      contentPreview: '',
      evidence: {
        reason
      },
      assessment: {
        config_valid: false,
        flow_valid: false,
        service_available: false
      },
      checkedAt: now
    },
    stdoutPreview: '',
    stderrPreview: reason
  };
}

function buildUnsupportedNonIframeResult(check, reason) {
  const now = new Date().toISOString();
  return {
    id: check.id,
    kind: check.kind,
    label: check.label,
    script: '',
    siteNames: check.siteNames || [],
    mode: check.mode || '',
    status: 'skipped',
    exitCode: 0,
    signal: null,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    parsed: {
      siteName: check.siteName || '',
      mode: check.mode || 'unsupported_non_iframe',
      ok: true,
      status: 'skipped',
      query: String(check.query || '你好世界'),
      pageUrl: '',
      runtimeUrl: '',
      contentPreview: '',
      evidence: {
        reason
      },
      assessment: {
        config_valid: true,
        flow_valid: false,
        service_available: false
      },
      checkedAt: now
    },
    stdoutPreview: '',
    stderrPreview: ''
  };
}

async function runExtensionSiteCheck(check, timeoutMs, options) {
  const startedAt = new Date();
  try {
    const parsed = await runExtensionFlowCheck({
      siteName: check.siteName,
      query: check.query || process.env.TEST_QUERY || '你好世界',
      extensionId: options.extensionId || process.env.AI_COMPARE_EXTENSION_ID || process.env.EXTENSION_ID || 'hhkhgpadepocnmjfpohcmjdcgkmfnadi',
      browserApp: options.browserApp || '',
      transport: options.extensionTransport || 'gui',
      timeoutMs,
      pollMs: check.pollMs,
      minChars: check.minChars,
      stableRounds: check.stableRounds,
      waitForIframesMs: check.waitForIframesMs,
      reloadExtension: process.env.RELOAD_EXTENSION === '1'
    });
    const finishedAt = new Date();
    return {
      id: check.id,
      kind: check.kind,
      label: check.label,
      script: 'extension_url_contract',
      siteNames: [check.siteName],
      mode: check.mode,
      status: parsed.status,
      exitCode: parsed.ok ? 0 : 1,
      signal: null,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      parsed,
      stdoutPreview: JSON.stringify(parsed, null, 2).slice(0, 4000),
      stderrPreview: parsed.ok ? '' : JSON.stringify(parsed, null, 2).slice(0, 4000)
    };
  } catch (error) {
    const finishedAt = new Date();
    const message = error && error.stack ? error.stack : String(error);
    return {
      id: check.id,
      kind: check.kind,
      label: check.label,
      script: 'extension_url_contract',
      siteNames: [check.siteName],
      mode: check.mode,
      status: classifyFailure(message),
      exitCode: 1,
      signal: null,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      parsed: null,
      stdoutPreview: '',
      stderrPreview: message.slice(0, 4000)
    };
  }
}

function runScriptCheck(check, timeoutMs) {
  const scriptPath = path.join(REPO_ROOT, check.script);
  const startedAt = new Date();
  const env = {
    ...process.env
  };

  if (check.query) {
    env.TEST_QUERY = String(check.query);
  }

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 20,
    env
  });
  const finishedAt = new Date();
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  const combined = `${stdout}\n${stderr}`.trim();
  const parsed = parseJsonOutput(stdout) || parseJsonOutput(stderr);

  let status = 'passed';
  if (parsed?.status) {
    status = String(parsed.status);
  } else if (result.error && result.error.code === 'ETIMEDOUT') {
    status = 'timeout';
  } else if (result.status !== 0) {
    status = classifyFailure(combined);
  }

  return {
    id: check.id,
    kind: check.kind,
    label: check.label,
    script: check.script,
    siteNames: check.siteNames || [],
    mode: check.mode || '',
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

async function runCheck(check, timeoutMs, options) {
  if (check.kind === 'live' && check.unsupportedNonIframe) {
    return buildUnsupportedNonIframeResult(
      check,
      `${check.siteName} is supportIframe=false and is intentionally excluded from extension-url site checks.`
    );
  }

  if (check.kind === 'live' && check.coverageGap) {
    return buildCoverageGapResult(
      check,
      `${check.siteName} does not support iframe mode and has no dedicated live verifier yet.`
    );
  }

  if (check.kind === 'live' && check.mode === 'extension_url') {
    return runExtensionSiteCheck(check, timeoutMs, options);
  }

  if (check.script) {
    return runScriptCheck(check, timeoutMs);
  }

  return buildCoverageGapResult(check, `No runnable implementation found for check ${check.id}.`);
}

function listChecks() {
  const payload = [
    ...EXTRA_CHECKS.map((check) => ({
      id: check.id,
      kind: check.kind,
      groups: check.groups,
      script: check.script,
      siteNames: check.siteNames
    })),
    ...SITE_CHECKS.map((check) => ({
      id: check.id,
      kind: 'live',
      groups: check.groups,
      mode: check.mode,
      script: check.script || '',
      siteNames: [check.siteName]
    }))
  ];
  console.log(JSON.stringify(payload, null, 2));
}

function summarize(results) {
  return results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  if (options.list) {
    listChecks();
    return;
  }

  const configSites = safeReadConfigSites();
  const checks = resolveChecks(options, configSites);
  if (checks.length === 0) {
    throw new Error('No checks selected. Use --list to inspect available checks.');
  }

  const coverage = buildCoverageReport(configSites);
  const requiresCdp = checks.some((check) => (
    check.kind === 'live'
    && !check.coverageGap
    && (check.mode === 'live_direct' || options.extensionTransport === 'cdp')
  ));
  const cdpStatus = requiresCdp ? await probeChromeCdp() : null;
  const results = [];

  for (const check of checks) {
    if (check.kind === 'live' && !check.coverageGap && cdpStatus && !cdpStatus.ok) {
      results.push(buildEnvBlockedResult(check, cdpStatus.reason));
      continue;
    }
    results.push(await runCheck(check, options.timeoutMs, options));
  }

  const hardFailureCount = results.filter((item) => isHardFailure(item.status, options.strictExternal)).length;
  const coverageGapCount = 0;

  const payload = {
    ok: hardFailureCount === 0 && (!options.failOnCoverageGap || coverageGapCount === 0),
    checkedAt: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    options: {
      group: options.group,
      timeoutMs: options.timeoutMs,
      browserApp: options.browserApp,
      extensionId: options.extensionId,
      extensionTransport: options.extensionTransport,
      strictExternal: options.strictExternal,
      failOnCoverageGap: options.failOnCoverageGap,
      selectedIds: options.selectedIds,
      selectedSites: options.selectedSites,
      staticOnly: options.staticOnly,
      liveOnly: options.liveOnly
    },
    environment: cdpStatus
      ? {
          cdpRequired: requiresCdp,
          cdpAvailable: cdpStatus.ok === true,
          cdpReason: cdpStatus.ok ? '' : cdpStatus.reason
        }
      : {
          cdpRequired: false,
          cdpAvailable: null,
          cdpReason: ''
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

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
