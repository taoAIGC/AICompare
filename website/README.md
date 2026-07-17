# AI比一比 SEO/GEO Website

This directory is a static marketing and SEO/GEO site for AI比一比 / AI Compare.

## Deploy

Serve `website/` as the web root.

Recommended production domain assumption in current files:

```text
https://aicompare.club/
```

If the final domain changes, update:

- `link rel="canonical"` in HTML files
- Open Graph URLs in `index.html`
- `website/sitemap.xml`
- `website/robots.txt`
- `website/llms.txt`

## Included pages

- Home: `/`
- English home: `/en/`
- Japanese home: `/ja/`
- German home: `/de/`
- Spanish home: `/es/`
- GEO method hub: `/geo/`
- GEO checklist: `/geo-checklist/`
- Brand monitoring use case: `/use-cases/brand-monitoring/`
- Content QA use case: `/use-cases/content-qa/`
- Tutorial index and 6 tutorial articles: `/blog/`
- Chrome Web Store copy: `/resources/chrome-store-copy.html`
- Multilingual SEO strategy: `/resources/multilingual-seo-plan.html`
- Execution calendar: `/resources/content-calendar.md`

## Multilingual SEO

The website now has a multilingual SEO mechanism under `website/seo/`.

- `website/seo/locales.json` maps the 55 extension locales to website locale codes and `hreflang` values.
- `website/seo/pages.json` is the page registry. Only published localized pages should be listed in `availableLocales`.
- `website/seo/keyword-matrix.csv` tracks localized SEO intent and priority.
- `website/seo/operating-plan.md` defines the SEO foundation work, daily workflow, weekly review, and publishing rules.
- `website/seo/content-backlog.csv`, `website/seo/daily-log.csv`, and `website/seo/seo-dashboard-template.csv` are the operating trackers.
- `scripts/generate-website-seo.js` regenerates page `canonical`/`hreflang` blocks and `website/sitemap.xml`.
- `scripts/audit-website-seo.js` checks registered pages for basic SEO and internal-link issues.

Run from the repository root:

```sh
node scripts/generate-website-seo.js
node scripts/audit-website-seo.js
```

## Notes

The site is intentionally static and does not require a build step. Product screenshots currently reuse existing assets from `presentations/`.
