# Entry URL and Custom Sites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `@superpowers:using-git-worktrees` before editing, then implement task-by-task with `@superpowers:executing-plans`. If the user explicitly asks for parallel help, switch to `@superpowers:subagent-driven-development`.

**Goal:** Let users long-term override official site launch URLs and add a separate custom-site list that only opens pages.

**Architecture:** Keep official sites in `config/siteHandlers.json` and store per-site launch overrides in the existing `chrome.storage.sync.sites[siteName]` object. Put custom sites in a separate `chrome.storage.sync.customSites` array and route them through a shared launch resolver so homepage, iframe, and external-search entry points all agree on the same URL rules.

**Tech Stack:** Vanilla JavaScript, Chrome Extension MV3, `chrome.storage.sync/local`, existing homepage/iframe/options pages, Node verifier scripts.

---

## File Structure

- `shared/site-launch-utils.js`: pure launch-resolution helpers and storage normalizers.
- `debug/verify-entry-url-custom-sites.js`: Node contract check for the resolver behavior.
- `config/baseConfig.js`: merge official-site `entryUrl` overrides into loaded site objects.
- `background.js`: route official/custom launch targets and apply the shared resolver.
- `homepage/homepage.html` and `homepage/homepage.js`: render and submit custom sites alongside official ones.
- `iframe/iframe.html` and `iframe/iframe.js`: keep iframe compare flow aligned with the same launch rules.
- `options/options.html` and `options/options.js`: edit official `entryUrl` overrides and manage `customSites`.
- `firebase/firebase-sync.js`: sync `customSites` with the rest of the user settings.
- `_locales/*/messages.json`: add all new UI copy keys.
- `README.md`: document the new behavior in English and Chinese.

## Scope Guardrails

- Do not move `customSites` into `config/siteHandlers.json`.
- Do not let `customSites` into `searchHandler`, `userPrompt`, `contentExtractor`, or `historyHandler`.
- Do not touch `content-scripts/float-button.js`, `content-scripts/selection.js`, or `config/siteDetector.js` unless a smoke test shows leakage into those flows.

### Task 1: Create the shared launch resolver and a failing contract check

**Files:**
- Create: `shared/site-launch-utils.js`
- Create: `debug/verify-entry-url-custom-sites.js`
- Modify: `background.js`
- Modify: `homepage/homepage.html`
- Modify: `iframe/iframe.html`
- Modify: `options/options.html`

- [ ] **Step 1: Write the contract check first**

Create `debug/verify-entry-url-custom-sites.js` with assertions for these cases:
- official site with `entryUrl` containing `{query}`
- official site with `entryUrl` without `{query}`
- custom site ignoring query text and returning a plain open-only URL

- [ ] **Step 2: Run the verifier before the helper exists**

Run: `node debug/verify-entry-url-custom-sites.js`

Expected: fail because `shared/site-launch-utils.js` is not implemented yet.

- [ ] **Step 3: Implement the shared helper**

Create `shared/site-launch-utils.js` as a UMD/global helper with functions like:
- `normalizeEntryUrl`
- `resolveOfficialLaunchTarget`
- `resolveCustomLaunchTarget`
- `normalizeCustomSites`
- `loadCustomSites`

Make it work both in browser globals and via `require()` so the Node verifier can import it.

- [ ] **Step 4: Load the helper everywhere launch resolution happens**

Add the helper script before the page-specific logic in homepage, iframe, and options HTML, and `importScripts()` it from `background.js`.

- [ ] **Step 5: Re-run the verifier**

Run: `node debug/verify-entry-url-custom-sites.js`

Expected: pass with all resolver cases green.

### Task 2: Merge official-site `entryUrl` overrides into the existing site data flow

**Files:**
- Modify: `config/baseConfig.js`
- Modify: `background.js`
- Modify: `iframe/iframe.js`

- [ ] **Step 1: Carry `entryUrl` through merged official sites**

Extend the existing official-site merge so each returned site can include `entryUrl` from `chrome.storage.sync.sites[siteName]` without breaking `enabled` or `order`.

- [ ] **Step 2: Switch launch code to the shared resolver**

