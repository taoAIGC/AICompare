#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const websiteDir = path.join(repoRoot, 'website');
const pageConfigPath = path.join(websiteDir, 'seo', 'pages.json');
const sitemapPath = path.join(websiteDir, 'sitemap.xml');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function pagePathToFile(pagePath) {
  if (pagePath === '/') return path.join(websiteDir, 'index.html');
  if (pagePath.endsWith('/')) return path.join(websiteDir, pagePath, 'index.html');
  return path.join(websiteDir, pagePath);
}

function pageUrl(baseUrl, pagePath) {
  return `${baseUrl.replace(/\/$/, '')}${pagePath.startsWith('/') ? pagePath : `/${pagePath}`}`;
}

function getTag(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
}

function getMetaDescription(html) {
  const match = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  return match ? match[1].trim() : '';
}

function getCanonical(html) {
  const match = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
  return match ? match[1].trim() : '';
}

function getHreflangs(html) {
  return [...html.matchAll(/<link\s+rel="alternate"\s+hreflang="([^"]+)"\s+href="([^"]+)"/gi)]
    .map((match) => ({ hreflang: match[1], href: match[2] }));
}

function localHrefExists(filePath, href) {
  if (!href.startsWith('.')) return true;
  if (href.startsWith('mailto:')) return true;
  const cleanHref = href.split('#')[0].split('?')[0];
  if (!cleanHref) return true;
  const target = path.normalize(path.join(path.dirname(filePath), cleanHref));
  const candidate = cleanHref.endsWith('/') ? path.join(target, 'index.html') : target;
  return fs.existsSync(candidate);
}

function audit() {
  const errors = [];
  const warnings = [];
  const pageConfig = readJson(pageConfigPath);
  const baseUrl = pageConfig.baseUrl;
  const sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const allRegisteredUrls = [];

  for (const page of pageConfig.pages) {
    const localeEntries = Object.entries(page.availableLocales || {});
    const expectedHreflangCount = localeEntries.length + 1;

    for (const [locale, pagePath] of localeEntries) {
      const filePath = pagePathToFile(pagePath);
      const url = pageUrl(baseUrl, pagePath);
      allRegisteredUrls.push(url);

      if (!fs.existsSync(filePath)) {
        errors.push(`${page.id}/${locale}: missing file ${filePath}`);
        continue;
      }

      const html = fs.readFileSync(filePath, 'utf8');
      const title = getTag(html, 'title');
      const h1 = getTag(html, 'h1');
      const description = getMetaDescription(html);
      const canonical = getCanonical(html);
      const hreflangs = getHreflangs(html);

      if (!title) errors.push(`${filePath}: missing <title>`);
      if (title.length > 70) warnings.push(`${filePath}: title is long (${title.length} chars)`);
      if (!description) errors.push(`${filePath}: missing meta description`);
      if (description.length > 170) warnings.push(`${filePath}: meta description is long (${description.length} chars)`);
      if (!h1) errors.push(`${filePath}: missing h1`);
      if (canonical !== url) errors.push(`${filePath}: canonical mismatch. Expected ${url}, got ${canonical || 'none'}`);
      if (!sitemap.includes(`<loc>${url}</loc>`)) errors.push(`${filePath}: URL missing from sitemap`);
      if (hreflangs.length !== expectedHreflangCount) {
        errors.push(`${filePath}: expected ${expectedHreflangCount} hreflang links, got ${hreflangs.length}`);
      }

      const localHrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
      for (const href of localHrefs) {
        if (!localHrefExists(filePath, href)) {
          errors.push(`${filePath}: broken local href ${href}`);
        }
      }

      const images = [...html.matchAll(/<img\b([^>]*)>/gi)];
      for (const image of images) {
        if (!/\salt="[^"]+"/i.test(image[1])) {
          errors.push(`${filePath}: image missing alt text`);
        }
      }
    }
  }

  for (const url of allRegisteredUrls) {
    const count = (sitemap.match(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (count === 0) errors.push(`sitemap: missing registered URL ${url}`);
  }

  if (warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of warnings) console.log(`- ${warning}`);
  }

  if (errors.length > 0) {
    console.error('SEO audit failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`SEO audit passed for ${pageConfig.pages.length} page groups and ${allRegisteredUrls.length} localized URLs.`);
}

audit();
