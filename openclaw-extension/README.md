# OpenClaw Extension: AI Compare Hard Router

This is the publishable OpenClaw plugin package for AI Compare.

## What it does

- Intercepts search-style messages in `before_dispatch`
- Matches explicit search phrases such as `搜索 XX`, `查一下 XX`, `搜一下 XX`, `我要搜索 XX`, `search for XX`, and `look up XX`
- Also matches softer research-style phrases such as `了解一下 XX`, `研究一下 XX`, `看看 XX`, `比较一下 XX`, `learn about XX`, `look into XX`, and `compare XX`
- Calls the AI Compare GUI runner directly
- Returns the raw runner JSON payload instead of model-written summaries

## Install

### Recommended: release package

```bash
openclaw plugins install /path/to/ai-compare-hard-router.zip
openclaw plugins enable ai-compare-hard-router
openclaw gateway restart
```

### Development: linked local plugin

```bash
openclaw plugins install --link <REPO_ROOT>/openclaw-extension
openclaw plugins enable ai-compare-hard-router
openclaw gateway restart
```

## Required companion

Install the AI Compare browser extension in the same Chrome profile that OpenClaw will use. The plugin only routes requests; the browser extension does the actual multi-site execution.

## Configuration

Add plugin config to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "ai-compare-hard-router": {
        "enabled": true,
        "config": {
          "extensionId": "<EXTENSION_ID>",
          "browserApp": "Google Chrome",
          "timeoutMs": 190000,
          "installUrl": "<INSTALL_URL>",
          "debugLogPath": "~/.openclaw/logs/ai-compare-hard-router.log"
        }
      }
    }
  }
}
```

For a release build, set `extensionId` and `installUrl` to the Chrome Web Store values for that release. For a private or unpacked build, point `extensionId` at the installed Chrome extension id and `installUrl` at the matching install page or onboarding page.

## Behavior notes

- If the user explicitly asks for `web search`, `google search`, `bing search`, `网页搜索`, or `新闻搜索`, this plugin does not claim the request
- If the user explicitly names sites like `ChatGPT` or `Gemini`, the plugin adds `--sites`
- Missing extension and callback timeout errors are surfaced directly instead of falling back to web search
- Successful runs are passed through as raw JSON from the bundled runner
