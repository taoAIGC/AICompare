# OpenClaw Skill Integration (AI Compare)

This folder provides a practical bridge so OpenClaw can trigger the AI Compare extension and receive structured multi-site results.

## What this integration does

1. Open the extension comparison page with a query.
2. Wait for site responses to stabilize.
3. Return structured JSON for each selected site (`siteName`, `url`, `content`, `status`, `error`).

## Files

- `openclaw/ai-compare-openclaw-runner.js`
  - CLI entry for OpenClaw skill runtime.
  - Connects to a running Chrome instance through CDP.
- `iframe/openclaw-bridge.js`
  - Runs inside extension page `iframe/iframe.html`.
  - Exposes `window.aiCompareOpenClaw.run()`.

## Prerequisites

- Chrome installed with AI Compare already loaded in your normal Chrome profile.
- Start that same Chrome profile with remote debugging enabled before running the runner.
- Example on macOS:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

- The runner only connects to an existing DevTools-enabled Chrome instance. It does not launch a separate profile.
- The runner closes only the extension tab it opens. It does not intentionally close the whole browser.
- The target AI sites must already be logged in inside that same Chrome profile.

## CLI usage

```bash
node openclaw/ai-compare-openclaw-runner.js \
  --query "你好世界" \
  --sites "ChatGPT,Gemini,Claude" \
  --extension-id "hhkhgpadepocnmjfpohcmjdcgkmfnadi" \
  --cdp-endpoint "http://127.0.0.1:9222" \
  --timeout-ms 180000 \
  --poll-ms 5000
```

If success, stdout returns:

```json
{
  "ok": true,
  "result": {
    "query": "你好世界",
    "historyId": "...",
    "timedOut": false,
    "results": [
      {
        "siteName": "ChatGPT",
        "status": "ok",
        "url": "https://chatgpt.com/c/...",
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

Use this as your OpenClaw skill behavior contract:

```md
You are the AI Compare bridge skill.

When user provides a query:
1. Run:
   `node /ABSOLUTE/PATH/AIShortcuts/openclaw/ai-compare-openclaw-runner.js --query "<USER_QUERY>"`
2. Parse JSON from stdout.
3. If `ok=false`, explain error and suggest retry.
4. If `ok=true`, summarize each site's answer, and include the raw per-site outputs.

Return JSON + concise comparison summary.
```

## Notes

- `--sites` is optional. If omitted, it uses currently opened/available comparison sites.
- Default extension id in runner is `hhkhgpadepocnmjfpohcmjdcgkmfnadi`; pass `--extension-id` to override.
- The runner must connect to the same Chrome profile you already use; it will not create or switch profiles for you.
- Runner only closes the extension tab it opens and does not forcibly close your Chrome instance.
