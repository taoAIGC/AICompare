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

## Localization Rules

- Any new user-facing copy must be internationalized before it ships. Do not hardcode new UI text, toast text, modal text, button labels, status text, or completion messages directly in JavaScript/HTML/CSS if they can be shown to users.
- Add a `chrome.i18n` message key first, wire the UI to that key, and only use a literal fallback string as a defensive fallback.
- When updating an existing user-facing message, update the corresponding entries under `_locales/` in the same change. Do not leave new keys only in code.
- Progress, success, error, empty-state, and retry-related text are also user-facing copy and must follow the same localization rule.

## Site Testing Rules

- When validating AI site integrations, do not treat selector existence alone as a passing result. A site only passes if the configured flow actually performs the target action successfully.
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
- Step 1: identify the real working URL.
  A configured entry URL may redirect to another runtime page. Record the final stable workspace URL after login and redirect handling, and prefer that URL in `config/siteHandlers.json` if it is the real page where input and response extraction happen.
- Step 2: determine whether the site is entry-page-first or workspace-first.
  If the page opens to a launcher, template picker, cookie gate, or onboarding view, record each bootstrap action separately and mark optional steps as optional. Do not fold bootstrap assumptions into a single vague selector.
- Step 3: locate the real input primitive.
  Confirm whether the site uses `textarea`, `contenteditable`, Slate, Lexical, ProseMirror, Angular form controls, or another editor type. The handler must write through the real control type instead of using a generic fallback when the page exposes a stable editor.
- Step 4: verify the real submit primitive.
  Test click submission and keyboard submission separately. Some sites visually enable a submit button after input but only the Enter path actually creates a conversation. Choose the path that produces a real session state change, not merely a visual state change.
- Step 5: validate the exact automation chain in user Chrome.
  Run the site in the real logged-in Chrome profile and confirm the sequence `focus -> write -> trigger events -> submit` with a deterministic query. For general text sites, the default verification query is `你好世界` unless a site-specific query is required.
- Step 6: separate input success from task success.
  A site passes handler validation when automation creates a real conversation, task card, progress state, or failure state attributable to the submitted prompt. Remote model refusal, quota failure, or server error after the prompt is accepted does not by itself mean the wiring is wrong.
- Step 7: tighten `userPrompt` to the real user message structure.
  After a successful run, inspect the actual rendered conversation DOM and point `userPrompt.containerSelector` and `userPrompt.textSelector` at the stable user-message nodes. Prefer explicit message rows such as `row-question-*`, question bubbles, or human-message containers over generic page-level text selectors.
- Step 8: tighten `contentExtractor` to the real answer structure.
  Prefer `messageContainer + contentSelectors + userMessageSelector + exportLatestOnly` over a long list of broad `selectors` whenever the site has a stable answer row. Point extraction to the final rendered answer body, not to page shells, footers, headers, or search box wrappers.
- Step 9: explicitly exclude noise.
  Add `excludeSelectors` for footer areas, policy text, input regions, stop/regenerate controls, attachment areas, assistant-name labels when needed, and any repeated history/sidebar content that can pollute exports.
- Step 10: verify extraction after the response stabilizes.
  Re-run against the same real session and confirm that the chosen `contentExtractor` reads the final answer text from the rendered answer body. If the site streams tokens, wait until the answer body settles before concluding the selector failed.
- Step 11: keep hidden and enabled decisions separate.
  `hidden` controls whether the site appears in selection UIs, while `enabled` controls whether it is on by default. A newly adapted site can be made visible with `hidden: false` while still staying opt-in with `enabled: false`.
- Step 12: add a reusable verifier script when the site is non-trivial.
  If a site depends on redirects, runtime workspace URLs, login state, or special editor behavior, add a focused script under `debug/` that connects to the user Chrome session and proves the handler still works against the real page.

## New Site Acceptance Checklist

- The final runtime URL is known and documented.
- Bootstrap steps are documented as required or optional.
- The real editor type is identified and the handler writes through the correct primitive.
- The real submit path is validated with the deterministic query.
- The page enters a real post-submit state caused by the prompt.
- `userPrompt` points to stable user-message nodes.
- `contentExtractor` points to stable assistant-answer nodes.
- `excludeSelectors` remove page chrome and repeated noise.
- A debug verifier exists for non-trivial sites or redirect-heavy flows.

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

## Extension ID For Testing

- The current user-Chrome extension id for this workspace is `hhkhgpadepocnmjfpohcmjdcgkmfnadi`.
- When a debug script or manual check needs a concrete extension page, prefer `chrome-extension://hhkhgpadepocnmjfpohcmjdcgkmfnadi/homepage/homepage.html` or the matching path under that id.
- If a script supports `EXTENSION_ID`, default to `hhkhgpadepocnmjfpohcmjdcgkmfnadi` unless the user explicitly says to test a different installed build.
- Do not confuse dynamic resource ids generated by `web_accessible_resources.use_dynamic_url` with the real extension id. Values that look like UUIDs such as `e89cca61-9b65-4b36-a649-322031857d0b` are dynamic resource ids, not the extension id to use for navigation or test assertions.
