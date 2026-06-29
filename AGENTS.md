# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

AI比一比 (AI Compare) is a Chrome browser extension that enhances AI website usage efficiency. The extension allows users to:

1. Access multiple AI websites in one tab using iframes
2. Send queries to multiple AI sites simultaneously for comparison
3. Use floating buttons and text selection shortcuts to query AI sites
4. Configure preferred AI sites and customize the interface

## Architecture

### Core Components

- **manifest.json**: Chrome extension manifest (Manifest V3)
- **background.js**: Service worker handling extension lifecycle and configuration updates
- **config/**: Configuration files for sites, rules, and base settings
  - `siteHandlers.json`: AI site configurations with search handlers and iframe support
  - `baseConfig.js`: Base configuration and default site definitions
  - `rules.json`: Declarative net request rules
- **content-scripts/**: Injected scripts for various functionalities
  - `float-button.js`: Floating button overlay on web pages
  - `selection.js`: Text selection handling and popup display
  - `search-engines.js`: Search engine integration (Google, Baidu, Bing)
- **iframe/**: Multi-AI comparison interface
  - `iframe.html/js/css`: Main interface for displaying multiple AI sites
  - `inject.js`: Script injected into AI sites for interaction
- **options/**: Extension options page for configuration
- **_locales/**: Internationalization support (English/Chinese)

### Key Features

1. **Multi-AI Interface**: Uses iframes to embed multiple AI sites in one view
2. **Site Handlers**: JavaScript functions that automate query submission on each AI site
3. **Dynamic Configuration**: Remote config updates for adding new AI sites
4. **Content Script Integration**: Floating buttons and text selection across all websites
5. **Search Engine Integration**: Quick AI access buttons on search result pages

### AI Site Integration

Sites are configured in `config/siteHandlers.json` with properties:
- `supportIframe`: Whether site works in iframe
- `supportUrlQuery`: Whether site accepts query in URL
- `searchHandler`: JavaScript function to automate query submission
- `enabled`: Whether site is active
- `region`: Geographic region (China/US)

## Site Config Field Map

- Each site entry currently has required baseline fields:
  `name`, `url`, `enabled`, `supportUrlQuery`, `region`, `hidden`, `supportIframe`, `searchHandler`, `icon`, `type`
- Each site entry may additionally include optional top-level fields:
  `note`, `fileUploadHandler`, `contentExtractor`, `historyHandler`, `userPrompt`, `deepResearchHandler`
- `searchHandler.steps[]`, `fileUploadHandler.steps[]`, and `deepResearchHandler.steps[]` are step arrays. Step objects currently use:
  `action`, `selector`, `description`, `duration`, `events`, `inputType`, `keys`, `maxAttempts`, `retryInterval`, `waitForElement`, `retryOnDisabled`, `customAction`, `customSetValue`, `messageType`, `required`, `specialConfig`
- `deepResearchHandler` currently uses:
  `enabledSelectors`, `steps`
- `userPrompt` currently uses:
  `containerSelector`, `textSelector`, `messageNodeSelector`, `requireMessageNode`, `skipMessageIdPattern`
- `contentExtractor` currently uses:
  `containerSelector`, `messageContainer`, `contentSelectors`, `fallbackSelectors`, `selectors`, `excludeSelectors`, `userMessageSelector`, `exportLatestOnly`, `extractThinking`, `thinkingSelector`, `thinkingBlockFilters`, `editModeCheck`, `urlExtractor`
- `contentExtractor.urlExtractor` currently uses:
  `alternateLinkSelector`, `urlPattern`, `removeParams`
- `historyHandler` currently uses:
  `urlFeature`
- `type` is currently used for site category such as `information`.
- When adding a new site, treat the field map above as the full identification surface. The adaptation flow must explain how each field is decided, omitted, or inherited from existing conventions.

### Key Files to Understand

- `background.js:1-50`: Extension lifecycle and config management
- `iframe/iframe.js:1-50`: Main multi-AI interface logic
- `content-scripts/float-button.js:1-30`: Floating button creation
- `config/siteHandlers.json`: Complete AI site configurations
- `manifest.json`: Extension permissions and content script declarations

## Development Notes

This is a Chrome extension project without traditional build tools like npm or webpack. Files are loaded directly as specified in manifest.json. The extension uses:

- Vanilla JavaScript (no frameworks)
- jQuery 3.7.1 (included in lib/)
- Chrome Extension APIs (storage, tabs, scripting, etc.)
- Dynamic script injection for AI site automation

No build, test, or lint commands are available - this is a standard Chrome extension that can be loaded directly in developer mode.

## Git And README Rules

- Whenever git is used to record repository changes for a commit, update `README.md` as part of the same workflow before the commit is finalized.
- Treat the README update as required companion work for shipped code, config, behavior, or UX changes. Do not leave README stale after a git-recorded change.
- If the repository already provides an automated README update hook or script, use it. Otherwise, make the README update manually and include it in the same commit.
- `docs/release-notes/latest.md` is the real-time user improvement request log. Refresh it during the same working session by passing the latest user request through `RELEASE_NOTES_MODE=worktree node scripts/generate-release-notes.js`, but only keep user-facing feature/UX improvement requests there instead of every command or file-change detail.
- `docs/release-notes/history.md` is the packaged version summary history. Only append to it during GitHub packaging / release flow with `RELEASE_NOTES_MODE=release node scripts/generate-release-notes.js`.

## Localization Rules

- Any new user-facing copy must be internationalized before it ships. Do not hardcode new UI text, toast text, modal text, button labels, status text, or completion messages directly in JavaScript/HTML/CSS if they can be shown to users.
- Add a `chrome.i18n` message key first, wire the UI to that key, and only use a literal fallback string as a defensive fallback.
- When updating an existing user-facing message, update the corresponding entries under `_locales/` in the same change. Do not leave new keys only in code.
- When changing existing copy, update the corresponding message in every supported locale during the same change. Do not ship a wording update in only one language while leaving other locale entries stale.
- Progress, success, error, empty-state, and retry-related text are also user-facing copy and must follow the same localization rule.

## Site Testing Rules

- When validating AI site integrations, do not treat selector existence alone as a passing result. A site only passes if the configured flow actually performs the target action successfully.
- When testing a site, do not open the target website directly first. Open the extension page instead, then pass the site to test through URL parameters such as `sites=` / `customSites=` / `query=` so the real plugin launch path is exercised.
- If the requested site is not currently open in the user's Chrome session, proactively construct the extension compare-page URL with `sites=` / `customSites=` / `query=` and open or retarget that plugin tab first, instead of waiting for the user to open the site manually.
- When collecting site-adaptation parameters such as runtime URL, iframe support, bootstrap path, editor type, submit path, `searchHandler` steps, `userPrompt`, `contentExtractor`, and `historyHandler`, open the user's Chrome browser and inspect the real page there. Do not use a headless browser as the source of truth for these adaptation decisions.
- Translation sites must be tested with a deterministic real query in user Chrome, not only with DOM inspection. The default verification query is `你好世界`.
- A translation site passes only if the configured input steps really inject the source text, the page produces a non-placeholder translation result, and the configured `contentExtractor` selector can read that final translated text.
- For English-target translation checks, the result should match a `hello world`-style output rather than staying empty, staying as `...`, or echoing the original Chinese input.
- Bing Translate uses `#tta_input_ta`, which is a `contenteditable` element, not a normal textarea. Its test and config must write through `textContent` rather than `.value`.
- Nano Banana / Flow must be validated in the real user Chrome profile because the root page first requires opening a new project before the prompt editor appears.
- Nano Banana's prompt input is the Slate editor `div[role="textbox"][data-slate-editor="true"]`.

## New Site Flow Template

- When adding a new site, first confirm whether the landing page is already the real workspace or only an entry page. If it is an entry page, record the required bootstrap clicks before the actual prompt editor appears.
- Prefer a real user-Chrome end-to-end validation path before finalizing selectors.
- Lock selectors to the real editor/widget type after validation. Do not leave a new site on broad fallback selectors if the real page exposes a stable control such as a Slate editor, Lexical editor, or a specific submit icon.
- Treat "automation triggered the real job" and "remote generation succeeded" as separate checks. A site can count as wiring-valid if the flow reaches a real progress or failure state caused by the submitted prompt, even when the remote job itself later fails.

## New Site Full Adaptation Workflow

- Use this workflow whenever a new AI site is added or when an existing placeholder handler is being replaced with a real one.
- Step 0: open the user's Chrome browser and collect evidence there.
  Before deciding any non-trivial adaptation field, open the extension page in the user's real Chrome profile and inspect the live runtime page there. For site testing, do not jump straight to the external website; start from the plugin page and pass the target site names through URL parameters such as `sites=` / `customSites=` / `query=`. Treat the user Chrome session as the source of truth for runtime URL, iframe viability, bootstrap actions, editor type, submit path, extraction selectors, and history behavior. Do not rely on a headless browser for these parameter decisions; headless checks may be used only as secondary diagnostics after the user-Chrome result is known.
- Step 1: identify `name`, `url`, and the real working runtime URL.
  Confirm the canonical user-facing site name and the real landing/runtime URL. A configured entry URL may redirect to another workspace page after login. Prefer the runtime page in `url` if that is where input, history detection, and extraction actually happen.
- Step 2: identify `region`, `type`, `note`, `enabled`, and `hidden`.
  `region` should reflect the site’s actual service region or the repo’s existing categorization pattern. `type` should match the existing site category conventions. `note` should capture the one-line operational nuance that matters for maintenance, such as “requires click submit” or “pricing redirect means credits exhausted”. `enabled` and `hidden` must be decided separately: `enabled` is default-on behavior, while `hidden` is UI visibility. If the site is newly adapted, prefer conservative defaults unless there is a reason to expose or enable it immediately.
- Step 3: identify `supportIframe`.
  Do not guess. Validate whether the page can be embedded under the extension runtime and check frame-related failures such as `X-Frame-Options`, CSP `frame-ancestors`, login isolation, or post-load blank states. If the site blocks framing or is operationally broken inside an iframe, set `supportIframe: false`.
- Step 4: identify `supportUrlQuery`.
  Verify whether the site truly supports query injection through URL parameters and whether the query lands in the real prompt path. Do not set this based on superficial query params in the address bar unless they create a real input or search state.
- Step 5: identify whether bootstrap actions are needed before the real editor appears.
  If the page is entry-page-first rather than workspace-first, record bootstrap clicks such as cookie acceptance, “new project”, template selection, or launcher dismissal. Optional bootstrap steps must stay optional and should not be collapsed into a vague generic selector.
- Step 6: identify `searchHandler.steps[]`.
  This is the primary automation chain and must be derived from a real user-Chrome run. For each step, determine:
  `action`: the real operation such as `focus`, `setValue`, `triggerEvents`, `wait`, `click`, `sendKeys`, `custom`, or `paste`.
  `selector`: the stable target node for that action.
  `description`: a maintenance-friendly summary of why the step exists.
  `inputType`: only when the real editor type requires it, such as `contenteditable`, `special`, or `angular`.
  `events`: only when the page requires explicit event replay such as `input`, `change`, `blur`, `focus`, or `beforeinput`.
  `keys`: only when keyboard submission is the real trigger.
  `duration`: only for waits that are proven necessary, such as waiting for a send button to enable.
  `maxAttempts`, `retryInterval`, `waitForElement`, `retryOnDisabled`: use these when the page is async and selectors or controls do not appear instantly.
  `customAction`, `customSetValue`, `messageType`, `required`, `specialConfig`: only when the site needs non-standard behavior already supported by the injector.
- Step 7: verify the exact `searchHandler` path against a deterministic query.
  Run the exact configured chain in the real logged-in Chrome profile. For general text sites, the default verification query is `你好世界` unless a site-specific query is required. Test click submission and keyboard submission separately; choose the one that causes a real session state change.
- Step 8: separate local wiring success from remote job success.
  A site passes handler validation when automation produces a real conversation, task card, progress state, failure state, or pricing/permission redirect that is attributable to the submitted prompt. Remote refusal, quota failure, or credit exhaustion after submit is not by itself a selector failure.
- Step 9: identify `userPrompt`.
  After a successful submit, inspect the rendered conversation DOM and determine whether `userPrompt` is needed. When it is needed, resolve `containerSelector` and `textSelector` to the stable user-message nodes. If the site requires stricter matching, also determine `messageNodeSelector`, `requireMessageNode`, and `skipMessageIdPattern`.
- Step 10: identify `contentExtractor`.
  Determine whether extraction should use `containerSelector`, `messageContainer`, `contentSelectors`, `fallbackSelectors`, or older `selectors`. Prefer the most structured answer-row extraction that the page supports. Also decide:
  `userMessageSelector` when extraction must differentiate user and assistant content.
  `excludeSelectors` for headers, footers, sidebars, input areas, chips, attachments, stop/regenerate controls, process panels, or other repeated noise.
  `exportLatestOnly` when only the newest answer should be exported.
  `extractThinking`, `thinkingSelector`, `thinkingBlockFilters` when the site exposes thought/reasoning blocks and the repo should include or filter them.
  `editModeCheck` when extraction must confirm the page is in the right mode before reading.
  `urlExtractor` when the canonical exported history URL must be reconstructed from an alternate link pattern rather than `location.href`.
- Step 11: verify extraction after the answer stabilizes.
  Re-run extraction against the same real session and confirm that the configured `contentExtractor` reads the final answer body rather than page chrome or the user prompt. If the site streams or lazy-renders content, wait until the answer stabilizes before deciding the selector failed.
- Step 12: identify `historyHandler`.
  If the site creates stable history URLs, determine `historyHandler.urlFeature` from the real post-submit URL pattern, such as `/c/`, `/chat`, or `/app/`. If the site has no reliable history URL pattern, omit the field rather than inventing one.
- Step 12.5: identify `deepResearchHandler` when the site exposes a deep-research switch.
  Only include `deepResearchHandler` when the live page has a stable deep-research toggle worth automating. Determine `enabledSelectors` from the actual on-state DOM and validate that they match only after the toggle is enabled. Reuse the existing step schema for `steps[]`, and verify both “already enabled” and “closed -> enabled” paths in the real user Chrome session.
- Step 13: identify `fileUploadHandler` when the site supports attachment workflows.
  Only include `fileUploadHandler.steps[]` if the page supports file paste/upload through the extension flow. Its steps should be validated independently from text-submit flow.
- Step 14: identify `icon`.
  Resolve the actual favicon or site icon from the live page, not from hostname guessing alone, and save it under `siteIcons/` using the repo convention. If the derived fallback filename is correct and the asset exists, document that; otherwise add the asset explicitly.
- Step 15: add a reusable verifier script when the site is non-trivial.
  If the site depends on redirects, runtime workspace URLs, login state, special editors, quota redirects, or same-domain path changes, add a focused script under `debug/` that proves the configured fields still work in the real browser context.

## New Site Acceptance Checklist

- The top-level field set has been evaluated: `name`, `url`, `enabled`, `supportUrlQuery`, `region`, `hidden`, `supportIframe`, `searchHandler`, `icon`, `type`, plus any optional fields that apply.
- The final runtime URL is known and documented.
- Bootstrap steps are documented as required or optional.
- `supportIframe` and `supportUrlQuery` are verified rather than guessed.
- The real editor type is identified and the handler writes through the correct primitive.
- The real submit path is validated with the deterministic query.
- The page enters a real post-submit state caused by the prompt.
- `userPrompt` points to stable user-message nodes.
- `contentExtractor` points to stable assistant-answer nodes.
- `historyHandler`, `deepResearchHandler`, `fileUploadHandler`, `note`, and `icon` have all been explicitly decided.
- `excludeSelectors` remove page chrome and repeated noise.
- A debug verifier exists for non-trivial sites or redirect-heavy flows.

## New Site Field Decision Template

- Use the template below whenever a new site is added or a placeholder site is being upgraded to a real integration.
- For every field, record one of:
  `set`: the field is required and you have a concrete value.
  `omit`: the field is optional and the site does not need it.
  `defer`: the field exists but cannot yet be validated because the remote site is blocked by login, quota, rollout, or another external constraint.
- Do not mark a field as complete without a real-browser reason. Every non-trivial field should have a short evidence note.

```md
### New Site Decision Record

Site name:
Configured name:
Candidate URL:
Final runtime URL:
Verification query:
Verification environment:

#### Top-level fields

- `name`:
  status: `set | omit | defer`
  value:
  evidence:

- `url`:
  status: `set | omit | defer`
  value:
  evidence:

- `enabled`:
  status: `set | omit | defer`
  value:
  evidence:

- `supportUrlQuery`:
  status: `set | omit | defer`
  value:
  evidence:

- `region`:
  status: `set | omit | defer`
  value:
  evidence:

- `hidden`:
  status: `set | omit | defer`
  value:
  evidence:

- `supportIframe`:
  status: `set | omit | defer`
  value:
  evidence:

- `note`:
  status: `set | omit | defer`
  value:
  evidence:

- `icon`:
  status: `set | omit | defer`
  value:
  evidence:

- `type`:
  status: `set | omit | defer`
  value:
  evidence:

#### `searchHandler`

- needed:
  `yes | no`
- evidence:

- `steps[]`:
  record each step in order with:
  `action`, `selector`, `description`, and any applicable `inputType`, `events`, `keys`, `duration`, `maxAttempts`, `retryInterval`, `waitForElement`, `retryOnDisabled`, `customAction`, `customSetValue`, `messageType`, `required`, `specialConfig`

#### `userPrompt`

- needed:
  `yes | no`
- evidence:
- `containerSelector`:
- `textSelector`:
- `messageNodeSelector`:
- `requireMessageNode`:
- `skipMessageIdPattern`:

#### `contentExtractor`

- needed:
  `yes | no`
- evidence:
- `containerSelector`:
- `messageContainer`:
- `contentSelectors`:
- `fallbackSelectors`:
- `selectors`:
- `excludeSelectors`:
- `userMessageSelector`:
- `exportLatestOnly`:
- `extractThinking`:
- `thinkingSelector`:
- `thinkingBlockFilters`:
- `editModeCheck`:
- `urlExtractor`:
  - `alternateLinkSelector`:
  - `urlPattern`:
  - `removeParams`:

#### `historyHandler`

- needed:
  `yes | no`
- evidence:
- `urlFeature`:

#### `deepResearchHandler`

- needed:
  `yes | no`
- evidence:
- `enabledSelectors`:
- `steps[]`:
  record each step in order with:
  `action`, `selector`, `description`, and any applicable `duration`, `events`, `inputType`, `keys`, `maxAttempts`, `retryInterval`, `waitForElement`, `retryOnDisabled`, `customAction`, `customSetValue`, `messageType`, `required`, `specialConfig`

#### `fileUploadHandler`

- needed:
  `yes | no`
- evidence:
- `steps[]`:

#### Verification outcome

- bootstrap path:
- real editor type:
- real submit path:
- real post-submit state:
- remote failure mode, if any:
- verifier script path:
- remaining risk:
```

## Field Completion Rule

- A new site is not fully adapted until every top-level field from the field map has been explicitly marked as `set`, `omit`, or `defer`.
- Optional fields may be omitted, but omission must be a conscious decision backed by the real site behavior.
- If a field is marked `defer`, the blocker must be written down together with the exact evidence already collected, so the next pass can resume without re-discovering the site from scratch.

## Nano Banana Flow

- Site: `Nano Banana`
  URL: `https://labs.google/fx/zh/tools/flow`
- Validation must run in the real user Chrome profile because page state depends on logged-in Chrome context and the Flow workspace.
- Handler resolution rule:
  Nano Banana may redirect from the configured entry URL to a workspace/project URL on the same `labs.google` domain, and that redirected URL may also drop or change the locale segment. When resolving a handler for an already-open iframe, prefer the explicit `siteName` together with same-domain validation instead of requiring the runtime path to keep matching the original config URL.
- Reusable handling sequence:
  1. Optionally dismiss the cookie bar via `text:agree` if it exists.
  2. If the prompt editor is not yet visible, click `text:新建项目` or `text:create new project`.
  3. Wait for the project page under `/project/<id>` to load.
  4. Focus the Slate prompt editor `div[role="textbox"][data-slate-editor="true"]`.
  5. Inject prompt text into the Slate editor.
  6. Trigger input/change/blur/focus events.
  7. Submit through the right-side button whose visible icon text is `arrow_forward`.
- Important nuance: the cookie button and the new-project button are optional bootstrap steps. If the page is already inside a project and the Slate editor is present, skip them.
- Verified prompt selector:
  `div[role="textbox"][data-slate-editor="true"]`
- Verified submit trigger:
  the button whose visible text contains `arrow_forward`, which corresponds to the right-side "创建" action.
- Verified automation outcome pattern:
  after submit, the prompt box may reset to placeholder text while the canvas/task card appears and starts showing progress like `6%`, `16%`, etc.
- Current verification rule for Nano Banana:
  the flow counts as successfully triggered if the submitted prompt appears in the created task card and the page enters either a progress state or a failure card state.
- Current generic config location:
  `config/siteHandlers.json` under the `Nano Banana` entry.
- Current logic verifier:
  `debug/verify-nano-banana.js` validates that Nano Banana remains resolvable from the base Flow URL and from redirected project URLs with locale variations.

## Same-Domain Redirect Rule

- When a site lives under a shared domain and the runtime page can redirect from an entry URL to a different workspace path, do not rely on URL-prefix matching alone for handler lookup.
- If the iframe or injected message already carries the exact `siteName`, resolve the handler by `siteName + same-domain` first, then use path scoring only as a secondary signal.
- Keep strict path matching for cases where `siteName` is absent, so different products on the same domain are not accidentally mixed together.

## MinxMax Flow

- Site: `MinxMax`
  URL: `https://agent.minimax.io/`
- Validation must run in the real user Chrome profile because the site uses an authenticated workspace and Cloudflare/browser context affects what the runtime page exposes.
- Landing behavior:
  the root URL is already the real working page. No extra bootstrap click is required before the prompt editor appears.
- iframe rule:
  `https://agent.minimax.io/` returns `X-Frame-Options: SAMEORIGIN`, so `supportIframe` must stay `false`.
- Verified prompt selector:
  `div.tiptap.ProseMirror.tiptap-editor`
- Verified editor type:
  Tiptap / ProseMirror `contenteditable`, not a textarea.
- Verified submit trigger:
  `#input-send-icon` or its direct child. Real submission happens through click; Enter alone did not create a conversation during validation.
- Verified post-submit transition:
  after prompt injection and send-button click, the page redirects from `/` to `/chat?id=<id>` and creates a real conversation/task.
- Current remote-failure pattern:
  if the logged-in account lacks credits, the same submit path may redirect from the chat flow to `/pricing?fromChat=true&revokeInfo=...`. Treat that as wiring-valid but remote-credit-blocked, not as a selector failure.
- Verified user-message structure:
  the rendered user prompt appears under `#message-container div.message.sent`, with visible text in `div.message-content`.
- Extraction guidance:
  keep assistant extraction scoped to `#message-container div.message:not(.sent)` and exclude the top skill chips row plus the right-side studio/process area. Do not use page-wide selectors because task history, tab labels, and the process panel all echo prompt-related text.
- Current process panel:
  the right-side process workspace lives under `#mmx-studio`. It is not the primary answer body and should be excluded from the default `contentExtractor`.
- Verified history URL rule:
  chat sessions land on `/chat?id=...`, so the history detector should use `/chat`.
- Verified icon source:
  the favicon can be resolved from the live browser context at `https://agent.minimax.io/assets/logo/favicon_v2.png?v=4`; the local icon asset should be stored as `siteIcons/agent.minimax.io.png`.

## Doubao Flow

- Site: `豆包`
  URL: `https://www.doubao.com/chat`
- Validation must run in the real user Chrome profile because the homepage, active chat route, and message-list DOM differ materially between landing state and post-submit chat state.
- Landing behavior:
  the root `/chat` page may first render a greeting/home shell. A valid automation run is only confirmed after the page transitions to a concrete chat URL such as `/chat/<id>`.
- Verified prompt input:
  `textarea[placeholder="发消息..."]`
- Verified submit path:
  sending Enter from the textarea successfully created a new chat during validation and redirected from `/chat` to `/chat/<id>`.
- Verified post-submit transition:
  after sending `你好世界`, the page URL changed to `https://www.doubao.com/chat/<id>` and the conversation body contained both the user prompt and the assistant reply.
- Old-selector warning:
  historical selectors such as `.inner-item-w21SQO`, `.content-Xv_Zw0`, and `.message-list-S2Fv2S` were observed as fully absent on 2026-06-02 in the real browser and should be treated as obsolete.
- Verified current message-list root:
  `.message-list-zLoNs1`
- Verified current user prompt structure:
  each message row has `data-message-id`, and the user prompt lives under
  `[data-message-id] [data-plugin-identifier="block_type:10000"] .whitespace-pre-wrap`
- Verified current assistant content structure:
  the assistant answer body lives under the same `data-message-id` row and can be extracted from
  `.container-enLQFx`, with stable fallback wrappers `.container-fBOrXO`, `.container-qX9Csx`, and `.container-h3Yzeb`
- Extraction guidance:
  prefer `messageContainer: ".message-list-zLoNs1 [data-message-id]"` and then extract answer text from the container-scoped selectors above. Do not rely on page-wide shell text because the page includes greeting cards, capability chips, and footer hints that contaminate fallback extraction.
- Timeline extraction guidance:
  for time-based or prompt-based extraction, keep `userPrompt.messageNodeSelector` aligned to `[data-message-id]` so a matched user prompt can be paired with the following assistant row inside the same virtualized message list.
- Verified runtime symptom of old config:
  when old selectors are used, `LIST_USER_PROMPTS` may still succeed but `EXTRACT_PROMPT_RESPONSE` returns `found: true` with `answers: []`, while `EXTRACT_CONTENT` falls back to shell text such as `问候`, `内容由豆包 AI 生成，请仔细甄别`, and input suggestions.

## Extension ID For Testing

- The current user-Chrome extension id for this workspace is `hhkhgpadepocnmjfpohcmjdcgkmfnadi`.
- When a debug script or manual check needs a concrete extension page, prefer `chrome-extension://hhkhgpadepocnmjfpohcmjdcgkmfnadi/homepage/homepage.html` or the matching path under that id.
- For site-integration testing, prefer opening the compare page directly with URL parameters, for example:
  `chrome-extension://hhkhgpadepocnmjfpohcmjdcgkmfnadi/iframe/iframe.html?sites=Qwen&type=information&query=%E4%BD%A0%E5%A5%BD%E4%B8%96%E7%95%8C`
- Use `sites=` for built-in iframe-capable sites, `customSites=` for custom iframe-capable sites, and `query=` when the validation flow should exercise real prompt submission from the plugin entry path.
- If a script supports `EXTENSION_ID`, default to `hhkhgpadepocnmjfpohcmjdcgkmfnadi` unless the user explicitly says to test a different installed build.
- Do not confuse dynamic resource ids generated by `web_accessible_resources.use_dynamic_url` with the real extension id. Values that look like UUIDs such as `e89cca61-9b65-4b36-a649-322031857d0b` are dynamic resource ids, not the extension id to use for navigation or test assertions.
