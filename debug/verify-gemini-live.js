#!/usr/bin/env node

const { runExtensionFlowCheck } = require('./extension-flow-common');

const SITE_NAME = 'Gemini';
const TEST_QUERY = process.env.TEST_QUERY || '你好世界';

async function main() {
  const payload = await runExtensionFlowCheck({
    siteName: SITE_NAME,
    query: TEST_QUERY,
    timeoutMs: Number(process.env.TIMEOUT_MS || 90000),
    pollMs: Number(process.env.POLL_MS || 3000),
    minChars: Number(process.env.MIN_CHARS || 20),
    stableRounds: Number(process.env.STABLE_ROUNDS || 2),
    waitForIframesMs: Number(process.env.WAIT_FOR_IFRAMES_MS || 20000),
    reloadExtension: process.env.RELOAD_EXTENSION === '1'
  });

  const output = JSON.stringify(payload, null, 2);
  if (!payload.ok) {
    console.error(output);
    process.exit(1);
  }
  console.log(output);
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
