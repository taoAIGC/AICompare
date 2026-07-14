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
- `scripts/generate-website-seo.js` regenerates page `canonical`/`hreflang` blocks and `website/sitemap.xml`.

Run from the repository root:

```sh
node scripts/generate-website-seo.js
```

## Notes

The site is intentionally static and does not require a build step. Product screenshots currently reuse existing assets from `presentations/`.
