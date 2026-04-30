# 🧠 AI Compare — 一键对比多个 AI 的回答

[English](#english) ｜ [中文](#中文)

---

## English

### ✨ Introduction

**AI Compare** (formerly "AI Shortcuts") is a browser extension that lets you compare answers from multiple AI models in one place. Enter a query once and see results from ChatGPT, Gemini, Claude, Grok, Manus, DeepSeek, Kimi, 豆包,元宝, and many more — side by side. You use your existing AI accounts; the extension does not require sign-up or paid membership.

### 📦 Features

#### 1. Multi-AI comparison page (iframe)

- **One page, multiple AIs**: Open a single tab with several AI sites embedded (iframes). Enter your query once and get responses from all selected AIs at once.
- **Fast re-entry**: After a query is sent, the input box is cleared so you can type the next question immediately.
- **Loading status**: Each embedded iframe shows a top-center loading state before script execution starts.
- **Layout**: Switch between 1 / 2 / 3 / 4 columns.
- **File upload**: Upload files (images, documents, etc.) and send them to all AI sites in one go.
- **Export**: Export all AI responses as a single file (e.g. Markdown).
- **History**: History drawer lists recent comparison sessions; click to reopen a session.
- **Query suggestions**: Prompt templates appear as buttons above the input; one click fills the query (e.g. `风险分析：「{query}」`). On `homepage` and `iframe`, suggestions are filtered by the currently selected site type.
- **Favorite query**: Star the current query to save it to Favorites.
- **Site selection**: Choose which AI sites to load and save as default (collection mode settings).

#### 2. Side panel / Homepage

- **Open**: Click the extension icon or press **⌘+M** (Mac) / **Ctrl+M** (Windows).
- **Search & compare**: Type a query, select AI sites, click PK to open the multi-AI comparison page (or open in new tab).
- **Save favorite sites**: Select sites and save as “favorite sites” for quick access.
- **Pin guide**: Optional reminder to pin the extension to the toolbar for faster access.
- **Shortcuts**: Links to Settings, History, Favorites, Feedback. Optional file upload button.

#### 3. Floating ball (optional)

- **Where**: Shown on web pages when enabled in settings (default: off).
- **Action**: Click to open the side panel; drag to move.
- **Close**: Close button offers: close for now, disable on current site only, or disable globally.
- **Extra**: Small icons for Settings and Feedback.

#### 4. Selection toolbar (optional)

- **Trigger**: Select text on any page; a toolbar appears near the selection.
- **Favorite site**: One click sends the selected text to your saved “favorite” AI site (single site).
- **Site list**: Dropdown to pick another AI site for this query.
- **PK**: Send selected text to the multi-AI comparison page.  
  Can be turned off in Options.

#### 5. Search engine toolbar (optional)

- **Where**: Google, Baidu, Bing (and cn.bing.com).
- **What**: A small toolbar next to the search box with:
  - **Favorite site**: Run current search query on your favorite AI site (single site).
  - **Site list**: Choose another AI site.
  - **PK**: Open multi-AI comparison with the current search query.  
  Can be turned off in Options.

#### 6. Site button on AI pages (optional)

- **Where**: On supported AI chat pages (e.g. ChatGPT, Claude, Gemini, Kimi) — from `siteHandlers.json` with iframe support.
- **What**: A small extension icon next to the send button.
- **Action**: Click to read the current input, open the multi-AI comparison page with that text as the query.  
  Can be turned off in config.

#### 7. Context menu

- **On extension icon (right‑click)**: Options, History, Favorites.
- **On selected text (right‑click)**: “Search with AI Compare” to query multiple AIs (if “Context Menu” is enabled in Options).

#### 8. Omnibox (address bar)

- **Keyword**: Type `ai` in the address bar, then space and your query (e.g. `ai 什么是机器学习`).
- **Action**: Opens the multi-AI comparison page with that query (current tab or new tab by how you open it).

#### 9. Options page

- **Quick entry settings**: Toggle on/off: Floating ball, Selection search, Context menu, Search engine toolbar (defaults from `appConfig.json`).
- **Disabled sites**: List of sites where the floating ball is disabled; re-enable from here.
- **Prompt templates**: Add / edit / delete templates (name, query text with `{query}`, type, display order). Template type uses the same candidate set as site config types.
- **Links**: Open History page, Favorites page.

#### 10. History & Favorites pages

- **History**: Full list of past comparison sessions; search and open again; clear history.
- **Favorites**: Saved queries/sessions; search and open again; clear all.

### 🤖 Supported AI sites (examples)

Configured in `siteHandlers.json` (enable/disable per site):  
ChatGPT, Gemini, Grok, Claude, AI Studio, DeepSeek, 豆包, 秘塔AI, 文心一言, 元宝, Kimi, 千问, Qwen, Copilot, POE, Perplexity, Bing, Google, 百度, 小红书, etc. (and more; some may be hidden or region-specific.)

### ❤️ Loved by users worldwide

From content creators, product managers, and freelancers, to editors, foreign trade professionals, and tech enthusiasts — people everywhere are saving time with AI Compare.

> "We use AI Compare every day — it saves us nearly 2 hours of manual work daily. 10/10 would recommend!"
>
> "Amazing tool! Finally, no need to open multiple AI pages — and it supports all major models. Love it!"
>
> "Simple, smart, and powerful — just what I needed."

### 📥 Install

- **Chrome**: [Chrome Web Store](https://chromewebstore.google.com/detail/multi-ai/dkhpgbbhlnmjbkihoeniojpkggkabbbl)
- **Edge**: [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ai-%E4%BB%BB%E6%84%8F%E9%97%A8-%E5%BF%AB%E9%80%9F%E8%AE%BF%E9%97%A8-chatgpt-%E8%B1%86%E5%8C%85-/pehoogkkiaidofipnnafdpcfbkhkhddo)

### 📬 Contact

- Email: AIShortcuts@outlook.com  
- WeChat（微信）: aipmgpt

### License

This project is licensed under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html).

### Development / Live verification

- For AI site adapter debugging, the repo includes real-browser live verifier scripts under `debug/`.
- Claude can be validated with `node debug/verify-claude-live.js`, which connects to your existing Chrome session through `DevToolsActivePort` and checks the real input -> send -> conversation flow.
- Similar scripts exist for other non-trivial sites such as `debug/verify-minimax-live.js`, `debug/verify-manus-live.js`, and `debug/verify-metaso-live.js`.
- `dots.ai` is now validated in real user Chrome with `node debug/verify-dots-ai-live.js`; the root URL lands in `/chat/home/<id>`, uses `textarea[placeholder="给点点发消息"]`, and submits through the arrow-up send button.

### OpenClaw skill integration

- A ready-to-use bridge is available under `openclaw/`.
- `openclaw/SKILL.md` is now an installable OpenClaw skill package for "ask once -> search through the browser extension -> return per-site results".
- Runner entry: `node openclaw/ai-compare-openclaw-runner.js --query "your query"`.
- The runner now supports `--mode gui`, which opens a direct `chrome-extension://...` query link in the browser and waits for structured callback results by default.
- `--browser-app` examples are now documented for both macOS (`"Google Chrome"`) and Windows (`"chrome"`).
- Integration guide: `openclaw/README.md`.
- If the browser extension is missing or outdated, the runner now returns actionable install / reload guidance instead of a generic failure.
- `ok=false` responses should stop at install / reload guidance; they must not fall back to `web_search` or other search tools.
- The extension page now exposes `window.aiCompareOpenClaw.run(options)` for automation.
- OpenClaw TUI smoke test: `openclaw tui --message "请用 ai-compare-bridge skill 搜索 你好世界"` returned raw ChatGPT and Gemini plugin content.

---

## 中文

### ✨ 简介

**AI 比一比**（原名「AI 任意门」）是一款浏览器扩展，在一个页面里同时对比多个 AI 的回答。输入一次问题，即可并排查看 ChatGPT、Gemini、Claude、Grok、Manus、DeepSeek、Kimi、豆包、元宝等十多个 AI 的结果。使用你已有的 AI 账号即可，扩展本身无需注册、无需付费。

### 📦 功能一览

#### 1. 多 AI 对比页（iframe）

- **一页多 AI**：在一个标签页内嵌入多个 AI 站点（iframe），输入一次问题，所有选中的 AI 同时返回结果。
- **快速继续提问**：问题发送后会自动清空输入框，方便直接输入下一轮问题。
- **加载状态**：每个子 iframe 顶部中间会先显示加载状态，避免脚本执行前看起来像卡住了。
- **布局**：支持 1 / 2 / 3 / 4 列切换。
- **文件上传**：上传图片、文档等，一键发送到所有 AI 站点。
- **导出**：将所有 AI 的回答导出为一个文件（如 Markdown）。
- **历史**：历史抽屉展示近期对比记录，点击可重新打开当次对比。
- **查询建议**：输入框上方展示提示词模板按钮，点击即可填入（如「风险分析：「{query}」」）。在 `homepage` 和 `iframe` 中，联想模板会按当前选择的站点类型过滤。
- **收藏当前问题**：可将当前问题加星，保存到收藏记录。
- **站点选择**：选择要加载的 AI 站点，并保存为合集模式默认。

#### 2. 侧边栏 / 主页

- **打开方式**：点击扩展图标，或快捷键 **⌘+M**（Mac）/ **Ctrl+M**（Windows）。
- **搜索与对比**：输入问题、勾选 AI 站点，点击 PK 打开多 AI 对比页（或在新标签页打开）。
- **保存常用站点**：勾选站点后可保存为「常用站点」，下次一键使用。
- **固定引导**：可选提示用户将扩展固定到工具栏，方便打开。
- **入口**：设置、历史记录、收藏记录、用户反馈；可选文件上传按钮。

#### 3. 悬浮球（可选）

- **出现位置**：在设置中开启后，在网页上显示（默认关闭）。
- **点击**：打开侧边栏；可拖动位置。
- **关闭**：关闭时可选「本次关闭」「当前网站禁用」「永久禁用」。
- **子入口**：设置、反馈。

#### 4. 划词工具栏（可选）

- **触发**：在任意网页选中文字后，选区旁出现工具栏。
- **常用站点**：一键将选中内容发送到已保存的「常用」AI 站点（单站点）。
- **站点列表**：下拉选择其他 AI 站点发送。
- **PK**：将选中内容带到多 AI 对比页，多站点同时查询。  
  可在选项中关闭。

#### 5. 搜索引擎工具栏（可选）

- **出现位置**：Google、百度、Bing（及 cn.bing.com）搜索框旁。
- **内容**：常用站点按钮、站点下拉、PK 按钮（用当前搜索词做多 AI 对比）。  
  可在选项中关闭。

#### 6. AI 站点内按钮（可选）

- **出现位置**：在已配置的 AI 对话页（如 ChatGPT、Claude、Gemini、Kimi 等，见 `siteHandlers.json` 且支持 iframe 的站点）。
- **形式**：发送按钮旁的扩展小图标。
- **作用**：点击后读取当前输入框内容，用该内容打开多 AI 对比页进行查询。  
  可在配置中关闭。

#### 7. 右键菜单

- **扩展图标右键**：选项、历史记录、收藏记录。
- **选中文字右键**：出现「使用 AI 比一比搜索」，可多站点查询（需在选项中开启「右键菜单」）。

#### 8. 地址栏 Omnibox

- **关键字**：在地址栏输入 `ai` 加空格，再输入问题（如 `ai 什么是机器学习`）。
- **行为**：用该问题打开多 AI 对比页（当前标签或新标签取决于打开方式）。

#### 9. 选项页

- **快捷入口设置**：开关 悬浮球、划词搜索、右键菜单、搜索引擎 是否启用（默认来自 `appConfig.json`）。
- **悬浮球禁用网站**：查看/管理「在此站禁用悬浮球」的列表，可在此重新启用。
- **提示词模板**：增删改模板（名称、带 `{query}` 的查询模板、类型、排序）。模板类型与站点配置里的 `type` 候选项保持一致。
- **入口**：历史记录页、收藏记录页。

#### 10. 历史记录与收藏记录页

- **历史记录**：全部对比历史，支持搜索、再次打开、清空。
- **收藏记录**：收藏的问题/会话，支持搜索、再次打开、清空。

### 🤖 支持的 AI 站点（示例）

在 `siteHandlers.json` 中配置，可按站点启用/关闭：  
ChatGPT、Gemini、Grok、Claude、AI Studio、DeepSeek、豆包、秘塔AI、文心、元宝、Kimi、千问、Qwen、Copilot、POE、Perplexity、Bing、Google、百度、小红书等（部分可能隐藏或按地区不可用）。

### ❤️ 被世界各地的用户喜爱

「AI 比一比」受到世界各地的自媒体从业者、外贸从业者、产品经理、自由职业者、编辑和技术人员的喜爱。

> "我们每天都在使用「AI 比一比」，它每天为我们节省了约 2 个小时的手工工作！10/10 会推荐！"
>
> "感谢作者，很惊喜，解决同时打开很多个网页的困扰，而且主流的 AI 都涉及到了～好评！"
>
> "简单、智能、强大 — 正是我需要的。"

### 📥 安装

- **Chrome**：[Chrome 网上应用店](https://chromewebstore.google.com/detail/multi-ai/dkhpgbbhlnmjbkihoeniojpkggkabbbl)
- **Edge**：[Edge 加载项](https://microsoftedge.microsoft.com/addons/detail/ai%E6%AF%94%E4%B8%80%E6%AF%94-%E5%BF%AB%E9%80%9F%E8%AE%BF%E9%97%A8-chatgpt-%E8%B1%86%E5%8C%85-/pehoogkkiaidofipnnafdpcfbkhkhddo)

### 📬 联系我们

- 邮箱：AIShortcuts@outlook.com  
- WeChat（微信）：aipmgpt

### 开源协议

本项目采用 [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html) 协议。

### 开发 / 实时验证

- 仓库在 `debug/` 目录下提供了面向真实浏览器会话的 AI 站点验证脚本，便于排查站点适配问题。
- Claude 可通过 `node debug/verify-claude-live.js` 验证，它会连接当前 Chrome 的 `DevToolsActivePort`，检查真实的输入 -> 点击发送 -> 会话创建链路。
- 其他较复杂站点也有对应脚本，例如 `debug/verify-minimax-live.js`、`debug/verify-manus-live.js`、`debug/verify-metaso-live.js`。
- `dots.ai` 现已通过 `node debug/verify-dots-ai-live.js` 在真实用户 Chrome 中验证；根 URL 会落到 `/chat/home/<id>`，输入框为 `textarea[placeholder="给点点发消息"]`，发送方式为点击箭头发送按钮。

### OpenClaw 技能接入

- 仓库 `openclaw/` 目录提供了可直接使用的桥接方案。
- `openclaw/SKILL.md` 现已整理为可安装的 OpenClaw skill，支持“用户提问 -> 调起浏览器插件搜索 -> 返回每个站点结果”。
- Runner 入口：`node openclaw/ai-compare-openclaw-runner.js --query "你的问题"`。
- Runner 新增 `--mode gui`，支持直接生成并打开 `chrome-extension://...` 查询链接，并默认等待扩展页把结构化结果回传给本地 runner。
- `--sites` 只在用户明确点名站点时才注入；普通提问会沿用 AI Compare 当前默认选中的站点集合。
- `--browser-app` 现已补充跨平台示例：macOS 用 `"Google Chrome"`，Windows 用 `"chrome"`。
- 对接说明见 `openclaw/README.md`。
- 如果浏览器插件未安装、扩展 id 不匹配或版本过旧，runner 现在会返回可执行的安装/重载引导，而不是笼统报错。
- `ok=false` 时要直接停在安装/重载引导，不要回退到 `web_search` 或其他搜索工具。
- 扩展对比页新增自动化接口：`window.aiCompareOpenClaw.run(options)`。
- OpenClaw TUI 烟雾测试：`openclaw tui --message "请用 ai-compare-bridge skill 搜索 你好世界"` 已返回 ChatGPT 和 Gemini 的原始插件内容。

---

<!-- AUTO-README-STATUS:START -->
## Development Snapshot / 开发快照

Last auto-update / 最近自动更新：2026-04-30 13:28:01 UTC+08:00

### Staged changes for this commit / 本次提交暂存变更
- `M` `.DS_Store`
- `M` `.gitignore`
- `M` `_locales/en/messages.json`
- `M` `_locales/zh_CN/messages.json`
- `M` `config/siteHandlers.json`
- `M` `iframe/export-responses.js`
- `M` `iframe/iframe.css`
- `M` `iframe/iframe.js`
- `M` `iframe/inject.js`
- `M` `iframe/openclaw-bridge.js`
- `M` `manifest.json`
- `M` `openclaw/README.md`
- `M` `openclaw/SKILL.md`
- `M` `openclaw/ai-compare-openclaw-runner.js`
- `A` `openclaw/references/install-browser-extension.md`

### Recent commits / 最近提交
- `44a31f8` 2026-04-20 V 2.21.7 支持点点，默认模板增加翻译到中文
- `660c1c6` 2026-04-12 V2.21.6 修复豆包
- `ef11035` 2026-04-08 V 2.21.5 修复不支持 iframe 的站点
- `d671284` 2026-03-30 V 2.21.4 修复秘塔、claude，提示词分组
- `ec08961` 2026-03-24 V2.21.3 划词支持选择模板、支持配置

_This section is maintained automatically by `scripts/update-readme.js` via `.githooks/pre-commit`._
<!-- AUTO-README-STATUS:END -->
