# OpenClaw Skill Integration (AI Compare)

This folder provides a bridge so OpenClaw can trigger the AI Compare extension by opening a direct browser query link and waiting for structured multi-site results to be posted back locally.

## Positioning

For end users, the recommended install path is [openclaw-extension](../openclaw-extension/README.md), which provides the plugin-style hard router.

This `openclaw/` folder should be treated as:

1. the shared GUI runner layer used by the hard router
2. the compatibility layer for older skill-style installs

## What this integration does

1. Build a direct `chrome-extension://...` query URL that can auto-trigger search in the browser
2. Open that URL in the user's regular browser for GUI mode
3. Start a local callback server and wait for the extension page to POST structured results back
4. Return structured JSON for each selected site after the GUI callback arrives
5. If the extension is missing or outdated, return actionable install / reload guidance instead of a vague failure

## Files

- `openclaw/ai-compare-openclaw-runner.js`
- `openclaw/ai-compare-openclaw-fast.js`
- `openclaw/SKILL.md`
- `iframe/openclaw-bridge.js`
- `openclaw/references/install-browser-extension.md`

## Standard Mode

### GUI + Localhost Callback

- Does not require Chrome remote debugging
- Builds a direct trigger URL like `chrome-extension://<extension-id>/iframe/iframe.html?openclaw=1&query=...`
- Opens that URL in the browser immediately unless `--print-only` is used
- Starts a local callback server and waits for the extension page to POST structured results back to stdout

## Prerequisites

- Chrome installed with AI Compare already loaded in your normal Chrome profile
- The target AI sites must already be logged in inside that same Chrome profile

## CLI usage

Fast path:

```bash
node openclaw/ai-compare-openclaw-fast.js --query "你好世界"
```

Only add `--sites` when the user explicitly named sites:

```bash
node openclaw/ai-compare-openclaw-fast.js \
  --query "你好世界" \
  --sites "ChatGPT,Gemini"
```

## Behavior notes

- `gui` mode waits for a local callback by default; use `--print-only` or `--open-only` to skip waiting
- On Windows, `--browser-app "chrome"` is a good default example when Chrome is on PATH