Update `handleSingleSiteSearch`, `openSearchTabs`, and the iframe launch path to call `resolveOfficialLaunchTarget()` instead of hard-coding `site.url`.

- [ ] **Step 3: Keep the old URL-template behavior as fallback only**

Preserve `supportUrlQuery` for base-config fallback, but let `entryUrl` win whenever the user has set one.

- [ ] **Step 4: Smoke-check the official path**

Run: `node debug/validate-site-configs.js`

Expected: pass, with no accidental changes to the official config shape.

### Task 3: Add official-site `entryUrl` editing in options

**Files:**
- Modify: `options/options.html`
- Modify: `options/options.js`
- Modify: `_locales/ar/messages.json`
- Modify: `_locales/de/messages.json`
- Modify: `_locales/en/messages.json`
- Modify: `_locales/es/messages.json`
- Modify: `_locales/fr/messages.json`
- Modify: `_locales/ja/messages.json`
- Modify: `_locales/ko/messages.json`
- Modify: `_locales/pt_BR/messages.json`
- Modify: `_locales/zh_CN/messages.json`
- Modify: `_locales/zh_TW/messages.json`

- [ ] **Step 1: Add a launch-settings section**

Render every official site with an `entryUrl` input and a reset action in options, using localized labels/placeholders.

- [ ] **Step 2: Save and restore the override**

Persist edits to `chrome.storage.sync.sites[siteName].entryUrl` and reload the current value from storage on page init.

- [ ] **Step 3: Add the new i18n keys**

Add localized copy for labels, placeholders, reset actions, and save/error toasts in every shipped locale file.

- [ ] **Step 4: Manual browser check**

Open `chrome-extension://hhkhgpadepocnmjfpohcmjdcgkmfnadi/options/options.html`, set one official site `entryUrl`, refresh, and confirm the value survives.

### Task 4: Add `customSites` CRUD and wire homepage launch behavior

**Files:**
- Modify: `options/options.html`
- Modify: `options/options.js`
- Modify: `homepage/homepage.html`
- Modify: `homepage/homepage.js`
- Modify: `background.js`
- Modify: `iframe/iframe.js`

- [ ] **Step 1: Add `customSites` storage CRUD**

Build add/edit/delete support for `chrome.storage.sync.customSites` in options. Keep the form minimal: `id`, `name`, `url`, `enabled`, `supportIframe`, `icon`, `note`, `order`.

- [ ] **Step 2: Render `customSites` separately on the homepage**

Add a dedicated custom-sites section to the homepage, keep it outside the official type tabs, and do not let it participate in drag/drop sorting.

- [ ] **Step 3: Route selected custom sites through the launch pipeline**

Extend the `processQuery` payload to include custom-site IDs. Update the background/iframe orchestration so custom sites open pages only, with no `searchHandler` or extraction.

- [ ] **Step 4: Preserve iframe/external splitting**

Treat `customSites.supportIframe === true` as embeddable, otherwise open them externally, but never auto-inject text into them.

- [ ] **Step 5: Manual browser smoke test**

Open the homepage in real Chrome, select one official site plus one custom site, submit a query, and verify:
- the official site still receives the query/automation
- the custom site only opens its page

### Task 5: Sync, docs, and final verification

**Files:**
- Modify: `firebase/firebase-sync.js`
- Modify: `README.md`
- Modify: `debug/verify-entry-url-custom-sites.js` if the resolver cases need one more regression

- [ ] **Step 1: Sync the new user data**

Add `customSites` to the WebDAV import/export and cloud-sync lists so the user’s custom pages survive sync.

- [ ] **Step 2: Document the feature**

Update the English and Chinese README sections to explain:
- official-site `entryUrl` overrides
- `{query}` templating
- `customSites` as page-only entries

- [ ] **Step 3: Re-run the verifier set**

Run:
- `node debug/verify-entry-url-custom-sites.js`
- `node debug/validate-site-configs.js`

Expected: both pass.

- [ ] **Step 4: Finish with a README-safe commit**

Stage the README changes in the same commit as the code/docs changes, then commit with a feature message like `feat: add entryUrl overrides and custom sites`.
