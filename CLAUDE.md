# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Site Testing Rules

- When validating AI site integrations, do not treat selector existence alone as a passing result. A site only passes if the configured flow actually performs the target action successfully.
- Translation sites must be tested with a deterministic real query in user Chrome, not only with DOM inspection. The default verification query is `你好世界`.
- A translation site passes only if the configured input steps really inject the source text, the page produces a non-placeholder translation result, and the configured `contentExtractor` selector can read that final translated text.
- For English-target translation checks, the result should match a `hello world`-style output rather than staying empty, staying as `...`, or echoing the original Chinese input.
- Bing Translate uses `#tta_input_ta`, which is a `contenteditable` element, not a normal textarea. Its test and config must write through `textContent` rather than `.value`.
