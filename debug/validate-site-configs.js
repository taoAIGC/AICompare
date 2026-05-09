#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const REQUIRED_TOP_LEVEL_FIELDS = [
  'name',
  'url',
  'enabled',
  'supportUrlQuery',
  'region',
  'hidden',
  'supportIframe',
  'searchHandler',
  'icon',
  'type'
];

const SEARCH_STEP_ACTIONS_WITHOUT_SELECTOR = new Set(['wait', 'custom', 'paste']);
const FILE_STEP_ACTIONS_WITHOUT_SELECTOR = new Set(['wait', 'paste']);
const DEEP_RESEARCH_STEP_ACTIONS_WITHOUT_SELECTOR = new Set(['wait', 'custom', 'paste']);
const IFRAME_FALSE_NOTE_PATTERNS = [/不能走 iframe/i, /不可嵌入/i, /sameorigin/i, /frame-ancestors/i];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function collectVerifierNames(debugDir) {
  const result = [];
  for (const file of fs.readdirSync(debugDir)) {
    if (!/^verify-.*-live\.js$/.test(file)) continue;
    const fullPath = path.join(debugDir, file);
    const text = fs.readFileSync(fullPath, 'utf8');
    const singleMatch = text.match(/const SITE_NAME = '([^']+)'/);
    const pluralMatch = text.match(/const SITE_NAMES = \[([\s\S]*?)\]/);
    let siteNames = [];
    if (singleMatch) {
      siteNames = [singleMatch[1]];
    } else if (pluralMatch) {
      siteNames = Array.from(pluralMatch[1].matchAll(/'([^']+)'/g)).map((match) => match[1]);
    }
    result.push({
      file,
      siteNames
    });
  }
  return result;
}

function validateSteps(siteName, handlerName, steps, issues) {
  if (!Array.isArray(steps) || steps.length === 0) {
    issues.push(`[${handlerName}] ${siteName}: steps missing or empty`);
    return;
  }

  for (const [index, step] of steps.entries()) {
    if (!step || typeof step !== 'object') {
      issues.push(`[${handlerName}] ${siteName}#${index + 1}: invalid step object`);
      continue;
    }

    if (!step.action) {
      issues.push(`[${handlerName}] ${siteName}#${index + 1}: missing action`);
    }

    const allowNoSelector = handlerName === 'searchHandler'
      ? SEARCH_STEP_ACTIONS_WITHOUT_SELECTOR.has(step.action)
      : handlerName === 'deepResearchHandler'
        ? DEEP_RESEARCH_STEP_ACTIONS_WITHOUT_SELECTOR.has(step.action)
        : FILE_STEP_ACTIONS_WITHOUT_SELECTOR.has(step.action);
    if (!allowNoSelector && !step.selector) {
      issues.push(`[${handlerName}] ${siteName}#${index + 1}: missing selector for action ${step.action}`);
    }

    if (!step.description) {
      issues.push(`[${handlerName}] ${siteName}#${index + 1}: missing description`);
    }
  }
}

function main() {
  const repoRoot = path.join(__dirname, '..');
  const configPath = path.join(repoRoot, 'config', 'siteHandlers.json');
  const debugDir = path.join(repoRoot, 'debug');
  const config = readJson(configPath);
  const sites = Array.isArray(config?.sites) ? config.sites : [];
  const issues = [];

  const names = sites.map((site) => site?.name).filter(Boolean);
  const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicateNames.length > 0) {
    issues.push(`[duplicate-name] ${Array.from(new Set(duplicateNames)).join(', ')}`);
  }

  for (const site of sites) {
    const siteName = site?.name || '<missing-name>';

    for (const key of REQUIRED_TOP_LEVEL_FIELDS) {
      if (!(key in site)) {
        issues.push(`[missing-top] ${siteName}: ${key}`);
      }
    }

    if (site.searchHandler) {
      validateSteps(siteName, 'searchHandler', site.searchHandler.steps, issues);
    }

    if (site.fileUploadHandler) {
      validateSteps(siteName, 'fileUploadHandler', site.fileUploadHandler.steps, issues);
    }

    if (site.deepResearchHandler) {
      const enabledSelectors = Array.isArray(site.deepResearchHandler.enabledSelectors)
        ? site.deepResearchHandler.enabledSelectors.map((selector) => String(selector || '').trim()).filter(Boolean)
        : [];

      if (!enabledSelectors.length) {
        issues.push(`[deepResearchHandler] ${siteName}: enabledSelectors missing or empty`);
      }

      validateSteps(siteName, 'deepResearchHandler', site.deepResearchHandler.steps, issues);
    }

    const note = String(site.note || '');
    if (IFRAME_FALSE_NOTE_PATTERNS.some((pattern) => pattern.test(note)) && site.supportIframe !== false) {
      issues.push(`[iframe-drift] ${siteName}: note indicates iframe should be false, got ${site.supportIframe}`);
    }
  }

  const verifierNames = collectVerifierNames(debugDir);
  const configNames = new Set(names);
  for (const verifier of verifierNames) {
    if (!Array.isArray(verifier.siteNames) || verifier.siteNames.length === 0) {
      issues.push(`[verifier-name] ${verifier.file}: SITE_NAME or SITE_NAMES not found`);
      continue;
    }
    for (const siteName of verifier.siteNames) {
      if (!configNames.has(siteName)) {
        issues.push(`[verifier-name] ${verifier.file}: SITE_NAME ${siteName} not found in config`);
      }
    }
  }

  const payload = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    siteCount: sites.length,
    verifierCount: verifierNames.length,
    issues
  };

  console.log(JSON.stringify(payload, null, 2));
  process.exit(issues.length === 0 ? 0 : 1);
}

main();
