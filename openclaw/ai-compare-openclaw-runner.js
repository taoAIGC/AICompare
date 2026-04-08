#!/usr/bin/env node

const { chromium } = require('playwright');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }
  return args;
}

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseSites(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildExtensionUrl(extensionId, query, sites) {
  const params = new URLSearchParams();
  params.set('openclaw', '1');
  if (query) params.set('query', query);
  if (sites.length > 0) params.set('sites', sites.join(','));
  return `chrome-extension://${extensionId}/iframe/iframe.html?${params.toString()}`;
}

function parseRemoteDebuggingPort(cdpEndpoint) {
  try {
    const parsed = new URL(cdpEndpoint);
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'));
    return Number.isFinite(port) && port > 0 ? port : 9222;
  } catch (_) {
    return 9222;
  }
}

async function connectToBrowser(cdpEndpoint, connectOverCDP = (endpoint) => chromium.connectOverCDP(endpoint)) {
  try {
    return await connectOverCDP(cdpEndpoint);
  } catch (error) {
    const details = error && error.message ? error.message : String(error);
    const port = parseRemoteDebuggingPort(cdpEndpoint);
    throw new Error(
      `Unable to connect to Chrome DevTools at ${cdpEndpoint}. ` +
      `This runner only supports your existing Chrome profile and will not launch a separate profile. ` +
      `Start Chrome with your normal profile and remote debugging enabled, for example on macOS: ` +
      `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=${port}". ` +
      `Last error: ${details}`
    );
  }
}

async function getPersistentContext(browser, waitMs = 5000, pollMs = 100) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitMs) {
    const [context] = browser.contexts();
    if (context) {
      return context;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error('No persistent Chrome context became available after connecting over CDP');
}

function printUsage() {
  const usage = [
    'Usage:',
    '  node openclaw/ai-compare-openclaw-runner.js --query "hello world" [options]',
    '',
    'Options:',
    '  --query <text>            Required. Query to compare',
    '  --sites <a,b,c>           Optional. Restrict comparison sites by site name',
    '  --extension-id <id>       Optional. Extension id',
    '  --cdp-endpoint <url>      Optional. Chrome CDP endpoint, default http://127.0.0.1:9222',
    '  --timeout-ms <number>     Optional. Max wait time, default 180000',
    '  --poll-ms <number>        Optional. Poll interval, default 5000',
    '  --min-chars <number>      Optional. Ready threshold for content length, default 20',
    '  --stable-rounds <number>  Optional. Stable rounds before finish, default 2',
    '  --wait-iframes-ms <num>   Optional. Wait for iframe initialization, default 20000',
    '  --help                    Show this help'
  ].join('\n');

  process.stdout.write(`${usage}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    throw new Error('Missing required --query');
  }

  const sites = parseSites(args.sites || '');
  const extensionId = args['extension-id']
    || process.env.AI_COMPARE_EXTENSION_ID
    || process.env.EXTENSION_ID
    || 'hhkhgpadepocnmjfpohcmjdcgkmfnadi';

  const cdpEndpoint = args['cdp-endpoint']
    || process.env.AI_COMPARE_CDP_ENDPOINT
    || process.env.OPENCLAW_CDP_ENDPOINT
    || 'http://127.0.0.1:9222';

  const timeoutMs = Math.max(1000, asNumber(args['timeout-ms'], 180000));
  const pollMs = Math.max(500, asNumber(args['poll-ms'], 5000));
  const minChars = Math.max(1, asNumber(args['min-chars'], 20));
  const stableRounds = Math.max(0, asNumber(args['stable-rounds'], 2));
  const waitIframesMs = Math.max(0, asNumber(args['wait-iframes-ms'], 20000));
  const browser = await connectToBrowser(cdpEndpoint);
  const context = await getPersistentContext(browser);
  const page = await context.newPage();

  try {
    const url = buildExtensionUrl(extensionId, query, sites);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await page.waitForFunction(
      () => typeof window.aiCompareOpenClaw?.run === 'function',
      { timeout: 30000 }
    );

    const result = await page.evaluate(async (payload) => {
      return window.aiCompareOpenClaw.run(payload);
    }, {
      query,
      sites,
      timeoutMs,
      pollIntervalMs: pollMs,
      minChars,
      stableRounds,
      waitForIframesMs: waitIframesMs,
      forceRun: false
    });

    process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
  } finally {
    try {
      await page.close();
    } catch (_) {
      // ignore close errors
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    const payload = {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  asNumber,
  parseSites,
  buildExtensionUrl,
  parseRemoteDebuggingPort,
  connectToBrowser,
  getPersistentContext,
  main
};
