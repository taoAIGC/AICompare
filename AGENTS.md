# AGENTS.md

## Cursor Cloud specific instructions

### Project type

This is a Chrome browser extension (Manifest V3) built with vanilla JavaScript — no build tools, no package manager, no bundler. There are no `npm install`, build, lint, or automated test commands.

### Running the extension

Load `/workspace` as an unpacked extension in Chrome:

1. Launch Chrome: `google-chrome --no-sandbox --disable-gpu --start-maximized`
2. Navigate to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select `/workspace`

After loading, the extension ID is assigned dynamically. Access the homepage at `chrome-extension://<ID>/homepage/homepage.html` or click the extension icon. The multi-AI comparison page is at `chrome-extension://<ID>/iframe/iframe.html?query=<query>&sites=<comma-separated-sites>`.

### Automated testing and linting

- **Run tests**: `npm test` (Jest, 138 tests covering config validation, version comparison, SiteDetector, DOM helpers, and HTML-to-Markdown conversion)
- **Run lint**: `npm run lint` (ESLint; pre-existing code has ~3 errors and ~84 warnings — these are not regressions)
- **Manual testing**: Reload the extension on `chrome://extensions/` (click the refresh icon) after making changes, then test in the browser. See `DEVELOPER_GUIDE.md` for the full testing workflow.

### Gotchas

- The only error after loading is a benign `Unrecognized feature: 'web-share'` warning in the iframe allow attribute — this does not affect functionality.
- ChatGPT and some other AI sites require login to work in the iframe view; without login they show errors or login prompts. Gemini works without login for basic queries.
- The extension uses `chrome.sidePanel` API which requires Chrome 114+.
