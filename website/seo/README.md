# Multilingual SEO system

This folder is the source of truth for the website SEO/GEO publishing mechanism.

## What it supports

- 55 website locale targets aligned with the extension `_locales/` folders.
- BCP-47 `hreflang` values for Google/Bing.
- Per-page locale availability, so unpublished translations are not added to the sitemap.
- Generated `canonical`, `alternate hreflang`, `x-default`, and XML sitemap entries.
- A keyword matrix for localized keyword planning.

## Files

- `locales.json`: supported website locales, mapped to Chrome extension locale folders.
- `pages.json`: canonical page registry and the locale versions that are actually published.
- `keyword-matrix.csv`: working SEO keyword matrix by page and locale.
- `scripts/generate-website-seo.js`: generator that updates HTML SEO blocks and `website/sitemap.xml`.

## Generate SEO metadata

From the repository root:

```sh
node scripts/generate-website-seo.js
```

To generate for another domain:

```sh
WEBSITE_BASE_URL=https://example.com node scripts/generate-website-seo.js
```

## Add a new localized page

1. Create the localized HTML page, for example `website/en/index.html`.
2. Add the page path to `website/seo/pages.json`:

```json
{
  "id": "home",
  "availableLocales": {
    "zh-CN": "/",
    "en": "/en/"
  }
}
```

3. Run:

```sh
node scripts/generate-website-seo.js
```

The script will add `hreflang="zh-CN"`, `hreflang="en"`, and `x-default` to both pages and include both URLs in the sitemap.

## Publishing rule

Do not add a locale to `availableLocales` until the page has real localized title, description, headings, body copy, CTA, image alt text, and FAQ content. Machine translation can be a draft source, but published SEO pages should be reviewed for search intent and product terminology.
