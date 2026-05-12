# UI Optimization Plan

## Objective

Refresh the extension UI so the homepage, workbench, settings, and helper pages feel like one product instead of several unrelated screens.

## Baseline

- The shell is clear, but the visual language is flat and conservative.
- `homepage` and `options` duplicate sidebar styles instead of truly sharing them.
- The workbench has too many competing layers: search bar, timeline, loading overlay, and modal states.
- The in-page overlays use slightly different tones and radii, so they read as separate products.

## Direction

- Keep the product practical and dense.
- Add a stronger visual hierarchy and a warmer accent.
- Make the shell feel more deliberate without changing the core flows.

## Phases

1. Build shared UI tokens and reduce duplicated surface styles.
2. Polish homepage hierarchy and card rhythm.
3. Tighten the iframe workbench and modal surfaces.
4. Align history, favorites, contact, and content-script overlays.
5. Verify in a standalone browser session and fix any regressions.

## Review Log

### 2026-05-11

- Started with a repo scan and baseline UI review.
- Confirmed the main issue is inconsistency, not missing functionality.
- Next step: implement shared tokens and refresh the page surfaces.

### 2026-05-11 Browser Walkthrough

- Opened the local extension pages in a standalone browser session through the repo's static server.
- Homepage: the warmer surface language landed well, and the search bar / site cards now read as the primary action area instead of a flat utility strip.
- Options: the shell is cleaner and the toggles, cards, and save affordances now feel like they belong to the same product family.
- History / Favorites / Contact: the empty states and content cards now share the same rounded white-panel rhythm.
- Iframe workbench: the top bar, tool buttons, and panel chrome now match the rest of the shell; the remote-site frames themselves still fail in the browser because the target sites block framing, which is expected.

## Browser Walkthrough Log

### Pending

- None. Initial browser pass completed.

### 2026-05-12 Follow-up Visual QA

- Verified the refreshed search bar focus state in a browser screenshot pass; the wrapper ring is now orange instead of gray.
- Verified the options select field now shows an orange outline when focused.
- Verified the config-update primary button and the injected favorite modal controls no longer use the old blue chrome.

### 2026-05-12 Homepage Tone-Down

- Softened the homepage page glow so the background no longer competes with the search area.
- Reworked the `pinGuideBanner` from a dark hero block into a lighter notice strip with a subtle orange accent.
- Kept the banner readable, but moved its visual weight below the search bar and site list.

## Fix Log

### 2026-05-11

- Added shared UI tokens and linked them into the main extension entry pages.
- Refreshed the shared sidebar, history, favorites, contact, and favorite-folder modal surfaces to use the shared token system.
- Removed the duplicated sidebar styling block from the homepage CSS and aligned the homepage sections, site list cards, and modal surfaces with the new theme.
- Added end-of-file theme overrides for the options page and iframe workbench so the existing component structure keeps working while the visual language is unified.

### 2026-05-12 Feishu Walkthrough Findings

- `options/options.js` had a real empty-state regression: the disabled-sites panel called `noDisabledSites`, but the key was missing from every locale, so the box rendered blank instead of explaining itself. That is fixed now.
- The same options path also referenced `deleteFailed` without a locale entry, so a failed delete could fall back awkwardly or show no localized text. That key is now filled in.
- The strongest visual outlier in the wiki screenshots is the `Manage Folders` modal. Its action cluster reads detached from the folder row and the spacing feels less intentional than the rest of the refreshed shell.
- The floating-button screenshot still looks slightly more functional than polished. It is not broken, but the button pairing could be tightened if we want the whole product to feel equally finished.
- The prompt-template and analysis-template modals are already in the acceptable range. The Cloud sync and prompt-library pages are now serving as the better visual baseline.

### 2026-05-12 Visual Recolor Pass

- Added a shared form-control focus baseline in `shared/ui-tokens.css` so text-like inputs and buttons get the same accent ring language across pages.
- Reworked the `iframe` search wrapper so its active state uses the orange accent instead of the default gray border.
- Recolored the config-update toast/dialog primary buttons and their focus states in `iframe/iframe.css` to match the product accent.
- Recolored the injected favorite modal and user-prompt action buttons in `iframe/inject.js` to remove the remaining blue button chrome.

### 2026-05-12 Follow-up Visual QA

- The remaining hardcoded blue button and focus colors were still visible in the `iframe` workbench and the injected favorite modal, so those surfaces were retuned to the same orange accent family as the rest of the shell.
- The `iframe` search bar now shows its active state on the wrapper itself, so the focused box no longer sits in the old gray state.
- The options page select fields now get an explicit orange outline and focus ring instead of relying on browser defaults.
- The only green left in the visible UI is semantic status coloring, not primary button chrome.

### 2026-05-12 Black-and-White Cleanup

- Fixed the remaining recolor miss in `shared/sidebar.css`: the logged-in sync-bar cloud icon was still using an old orange filter.
- Replaced that login-state icon filter with a grayscale + dark brightness treatment so the sidebar sync icon now stays within the black-and-white theme.
- Re-scanned the main UI CSS for the same hue-rotate / sepia / saturate recolor pattern and did not find another active icon recolor path in the primary shell files.
- Browser-side recheck of the extension page is currently limited in the in-app browser because `chrome-extension://` URLs are blocked by policy, so this pass is verified by code-path inspection plus targeted residual-color search.

### 2026-05-12 Preview Modal Alignment Pass

- Rebuilt the timeline response-preview modal header so the title and status copy now sit in one content column, while refresh and close controls live in a dedicated action group.
- Wrapped the preview text area in its own body section and separated the footer into a tools group plus a primary confirm action, which removes the previous floating / misaligned button feel.
- Added responsive stacking rules so the preview modal keeps clean alignment on narrower widths instead of collapsing into uneven button rows.

## Final Check

- Same surface language across pages.
- One obvious primary action per screen.
- No duplicated sidebar styling left in the homepage CSS.
- Browser screenshots reviewed and the visible shell issues were fixed; remaining green is semantic status coloring only.
