# Hybrid Site + Skill Test Log

Date: 2026-05-16

## Scope

This file records implementation verification for the hybrid site + skill compare feature.

## Status

- `planning`: complete
- `implementation`: in progress
- `manual QA`: in progress
- `bug fixing`: in progress
- `final pass`: pending

## 2026-05-18 Skill Import Follow-up

- `shared/agent-prompt-utils.js` now reads bundled defaults from `config/agentEngineConfig.js`, with official API upstream routing handled by the cloud endpoint.
- `shared/agent-prompt-utils.js` still recognizes the previously broken Ark + `glm-5.1` bundled fallback as legacy official config instead of promoting it to custom API settings.
- `config/agentEngineConfig.js` no longer stores a bundled official API key, upstream base URL, or model.
- Built-in skill engine defaults are now centralized in `config/agentEngineConfig.js`, while official runtime upstream details live behind the cloud API.
- Skill system prompt assembly is now single-source: only each skill's own `personaPrompt` is sent as the system prompt.
- Imported skill descriptions now keep the full frontmatter description, or a longer first-body summary instead of truncating to one short line.
- Skill HTTP failures now surface cleaner messages such as `HTTP 401: The API key format is incorrect` instead of dumping the whole raw JSON body.
- Added dedicated real-extension verifier:
  - `node debug/verify-agent-import-runtime-playwright.js`
  - Covers built-in API config, GitHub skill import, imported description, panel open, and first skill reply.

## 2026-05-20 Built-in Skill Delete Support

- Built-in skills now show the same delete icon as custom skills in Settings.
- Deleting a built-in skill now writes its id into local storage key `agentHiddenIds` instead of mutating the bundled catalog.
- Hidden built-in skills are now filtered consistently in:
  - Settings skill list
  - homepage skill selection
  - iframe skill catalog returned from background
- Local backup, WebDAV sync, and Google Drive sync payloads now include `agentHiddenIds`, so the hidden state survives export/import and sync restore.
- Static validation completed with:
  - `node --check config/agentCatalog.js`
  - `node --check options/options.js`
  - `node --check background.js`

### 2026-05-18 Built-in Skill Engine Config Verification

- Config source:
  - `config/agentEngineConfig.js`
- Runtime wiring:
  - `background.js` now seeds bundled defaults from the config file.
  - `shared/agent-prompt-utils.js` now reads bundled defaults from the config file instead of embedding literal runtime values.
  - `debug/verify-agent-import-runtime-playwright.js` now uses the same config file by default, instead of pre-seeding hardcoded values.
- Commands:
  - `node --check shared/agent-prompt-utils.js`
  - `node --check background.js`
  - `node --check options/options.js`
  - `node --check iframe/iframe.js`
  - `node --check debug/verify-agent-import-runtime-playwright.js`
  - `node debug/verify-agent-import-runtime-playwright.js`
- Result:
  - pass
- Verified outcome:
  - Imported URL: `https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me`
  - Imported title: `grill-me`
  - Imported description remained complete
  - `usedBuiltInAgentEngine`: `true`
  - Skill panel produced a real assistant reply through the official cloud API path

## Test Matrix

### Homepage

- [x] sites and skills render together
- [x] category selection works
- [x] zero-selection submit blocked
- [x] i18n copy renders correctly

### Live Compare

- [x] mixed panels render
- [x] global submit reaches all enabled panels
- [x] local skill submit only affects that skill
- [x] close removes panel
- [x] reopen creates fresh empty panel
- [x] reopen does not auto-replay prior questions
- [ ] site panel still works as before

### Skill Runtime

- [x] API settings save/load
- [x] background request succeeds
- [x] stream updates render
- [x] cancel / replace request works
- [x] error state isolated to failed skill panel

### History

- [x] each global submit creates a new history session
- [x] history list shows summary cards
- [x] history detail opens in read-only mode
- [x] skill full read-only conversation visible
- [x] read-only history timeline can open copy preview again
- [x] read-only history copy preview can build copyable merged text again
- [x] submit from read-only history starts a fresh live compare

## Bug Log

### Open

- `manual-browser-qa-blocked`: local Chrome remote debugging smoke path did not stay attached in this environment, so final visual verification still needs an in-browser pass after reload.
- `legacy-site-regression-not-fully-verified`: existing external site iframe submit/upload/history flows passed syntax-level safety review, but still need a real extension-page regression sweep.
- `readonly-history-site-quality-depends-on-runtime-capture`: hybrid site snapshots now prefer saved extracted content, but older sessions created before this fix may still only contain URL-level fallback text.

### Fixed

