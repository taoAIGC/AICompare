#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

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

function buildRunnerArgs(args) {
  const runnerArgs = [
    path.join(__dirname, 'ai-compare-openclaw-runner.cjs'),
    '--mode', 'gui',
    '--query', String(args.query || ''),
    '--wait-results-ms', '90000',
    '--timeout-ms', '60000',
    '--site-timeout-ms', '60000',
    '--poll-ms', '5000',
    '--min-chars', '20',
    '--stable-rounds', '2',
    '--wait-iframes-ms', '20000'
  ];

  if (typeof args.sites === 'string' && args.sites.trim()) {
    runnerArgs.push('--sites', args.sites.trim());
  }

  if (typeof args['extension-id'] === 'string' && args['extension-id'].trim()) {
    runnerArgs.push('--extension-id', args['extension-id'].trim());
  }

  if (typeof args['browser-app'] === 'string' && args['browser-app'].trim()) {
    runnerArgs.push('--browser-app', args['browser-app'].trim());
  } else if (process.platform === 'darwin') {
    runnerArgs.push('--browser-app', 'Google Chrome');
  }

  if (args['print-only']) {
    runnerArgs.push('--print-only');
  }

  if (args['open-only']) {
    runnerArgs.push('--open-only');
  }

  return runnerArgs;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const query = typeof args.query === 'string' ? args.query.trim() : '';

  if (!query) {
    process.stderr.write('Missing required --query\n');
    process.exit(1);
  }

  const result = spawnSync(process.execPath, buildRunnerArgs(args), {
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(typeof result.status === 'number' ? result.status : 1);
}

main();
