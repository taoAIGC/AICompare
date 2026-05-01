---
name: ai-compare-bridge
description: MUST use this whenever the user asks to search, look up, query, or compare answers for a topic, even if they do not explicitly mention AI Compare. Trigger on phrases like “搜索XX”, “查一下XX”, “搜一下XX”, “帮我搜XX”, “我要搜索XX”, “search for XX”, and “look up XX”. Do not use web_search for these requests.
---

# AI Compare Browser Search

你是「AI 比一比」的 OpenClaw skill。收到“搜索类”请求时，直接调用本地 fast runner，用浏览器插件返回各站点原始结果。

## Fast Path

- `ai-compare-bridge` 是 skill，不是 subagent。
- 先读取本文件，然后直接执行下面命令。
- 不要改用 `web_search`，也不要把命令写成复合 shell。

默认命令：

```bash
node /Users/hasee/.openclaw/workspace/skills/ai-compare-bridge/ai-compare-openclaw-fast.js --query "<USER_QUERY>"
```

只有用户明确点名站点时，才追加：

```bash
--sites "ChatGPT,Gemini"
```

可选参数：

```bash
--extension-id "<EXTENSION_ID>"
--browser-app "Google Chrome"
--browser-app "chrome"
--print-only
--open-only
```

## Hard Rules

- 统一走 `GUI + localhost callback`，不要回退到 CDP。
- 用户没指定站点时，不要主动添加 `--sites`。
- runner 返回失败时，不要切换到 `web_search`、`browse` 或其他搜索工具。
- 输出时直接展示各站点原始 `content`，不要总结、翻译或改写。
- 站点状态为 `timeout`、`error`、`short`、`empty` 或 `extraction_error` 时，要明确点名该站点结果不完整。

## Missing Extension Response

当 stdout JSON 中 `ok=false`，且错误包含 `browser extension is not available`、`missing_extension` 或 `automation bridge is missing` 时，最终回复必须包含：

```md
这次没有通过 AI Compare 返回站点结果，因为当前 Chrome profile 里还没有可用的 AI Compare 扩展。

安装插件：
https://chromewebstore.google.com/detail/multi-ai/dkhpgbbhlnmjbkihoeniojpkggkabbbl

或者加载本地开发版：
- 打开 `chrome://extensions`
- 开启 `Developer mode`
- 点击 `Load unpacked`
- 选择 AI Compare 仓库目录

如果扩展已经装过，再点一次 `Reload` 后告诉我，我再用 ai-compare-bridge 重新搜索。
```

不要追加网页搜索结果作为替代。

## Timeout Guidance

如果错误包含 `Timed out waiting for GUI callback`，优先提示用户检查：

- 插件是否安装在同一个 Chrome profile
- 目标 AI 站点是否已登录
- 扩展页是否真的停留在 `chrome-extension://.../iframe/iframe.html?...`
- 如只想触发搜索可改用 `--open-only`
