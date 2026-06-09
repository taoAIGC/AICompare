#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const repoRoot = path.join(__dirname, '..');
  const configPath = path.join(repoRoot, 'config', 'siteHandlers.json');
  const iconPath = path.join(repoRoot, 'siteIcons', 'dots.ai.png');
  const sendButtonSelector =
    'button[aria-disabled]:has(svg path[d="m5 12 7-7 7 7"]):has(svg path[d="M12 19V5"])';
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const sites = Array.isArray(config?.sites) ? config.sites : [];
  const site = sites.find((item) => item?.name === '点点');

  assert(site, 'Missing 点点 / dots.ai site config');
  assert(site.url === 'https://dots.ai/', `Unexpected dots.ai url: ${site.url}`);
  assert(site.enabled === false, 'dots.ai should stay conservative-default disabled for now');
  assert(site.hidden === false, 'dots.ai should be visible in the site list now that it has a real adapter');
  assert(site.supportUrlQuery === false, 'dots.ai must not claim URL query support');
  assert(site.supportIframe === true, 'dots.ai should expose iframe support after live validation');
  assert(site.icon === 'dots.ai.png', `Unexpected dots.ai icon: ${site.icon}`);
  assert(site.type === 'information', `Unexpected dots.ai type: ${site.type}`);
  assert(Array.isArray(site.searchHandler?.steps), 'dots.ai searchHandler.steps must exist');
  assert(site.searchHandler.steps.length >= 5, 'dots.ai should have a real multi-step searchHandler');
  assert(
    site.searchHandler.steps[0]?.selector === 'textarea[placeholder="给点点发消息"], textarea[placeholder="给点点发消息..."]',
    'dots.ai should focus the verified textarea selector first'
  );
  assert(
    site.searchHandler.steps[site.searchHandler.steps.length - 1]?.selector === sendButtonSelector,
    'dots.ai should click the verified lower-right send button'
  );
  assert(site.userPrompt?.containerSelector === '.user-message-item', 'dots.ai userPrompt selector mismatch');
  assert(site.userPrompt?.textSelector === '.user-message-card .select-text', 'dots.ai userPrompt text selector mismatch');
  assert(site.contentExtractor?.messageContainer === '.assistant-message-item', 'dots.ai assistant container selector mismatch');
  assert(Array.isArray(site.contentExtractor?.contentSelectors), 'dots.ai contentSelectors missing');
  assert(site.contentExtractor.contentSelectors.includes('.prose-dd'), 'dots.ai should extract .prose-dd answer content');
  assert(site.historyHandler?.urlFeature === '/chat/home/', 'dots.ai history url feature mismatch');
  assert(fs.existsSync(iconPath), 'dots.ai icon asset is missing');

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    site: {
      name: site.name,
      url: site.url,
      enabled: site.enabled,
      hidden: site.hidden,
      supportUrlQuery: site.supportUrlQuery,
      supportIframe: site.supportIframe,
      icon: site.icon,
      type: site.type
    },
    firstStep: site.searchHandler.steps[0],
    lastStep: site.searchHandler.steps[site.searchHandler.steps.length - 1]
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || String(error));
  process.exit(1);
}
