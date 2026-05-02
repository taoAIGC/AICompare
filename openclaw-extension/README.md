# OpenClaw Extension: AI Compare Hard Router

This folder is separate from [openclaw](/Users/hasee/Documents/同步文稿/multi-AI/AIShortcuts/openclaw), which remains the skill-style integration. `openclaw-extension/` is the maintainable plugin-style hard router.

## Recommended for users

This is the recommended OpenClaw integration for end users.

If you want OpenClaw users to say `搜索 XX` directly and have the request routed into the AI Compare browser extension without explicitly naming a skill, install this plugin.

`openclaw/` should be treated as the shared runner / compatibility layer behind this plugin, not as the primary user-facing install path.

## What it does

- Intercepts search-style messages in `before_dispatch`, before the model starts reasoning.
- Matches explicit search phrases such as `搜索 XX`, `查一下 XX`, `搜一下 XX`, `我要搜索 XX`, `search for XX`, and `look up XX`.
- Also matches softer research-style phrases such as `了解一下 XX`, `研究一下 XX`, `看看 XX`, `比较一下 XX`, `learn about XX`, `look into XX`, and `compare XX`, while avoiding obvious local-debug requests like `看一下这个报错` or explicit `web search` requests.
- Calls the AI Compare GUI runner directly.
- Returns raw per-site results instead of model-written summaries.
- Avoids OpenClaw core patching, so upgrades do not overwrite this logic.

## Install as a linked local plugin

Linked install is the recommended path during development because edits in this repo take effect without copying files around:

```bash
openclaw plugins install --link /Users/hasee/Documents/同步文稿/multi-AI/AIShortcuts/openclaw-extension
openclaw plugins enable ai-compare-hard-router
```

Then restart the gateway:

```bash
openclaw gateway restart
```

## End-user setup checklist

1. Install the AI Compare browser extension into the same Chrome profile that OpenClaw will use.
2. Install and enable this OpenClaw plugin:

```bash
openclaw plugins install --link /Users/hasee/Documents/同步文稿/multi-AI/AIShortcuts/openclaw-extension
openclaw plugins enable ai-compare-hard-router
openclaw gateway restart
```

3. Add plugin config to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "ai-compare-hard-router": {
        "enabled": true,
        "config": {
          "runnerPath": "/Users/hasee/Documents/同步文稿/multi-AI/AIShortcuts/openclaw/ai-compare-openclaw-fast.js",
          "extensionId": "hhkhgpadepocnmjfpohcmjdcgkmfnadi",
          "browserApp": "Google Chrome",
          "timeoutMs": 190000,
          "installUrl": "https://chromewebstore.google.com/detail/multi-ai/hhkhgpadepocnmjfpohcmjdcgkmfnadi",
          "debugLogPath": "/Users/yourname/.openclaw/logs/ai-compare-hard-router.log",
          "includeRawJson": false,
          "maxOutputCharsPerSite": 12000
        }
      }
    }
  }
}
```

Windows users can usually change:

```json
"browserApp": "chrome"
```

4. After setup, OpenClaw users can trigger it with natural search-style requests such as:

```text
搜索大模型的方案
```

or:

```text
search for MCP server framework
```

## Runner resolution

The plugin looks for the GUI runner in this order:

1. `plugins.entries.ai-compare-hard-router.config.runnerPath`
2. `AI_COMPARE_OPENCLAW_FAST_RUNNER`
3. sibling repo path `../openclaw/ai-compare-openclaw-fast.js`
4. `~/.openclaw/workspace/skills/ai-compare-bridge/ai-compare-openclaw-fast.js`

When installed with `--link`, item 3 works by default in this repo.

## Optional config

Example snippet for `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "ai-compare-hard-router": {
        "enabled": true,
        "config": {
          "runnerPath": "/Users/hasee/Documents/同步文稿/multi-AI/AIShortcuts/openclaw/ai-compare-openclaw-fast.js",
          "extensionId": "hhkhgpadepocnmjfpohcmjdcgkmfnadi",
          "browserApp": "Google Chrome",
          "timeoutMs": 190000,
          "installUrl": "https://chromewebstore.google.com/detail/multi-ai/hhkhgpadepocnmjfpohcmjdcgkmfnadi",
          "debugLogPath": "/Users/yourname/.openclaw/logs/ai-compare-hard-router.log",
          "includeRawJson": false,
          "maxOutputCharsPerSite": 12000
        }
      }
    }
  }
}
```

## Behavior notes

- If the user explicitly asks for `web search`, `google search`, `bing search`, `网页搜索`, or `新闻搜索`, this plugin does not claim the request.
- If the user explicitly names sites like `ChatGPT` or `Gemini`, the plugin adds `--sites`.
- Missing extension and callback timeout errors are surfaced directly instead of falling back to web search.
