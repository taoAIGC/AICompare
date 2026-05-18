# OpenClaw Extension: AI Compare Hard Router

This is the publishable OpenClaw plugin package for AI Compare.

## What it does

- Intercepts search-style messages in `before_dispatch`
- Matches explicit search phrases such as `搜索 XX`, `查一下 XX`, `搜一下 XX`, `我要搜索 XX`, `search for XX`, and `look up XX`
- Also matches softer research-style phrases such as `了解一下 XX`, `研究一下 XX`, `看看 XX`, `比较一下 XX`, `learn about XX`, `look into XX`, and `compare XX`
- Calls the AI Compare GUI runner directly
- Returns per-site blocks with only site name, URL, and extracted content instead of model-written summaries

## Install

```bash
openclaw plugins install git:github.com/taoAIGC/AIBridge --dangerously-force-unsafe-install
openclaw gateway restart
```

Why the extra flag:

- The plugin intentionally uses local runner scripts and `child_process` to open the AI Compare browser flow.
- OpenClaw's safety scanner blocks that pattern by default.
- Users should only install it from a trusted source.

## Required companion

Install the AI Compare browser extension in the same Chrome profile that OpenClaw will use. The plugin only routes requests; the browser extension does the actual multi-site execution.

If the browser extension is not installed yet, use the Chrome Web Store page:

`https://chromewebstore.google.com/detail/dkhpgbbhlnmjbkihoeniojpkggkabbbl`

For local development, load the unpacked extension from `chrome://extensions` and make sure the loaded extension id is `hhkhgpadepocnmjfpohcmjdcgkmfnadi`.

## Configuration

Add plugin config to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "ai-compare-hard-router": {
        "enabled": true,
        "config": {
          "environment": "production",
          "browserApp": "Google Chrome",
          "timeoutMs": 190000,
          "debugLogPath": "~/.openclaw/logs/ai-compare-hard-router.log"
        }
      }
    }
  }
}
```

Minimum effective config:

- `enabled: true`
- `environment: "production"`

Recommended config:

- `browserApp: "Google Chrome"` to force the expected browser
- `timeoutMs: 190000` to give the full browser runner enough time
- `debugLogPath: "~/.openclaw/logs/ai-compare-hard-router.log"` for troubleshooting

Environment behavior:

- `environment: "production"` uses extension id `dkhpgbbhlnmjbkihoeniojpkggkabbbl` and the Chrome Web Store install URL.
- `environment: "development"` uses extension id `hhkhgpadepocnmjfpohcmjdcgkmfnadi` and expects an unpacked extension loaded from `chrome://extensions`.
- `extensionId` and `installUrl` still work as explicit overrides when you need a private build or a different release.

## Verify install

1. Restart the formal gateway:

```bash
openclaw gateway restart
```

2. Confirm the runtime install source and hooks:

```bash
openclaw plugins inspect ai-compare-hard-router --runtime --json
```

3. Confirm the plugin log is active:

```bash
tail -n 50 ~/.openclaw/logs/ai-compare-hard-router.log
```

4. Test from the formal gateway path, not embedded fallback:

```bash
TOKEN=$(jq -r '.gateway.auth.token' ~/.openclaw/openclaw.json)
openclaw tui --token "$TOKEN" --message '搜索一下 OpenAI'
```

If the plugin is working, the log should show `before_dispatch.match`, then `before_dispatch.runner_complete`, then `before_dispatch.handled`.

## Usage requirements

- Install the Chrome extension into the same Chrome profile that OpenClaw will open.
- Make sure that Chrome profile is already logged into the target AI sites you want AI Compare to use.
- Use search-style prompts such as `搜索一下 OpenAI`, `查一下...`, `compare...`, or `look up...`.
- If you want OpenClaw to keep using its normal web-search flow, ask explicitly for `web search`, `google search`, `bing search`, `网页搜索`, or `新闻搜索`.

## Behavior notes

- If the user explicitly asks for `web search`, `google search`, `bing search`, `网页搜索`, or `新闻搜索`, this plugin does not claim the request
- If the user explicitly names sites like `ChatGPT` or `Gemini`, the plugin adds `--sites`
- Missing extension and callback timeout errors are surfaced directly instead of falling back to web search
- Successful runs are returned as structured site blocks containing only site name, URL, and content
