# OpenClaw Skill Integration (AI Compare)

This folder provides a practical bridge so OpenClaw can trigger the AI Compare extension by opening a direct browser query link and waiting for structured multi-site results to be posted back locally.

## Positioning

For end users, the recommended install path is now [openclaw-extension](/Users/hasee/Documents/同步文稿/multi-AI/AIShortcuts/openclaw-extension/README.md), which provides the plugin-style hard router.

This `openclaw/` folder should be treated as:

1. the shared GUI runner layer used by the hard router
2. the compatibility layer for older skill-style installs

If your goal is "users can just say `搜索 XX` and OpenClaw routes it automatically", install the plugin from `openclaw-extension/` and keep this folder as the runner backend.

## What this integration does

1. Build a direct `chrome-extension://...` query URL that can auto-trigger search in the browser.
2. Open that URL in the user's regular browser for GUI mode.
3. Start a local callback server and wait for the extension page to POST structured results back.
4. Return structured JSON for each selected site (`siteName`, `url`, `content`, `status`, `error`) after the GUI callback arrives.
5. If the extension is missing or outdated, return actionable install / reload guidance instead of a vague failure.

## Files

- `openclaw/ai-compare-openclaw-runner.js`
  - CLI entry for OpenClaw skill runtime.
  - Uses `gui + localhost callback` as the standard path.
- `openclaw/ai-compare-openclaw-fast.js`
  - Thin wrapper with fixed GUI defaults for OpenClaw TUI.
  - Lets the model execute one short command instead of reasoning about many runner flags.
- `openclaw/SKILL.md`
  - Installable OpenClaw skill package with a short fast-path contract.
- `iframe/openclaw-bridge.js`
  - Runs inside extension page `iframe/iframe.html`.
  - Exposes `window.aiCompareOpenClaw.run()`.
- `openclaw/references/install-browser-extension.md`
  - Fallback guide when the extension is missing, outdated, or uses a different id.

## Standard Mode

### GUI + Localhost Callback

- Does not require Chrome remote debugging.
- Builds a direct trigger URL like:

```text
chrome-extension://<extension-id>/iframe/iframe.html?openclaw=1&query=...
```

- Opens that URL in the browser immediately unless `--print-only` is used.
- Starts a local callback server and waits for the extension page to POST structured results back to stdout.
- This is the recommended and standard OpenClaw integration path.

## Prerequisites

- Chrome installed with AI Compare already loaded in your normal Chrome profile.
- The target AI sites must already be logged in inside that same Chrome profile.
- If `--extension-id` is omitted, the runner will try known local/store extension ids before failing.

## CLI usage

Fast path for OpenClaw:

```bash
node openclaw/ai-compare-openclaw-fast.js --query "你好世界"
```

Per-site unresolved timeout defaults to 60 seconds. Override it with `--site-timeout-ms` when a site needs longer to settle.

Only add `--sites` when the user explicitly named sites:

```bash
node openclaw/ai-compare-openclaw-fast.js \
  --query "你好世界" \
  --sites "ChatGPT,Gemini"
```

macOS example:

```bash
node openclaw/ai-compare-openclaw-runner.js \
  --mode gui \
  --query "你好世界" \
  --sites "ChatGPT,Gemini,Claude" \
  --browser-app "Google Chrome"
```

Windows example:

```bash
node openclaw/ai-compare-openclaw-runner.js ^
  --mode gui ^
  --query "你好世界" ^
  --sites "ChatGPT,Gemini,Claude" ^
  --browser-app "chrome"
```

Print-only:

```bash
node openclaw/ai-compare-openclaw-runner.js \
  --mode gui \
  --query "你好世界" \
  --print-only
```

Open-only:

```bash
node openclaw/ai-compare-openclaw-runner.js \
  --mode gui \
  --query "你好世界" \
  --open-only
```

Success returns:

```json
{
  "ok": true,
  "mode": "gui",
  "extensionId": "hhkhgpadepocnmjfpohcmjdcgkmfnadi",
  "triggerUrl": "chrome-extension://hhkhgpadepocnmjfpohcmjdcgkmfnadi/iframe/iframe.html?openclaw=1&query=%E4%BD%A0%E5%A5%BD%E4%B8%96%E7%95%8C",
  "openedBrowser": true,
  "callbackReceived": true,
  "result": {
    "query": "你好世界",
    "results": [
      {
        "siteName": "ChatGPT",
        "status": "ok",
        "content": "..."
      }
    ]
  }
}
```

If failed, stdout returns:

```json
{
  "ok": false,
  "error": "..."
}
```

## Recommended OpenClaw Skill Prompt Template

`openclaw/SKILL.md` is already written as an OpenClaw skill package. You can either copy the `openclaw/` folder into `~/.openclaw/workspace/skills/ai-compare-bridge/` or publish it through your usual skill workflow.

Use this only when you explicitly need the legacy skill-style path. For new user installs, prefer the plugin path in `openclaw-extension/`.

Use this as the skill behavior contract:

```md
You are the AI Compare browser search skill.

When user provides a query:
1. Run:
   `node /ABSOLUTE/PATH/TO/SKILL/ai-compare-openclaw-runner.js --mode gui --query "<USER_QUERY>"`
2. Parse JSON from stdout.
3. If `ok=false`, explain the failure and provide install / reload guidance when the browser extension is missing or outdated.
4. Return the generated `triggerUrl` and show each site's raw `content` verbatim when available. Do not summarize, compare, translate, or rewrite plugin output.

Return the raw per-site content verbatim plus the JSON payload, with no secondary analysis.
```

## Notes

- The latest end-to-end verified path uses `openclaw-extension/` as the OpenClaw entry layer and this folder as the runner layer.
- `--sites` is optional. If omitted, the query link embeds no site filter and the extension uses its current site selection.
- The skill only adds `--sites` when the user explicitly names one or more AI sites; it does not infer sites from the question text.
- If the extension is not installed in the connected Chrome profile, GUI mode now fails fast with install / reload guidance instead of waiting for a timeout.
- On `ok=false`, the skill must surface install / reload guidance directly and must not fall back to `web_search` or any other search tool.
- Runner tries the current local dev id plus the Chrome Web Store id by default; pass `--extension-id` to override.
- `gui` mode is the standard direct-browser-link path and does not require remote debugging.
- `gui` mode waits for a local callback by default; use `--print-only` or `--open-only` to skip waiting.
- On Windows, `--browser-app "chrome"` is a good default example when Chrome is on PATH.
- TUI smoke test: `openclaw tui --message "请用 ai-compare-bridge skill 搜索 你好世界"` returned raw ChatGPT and Gemini plugin content in this workspace.
