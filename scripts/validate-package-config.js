#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(repoRoot, 'manifest.json');
const packageConfigPath = path.join(__dirname, 'package-extension.config.js');

const { defaultEntries, optionalEntries } = require(packageConfigPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const runtimeRootDirs = new Set([
  '_locales',
  'config',
  'contact',
  'content-scripts',
  'docs/release-notes',
  'favorites',
  'firebase',
  'history',
  'homepage',
  'icons',
  'iframe',
  'options',
  'remote',
  'shared',
  'siteIcons',
  'vendor'
]);

const alwaysAllowedRoots = new Set([
  '.',
  '_metadata',
  'analysis',
  'data',
  'debug',
  'docs',
  'generated',
  'dist',
  'openclaw',
  'openclaw-extension.disabled',
  'presentations',
  'remote-relay',
  'scripts',
  'tests',
  'mobile-app'
]);

const alwaysAllowedTopLevelFiles = new Set([
  'AGENTS.md',
  'AI Compare PrivacyPolicy.md',
  'AIShortcuts.code-workspace',
  'CLAUDE.md',
  'DEVELOPER_GUIDE.md',
  'FIREBASE_SETUP.md',
  'LICENSE',
  'README.md',
  'STRIPE_SETUP.md',
  'manifest.json',
  'background.js'
]);

const runtimeFiles = [
  'manifest.json',
  'background.js',
  'contact/contact.js',
  'favorites/favorites.html',
  'favorites/favorites.js',
  'history/history.html',
  'history/history.js',
  'homepage/homepage.html',
  'homepage/homepage.js',
  'iframe/agent-panel.html',
  'iframe/iframe.html',
  'iframe/iframe.js',
  'options/options.html',
  'options/options.js',
  'shared/sidebar.html',
  'shared/sidebar.js'
];

function normalizeRoot(entry) {
  if (!entry) {
    return '';
  }

  const normalized = entry.replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!normalized) {
    return '';
  }

  const [firstSegment, secondSegment] = normalized.split('/');
  if (firstSegment === 'docs' && secondSegment === 'release-notes') {
    return 'docs/release-notes';
  }

  return firstSegment;
}

function addRoot(target, maybePath) {
  if (typeof maybePath !== 'string') {
    return;
  }

  const trimmed = maybePath.trim();
  if (!trimmed || /^https?:\/\//.test(trimmed) || /^data:/.test(trimmed)) {
    return;
  }

  const normalized = trimmed.replace(/^chrome-extension:\/\/[^/]+\//, '');
  const root = normalizeRoot(normalized);

  if (!root || !runtimeRootDirs.has(root)) {
    return;
  }

  target.add(root);
}

function addManifestPaths(target, value) {
  if (typeof value === 'string') {
    addRoot(target, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      addManifestPaths(target, item);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      addManifestPaths(target, nested);
    }
  }
}

function collectManifestRoots() {
  const roots = new Set(['manifest.json', 'background.js']);
  addManifestPaths(roots, manifest.action);
  addManifestPaths(roots, manifest.icons);
  addManifestPaths(roots, manifest.options_page);
  addManifestPaths(roots, manifest.background);
  addManifestPaths(roots, manifest.content_scripts);
  addManifestPaths(roots, manifest.web_accessible_resources);
  addManifestPaths(roots, manifest.declarative_net_request);
  addManifestPaths(roots, manifest.side_panel);
  return roots;
}

function collectScriptRoots() {
  const roots = new Set();
  const pathRegexes = [
    /chrome\.runtime\.getURL\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /fetch\(\s*chrome\.runtime\.getURL\(\s*['"`]([^'"`]+)['"`]\s*\)\s*\)/g,
    /(?:src|href)=["'](?:\.\.\/)+([^"']+)["']/g,
    /(?:src|href)=["']([^"']+)["']/g,
    /['"`]\.\.\/([^'"`]+)['"`]/g,
    /['"`]\.\/([^'"`]+)['"`]/g
  ];

  for (const relativeFile of runtimeFiles) {
    const fullPath = path.join(repoRoot, relativeFile);
    if (!fs.existsSync(fullPath)) {
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    for (const regex of pathRegexes) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        addRoot(roots, match[1]);
      }
    }
  }

  return roots;
}

function collectPackagedRoots() {
  const packaged = new Set();
  for (const entry of defaultEntries) {
    packaged.add(entry === 'docs/release-notes' ? entry : normalizeRoot(entry));
  }
  return packaged;
}

function collectOptionalPackagedRoots() {
  const optional = new Set();
  for (const entries of Object.values(optionalEntries || {})) {
    for (const entry of entries) {
      optional.add(normalizeRoot(entry));
    }
  }
  return optional;
}

function collectRepoTopLevelNames() {
  return fs.readdirSync(repoRoot).filter((name) => !name.startsWith('.'));
}

const requiredRoots = new Set([
  ...collectManifestRoots(),
  ...collectScriptRoots()
]);

const packagedRoots = collectPackagedRoots();
const optionalPackagedRoots = collectOptionalPackagedRoots();

const missingRoots = [...requiredRoots]
  .filter((root) => root && root !== 'manifest.json' && root !== 'background.js')
  .filter((root) => !packagedRoots.has(root) && !optionalPackagedRoots.has(root))
  .sort();

const suspiciousPackagedRoots = [...packagedRoots]
  .filter((root) => root && root !== 'manifest.json' && root !== 'background.js')
  .filter((root) => !requiredRoots.has(root))
  .sort();

const unknownTopLevelNames = collectRepoTopLevelNames()
  .filter((name) => {
    const fullPath = path.join(repoRoot, name);
    if (fs.statSync(fullPath).isFile()) {
      return !alwaysAllowedTopLevelFiles.has(name);
    }
    return true;
  })
  .filter((name) => !alwaysAllowedRoots.has(name))
  .filter((name) => !packagedRoots.has(name))
  .filter((name) => !optionalPackagedRoots.has(name))
  .filter((name) => runtimeRootDirs.has(name) || name === 'docs')
  .sort();

if (!missingRoots.length && !unknownTopLevelNames.length) {
  const suspiciousNote = suspiciousPackagedRoots.length
    ? ` Optional review: packaged-but-unreferenced roots -> ${suspiciousPackagedRoots.join(', ')}`
    : '';
  console.log(`Package config check passed.${suspiciousNote}`);
  process.exit(0);
}

if (missingRoots.length) {
  console.error('Package config is missing runtime roots:', missingRoots.join(', '));
}

if (unknownTopLevelNames.length) {
  console.error(
    'New top-level paths are not classified for packaging review:',
    unknownTopLevelNames.join(', ')
  );
}

process.exit(1);