- `settings-agent-utils-missing-script`: `options/options.html` initially missed `shared/agent-prompt-utils.js`, which broke default skill engine normalization.
- `agent-delta-before-placeholder`: stream delta could arrive before the placeholder assistant message and lose first tokens; now deltas create an assistant message when needed.
- `hybrid-history-open-params`: hybrid history cards incorrectly passed synthetic `Skill:xxx` labels through `sites=`; now hybrid detail relies on `historyId` recovery only.
- `agent-category-batch-select-gap`: homepage lacked category-level multi-select; now double-clicking a category chip toggles all skills in that category.
- `agent-panel-close-refresh-not-cancelling`: closing or refreshing a skill panel could leave the old backend job running; panel lifecycle now sends explicit cancel messages.
- `initial-agent-query-not-running`: opening compare with `query=...&agents=...` created skill panels but did not send the first question automatically; now initial query fans out to selected skills too.
- `hybrid-global-query-writing-legacy-history`: later global asks in hybrid mode still called `savePKHistory`; now hybrid sessions persist through IndexedDB instead.
- `panel-reopen-replayed-current-query`: reopening a site panel from left nav reused the current top query and violated the fresh-panel rule; reopen now starts with an empty page.
- `hybrid-global-submit-overwriting-session`: later hybrid global asks reused the prior IndexedDB session id; each global ask now creates a brand-new hybrid history session.
- `readonly-history-copy-preview-broken`: hybrid read-only history rendered snapshot panels instead of live iframes, so timeline copy preview had no data source and copy/preview failed. The compare page now builds preview data directly from saved hybrid session panels.
- `readonly-history-timeline-missing-entry`: hybrid read-only detail did not seed timeline state, which could remove the copy entry point. History detail now restores timeline entries from saved hybrid session data, with fallback to the session query.
- `hybrid-site-snapshot-url-only`: hybrid session persistence stored site URLs as the primary snapshot text. Persistence now prefers saved runtime extracted content and keeps URL as fallback only.
- `live-hybrid-copy-including-agent-iframes-as-sites`: timeline copy collection previously treated all `.ai-iframe` nodes as site iframes. Live collection now uses site iframes for DOM extraction and skill panel state for skill answers.
- `hybrid-history-query-cleared-on-autosave`: later background/session saves could overwrite hybrid history `query` with an empty string when the top input had already been cleared. Persistence now keeps the incoming query, current search value, or existing saved query in that order, and the history list also backfills broken old records from timeline entries or saved user messages.
- `hybrid-history-favorites-missing-from-favorites-page`: the favorites system originally read and counted only `pkHistory`, so favoriting hybrid history items in the history page did not make them appear in Favorites or the sidebar. Favorites, sidebar counts, folder counts, folder moves, and unfavorite/clear actions now include IndexedDB hybrid sessions too.
- `hybrid-favorite-flags-dropped-by-indexeddb-normalizer`: hybrid favorite writes updated `isFavorite` and `favoriteFolder`, but `shared/hybrid-history-db.js` stripped both fields during normalization. IndexedDB session normalization now preserves these fields, so multiple hybrid sessions can stay favorited independently instead of collapsing to a single visible result.
- `hybrid-history-open-fell-back-to-default-sites`: opening a hybrid history/favorite item relied on `historyItem.sites.length > 0` before restoring, but hybrid IndexedDB sessions store site+skill panels outside legacy `sites[]`. The compare page now detects hybrid history records directly from IndexedDB metadata and restores the saved panel snapshots even when legacy `sites[]` is empty.
- `hybrid-history-list-favorite-state-not-rehydrated`: history cards for hybrid sessions previously rebuilt `sites` tags without reading persisted favorite metadata, which could desync star state after reload. History list hydration now uses hybrid favorite site builders so saved favorite state stays consistent across history/favorites/sidebar views.
- `hybrid-history-opened-as-snapshot-layout`: hybrid history detail previously rendered read-only snapshot blocks, so iframe headers, spacing, and panel behavior no longer matched the live compare page. Hybrid history now reopens as live site iframes plus live skill panels using the saved panel order and URLs, preserving the familiar layout and allowing users to continue asking follow-up questions immediately.
- `hybrid-favorite-state-overwritten-by-autosave`: after a hybrid session was favorited, later background/session persistence rewrote the same IndexedDB record without carrying forward `isFavorite` and `favoriteFolder`, so the item silently disappeared from Favorites again. Hybrid autosave now reloads the existing session first and preserves favorite state on every subsequent save.
- `agent-engine-config-read-from-redacted-background-response`: the live iframe-side skill runner briefly tried to read engine config through a background message that intentionally omitted `apiKey`, so every skill request failed with `Skill engine is not configured` despite a saved key. The iframe runner now reads the full config directly from Chrome storage before calling the API.

## Notes

- Cloud sync compatibility for hybrid history is intentionally out of scope for this implementation.
- If capacity or persistence issues appear, IndexedDB must be treated as the source of truth for hybrid history.
- Static validation completed with `node --check` for:
  - `background.js`
  - `homepage/homepage.js`
  - `iframe/iframe.js`
  - `history/history.js`
  - `options/options.js`
- This log was corrected after a real bug report on history preview/copy. Earlier “history detail works” status was too optimistic before read-only copy preview had been exercised end-to-end.
- Browser automation validation is partially blocked in this environment because Chrome remote debugging did not remain attachable after background launch; keep this as a follow-up before shipping.
- Direct regression checks completed for this fix set:
  - `node --check shared/hybrid-history-db.js`
  - `node --check shared/hybrid-favorites.js`
  - `node --check iframe/iframe.js`
  - `node --check history/history.js`
  - `node --check favorites/favorites.js`
  - `node --check shared/sidebar.js`
  - `node` assertion: `normalizeSessionRecord(...)` now keeps `isFavorite` and `favoriteFolder`
  - `node` assertion: `buildSessionFavoriteSites(...)` now emits both site and agent favorite entries with the persisted folder id
