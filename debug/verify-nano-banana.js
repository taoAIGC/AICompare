#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function normalizeSiteMatchPath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function resolveSiteForUrl(sites, iframeUrl, preferredSiteName = null) {
  let currentUrl;
  try {
    currentUrl = new URL(iframeUrl);
  } catch (_) {
    return null;
  }

  const currentDomain = currentUrl.hostname;
  const currentPath = normalizeSiteMatchPath(currentUrl.pathname || '/');

  const matches = (sites || []).map((site) => {
    if (!site || !site.url || site.hidden) return null;

    try {
      const siteUrl = new URL(site.url);
      const siteDomain = siteUrl.hostname;
      const domainMatched =
        currentDomain === siteDomain ||
        currentDomain.includes(siteDomain) ||
        siteDomain.includes(currentDomain);

      if (!domainMatched) return null;

      const preferredNameMatched = preferredSiteName && site.name === preferredSiteName;
      const sitePath = normalizeSiteMatchPath(siteUrl.pathname || '/');
      let pathScore = 0;

      if (currentPath === sitePath) {
        pathScore = 400 + sitePath.length;
      } else if (sitePath !== '/' && currentPath.startsWith(sitePath + '/')) {
        pathScore = 300 + sitePath.length;
      } else if (preferredNameMatched) {
        pathScore = 200;
      } else if (sitePath === '/') {
        pathScore = 100;
      } else {
        return null;
      }

      return {
        site,
        score:
          (preferredNameMatched ? 1000 : 0) +
          (currentDomain === siteDomain ? 100 : 50) +
          pathScore
      };
    } catch (_) {
      return null;
    }
  }).filter(Boolean);

  matches.sort((a, b) => b.score - a.score);
  return matches[0]?.site || null;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const configPath = path.join(__dirname, '..', 'config', 'siteHandlers.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const sites = Array.isArray(config?.sites) ? config.sites : [];

  const nano = sites.find((site) => site.name === 'Nano Banana');
  assert(nano, 'Missing Nano Banana site config');
  assert(nano.enabled === true, 'Nano Banana must stay enabled');
  assert(nano.type === 'image', 'Nano Banana type must be image');
  assert(nano.searchHandler?.steps?.length > 0, 'Nano Banana searchHandler is missing');
  assert(nano.fileUploadHandler?.steps?.length > 0, 'Nano Banana fileUploadHandler is missing');

  const cases = [
    {
      label: 'base flow page',
      url: 'https://labs.google/fx/zh/tools/flow',
      preferredSiteName: 'Nano Banana'
    },
    {
      label: 'project page with original locale path',
      url: 'https://labs.google/fx/zh/tools/flow/project/abc123',
      preferredSiteName: 'Nano Banana'
    },
    {
      label: 'project page without locale segment',
      url: 'https://labs.google/fx/tools/flow/project/abc123',
      preferredSiteName: 'Nano Banana'
    },
    {
      label: 'project page with different locale segment',
      url: 'https://labs.google/fx/en/tools/flow/project/abc123',
      preferredSiteName: 'Nano Banana'
    }
  ];

  const results = cases.map((testCase) => {
    const matched = resolveSiteForUrl(sites, testCase.url, testCase.preferredSiteName);
    return {
      ...testCase,
      matchedName: matched?.name || null
    };
  });

  for (const result of results) {
    assert(
      result.matchedName === 'Nano Banana',
      `Expected Nano Banana for ${result.label}, got ${result.matchedName || 'null'}`
    );
  }

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    site: {
      name: nano.name,
      enabled: nano.enabled,
      type: nano.type,
      url: nano.url
    },
    results
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || String(error));
  process.exit(1);
}
