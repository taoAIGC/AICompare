# AI Compare SEO Operating Plan

This is the working SEO plan for the official website. It separates foundation work from daily execution so the site can grow without relying on ad-hoc content ideas.

## Current Objective

Make the official website rank and convert for three demand layers:

1. Product demand: users looking for an AI comparison tool, AI Chrome extension, or a faster way to use multiple AI tools.
2. Workflow demand: users trying to compare AI answers, cross-check research, validate writing, debug with AI, or translate with multiple AI tools.
3. GEO demand: users trying to understand whether AI systems correctly recognize their content, brand, or product pages.

## Baseline Work To Complete Now

### 1. Technical SEO foundation

- Keep `website/seo/pages.json` as the source of truth for published page URLs and locales.
- Run `node scripts/generate-website-seo.js` after every page or locale change.
- Run `node scripts/audit-website-seo.js` before shipping website changes.
- Keep `website/sitemap.xml` generated, not hand-edited.
- Keep `website/robots.txt` pointing at `https://aicompare.club/sitemap.xml`.
- Do not add translated URLs to `availableLocales` until the localized page is real and reviewable.

### 2. Product homepage foundation

- Homepage should stay product-first:
  - What AI Compare is.
  - Why comparing AI answers matters.
  - Core features.
  - Use cases.
  - Install CTA.
  - Resource links after the product story.
- GEO, SEO, and multilingual SEO content should live in the resource/tutorial layer, not dominate the homepage.

### 3. Multilingual foundation

- Current published homepage locales:
  - `zh-CN`: `/`
  - `en`: `/en/`
  - `ja`: `/ja/`
  - `de`: `/de/`
  - `es`: `/es/`
- Next priority locales:
  - `zh-TW`
  - `ko`
  - `fr`
  - `pt-BR`
  - `ru`
  - `ar`
- For each new locale, publish the homepage first, then the install/use page, then one high-intent resource page.

### 4. Content foundation

Build content in clusters instead of isolated posts:

- Cluster A: AI comparison tool
- Cluster B: AI Chrome extension
- Cluster C: compare ChatGPT / Claude / Gemini / DeepSeek / Kimi
- Cluster D: AI answer quality and cross-checking
- Cluster E: GEO and AI visibility
- Cluster F: multilingual SEO for AI and browser-extension products

### 5. Measurement foundation

Track weekly:

- Google Search Console impressions, clicks, CTR, and average position.
- Queries landing on the homepage versus resources.
- Chrome Web Store clicks from website CTAs.
- Install conversion events if analytics are available.
- Pages ranking in positions 4-10, because these are the easiest optimization targets.
- Queries that appear in Search Console but are missing from `keyword-matrix.csv`.

## Daily SEO Workflow

### Every day, 30-45 minutes

1. Check one SEO health signal.
   - Run `node scripts/audit-website-seo.js`.
   - Confirm no broken internal links, missing H1, missing description, or sitemap mismatch.

2. Improve one existing page.
   - Add one FAQ.
   - Improve one title or meta description.
   - Add one internal link.
   - Improve one CTA.
   - Add or improve image alt text.

3. Advance one keyword.
   - Pick one row from `website/seo/content-backlog.csv`.
   - Either draft, publish, translate, or update the page tied to that keyword.

4. Capture one distribution asset.
   - Turn one paragraph into a short post for X, Zhihu, Xiaohongshu, Jike, LinkedIn, or a newsletter.
   - Link back to the most relevant official page.

5. Record what changed.
   - Update `website/seo/daily-log.csv`.
   - Note page, keyword, action, and next step.

### Every week, 60-90 minutes

1. Review Search Console query data.
2. Move discovered queries into `keyword-matrix.csv`.
3. Pick the next 3 pages to improve.
4. Pick the next 2 pages to create.
5. Pick the next 1 locale to localize.
6. Check whether homepage messaging still matches the product.

## Priority Roadmap

### Week 1

- Finish technical validation script.
- Keep homepage product-first across all published homepage locales.
- Add one English resource page: AI comparison tool guide.
- Add one Chinese resource page: AI 对比工具使用场景.

### Week 2

- Publish English GEO overview page.
- Publish English AI comparison tutorial page.
- Add Korean or French homepage.
- Improve internal links from blog and resource pages back to the homepage.

### Week 3

- Publish comparison pages:
  - ChatGPT vs Claude vs Gemini
  - DeepSeek vs Kimi vs Doubao
  - AI Compare vs opening multiple AI tabs manually
- Add install-focused page for Chrome extension queries.

### Week 4

- Localize the top-performing page into two more languages.
- Refresh old GEO articles with product-first CTAs.
- Review CTR and rewrite low-CTR titles.

## Publishing Rules

- Publish only pages that answer a real search intent.
- Do not publish thin translated copies.
- Every SEO page needs:
  - one primary keyword,
  - one conversion goal,
  - one clear CTA,
  - at least two internal links,
  - a unique title and description,
  - a canonical URL,
  - generated hreflang when localized.

## Definition Of Done

A page is done only when:

- It is listed in `website/seo/pages.json`.
- `node scripts/generate-website-seo.js` has been run.
- `node scripts/audit-website-seo.js` passes.
- It has a row in `website/seo/keyword-matrix.csv`.
- It has at least one internal link pointing to it.
- It has a clear install, tutorial, or resource CTA.
