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
- **Deep research toggle**: Use the `Deep Research` button in the iframe toolbar to turn on supported deep-research switches across the currently open sub-pages in one go.
- **File upload**: Upload files (images, documents, etc.) and send them to all AI sites in one go.
- **History**: History drawer lists recent comparison sessions; click to reopen a session.
- **Query suggestions**: Prompt templates appear as buttons above the input; one click fills the query (e.g. `风险分析：「{query}」`). On `homepage` and `iframe`, suggestions are filtered by the currently selected site type.
- **Launch URLs**: Official sites can use a custom `entryUrl` so the homepage, iframe comparison page, and external shortcuts open a saved session URL instead of the root page. Use `{query}` when the URL should include the search text.
- **Custom sites**: Add standalone sites that only open the page. They do not inject prompts or run automation, and can optionally carry a note tooltip plus an icon filename for iframe navigation.
- **Favorite query**: Star the current query to save it to Favorites.
- **Site selection**: Choose which AI sites to load and save as default (collection mode settings).

#### 2. Side panel / Homepage

- **Open**: Click the extension icon or press **⌘+M** (Mac) / **Ctrl+M** (Windows).
- **Search & compare**: Type a query, select AI sites, click PK to open the multi-AI comparison page (iframe-capable sites only).
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
- **PK**: Send selected text to the multi-AI comparison page (iframe-capable sites only).  
  Can be turned off in Options.

#### 5. Search engine toolbar (optional)

- **Where**: Google, Baidu, Bing (and cn.bing.com).
- **What**: A small toolbar next to the search box with:
  - **Favorite site**: Run current search query on your favorite AI site (single site).
  - **Site list**: Choose another AI site.
  - **PK**: Open multi-AI comparison with the current search query (iframe-capable sites only).  
  Can be turned off in Options.

#### 6. Site button on AI pages (optional)

- **Where**: On supported AI chat pages (e.g. ChatGPT, Claude, Gemini, Kimi) — from `siteHandlers.json` with iframe support.
- **What**: A small extension icon next to the send button.
- **Action**: Click to read the current input, open the multi-AI comparison page with that text as the query (iframe-capable sites only).  
  Can be turned off in config.

#### 7. Context menu

- **On extension icon (right‑click)**: Options, History, Favorites.
- **On selected text (right‑click)**: “Search with AI Compare” to query multiple AIs (iframe-capable sites only, if “Context Menu” is enabled in Options).

#### 8. Omnibox (address bar)

- **Keyword**: Type `ai` in the address bar, then space and your query (e.g. `ai 什么是机器学习`).
- **Action**: Opens the multi-AI comparison page with that query (current tab or new tab by how you open it).

#### 9. Options page

- **Quick entry settings**: Toggle on/off: Floating ball, Selection search, Context menu, Search engine toolbar (defaults from `appConfig.json`). Changes apply to already open tabs immediately.
- **Launch settings**: Customize official site entry URLs and manage standalone custom sites.
- **Agent settings**: Override each built-in skill's display name, description, and persona prompt.
- **API settings**: Configure the shared skill engine used by the built-in skills.
- **Sidebar subpages**: Each settings group opens as its own subpage in the right panel instead of one long scroll page.
- **Disabled sites**: List of sites where the floating ball is disabled; re-enable from here.
- **Cloud sync**: Use WebDAV or Google Drive to sync settings across devices.
- **Prompt templates**: Add / edit / delete templates (name, query text with `{query}`, type, display order). Template type uses the same candidate set as site config types.
- **Local backup**: Export the current sync data to a JSON file and restore it later without including cloud credentials. History records in backups are capped at the first 500 items.
- **Links**: Open History page, Favorites page.

#### 10. History & Favorites pages

- **History**: Full list of past comparison sessions; search and open again; clear history.
- **Favorites**: Saved queries/sessions; search and open again; clear all.
- **Hybrid timeline**: Mixed site + skill sessions now keep skill user turns in the compare timeline too, so reopening hybrid history can still identify each skill dialogue round for scroll/copy preview.

#### 11. Remote Search v1

- **Phone -> desktop search**: Pair one phone to one Chrome session by QR code, then start comparison searches remotely from the phone.
- **Desktop-controlled site list**: The mobile app never picks sites in v1. It always uses the extension’s current enabled iframe-capable sites.
- **Privacy model**: The relay stores only pairing / device metadata. Query text and result payloads are transported through end-to-end encrypted WebSocket frames.
- **Current scope**: Chrome must already be running with the extension loaded, and non-iframe / standalone sites are intentionally excluded from remote v1.

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

- **Chrome**: [Chrome Web Store](https://chromewebstore.google.com/detail/multi-ai/<EXTENSION_ID>)
- **Edge**: [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ai-%E4%BB%BB%E6%84%8F%E9%97%A8-%E5%BF%AB%E9%80%9F%E8%AE%BF%E9%97%A8-chatgpt-%E8%B1%86%E5%8C%85-/pehoogkkiaidofipnnafdpcfbkhkhddo)

### 📬 Contact

- Email: AIShortcuts@outlook.com  
- WeChat（微信）: aipmgpt

### License

This project is licensed under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html).

### Development / Live verification

- For AI site adapter debugging, the repo includes real-browser live verifier scripts under `debug/`.
- The current UI refresh uses shared surface tokens across the homepage, options, history, favorites, contact, iframe, and reusable overlays so the shell reads as one product.
- Remote Search v1 adds three new top-level work areas:
  - `remote/`: MV3 service-worker runtime, storage helpers, protocol constants, and crypto helpers for remote pairing/search.
  - `remote-relay/`: standalone Node 20 relay service (`express` + `ws`) with metadata-only persistence and `node:test` coverage.
  - `mobile-app/`: standalone Flutter mobile companion scaffold for QR pairing, reconnect, composer, streaming results, and unpair flow.
- Remote Search requires Chrome 116+ because the extension now relies on MV3 WebSocket keepalive behavior plus `alarms` / `notifications`.
- To run the local relay for Remote Search development:
  1. `cd remote-relay`
  2. `npm install`
  3. `npm start`
- After the relay is running, open `options/options.html#remote-search`, enable Remote Search, set the relay URL, save, and generate the pairing QR.
- Remote Search tests and verifiers now include:
  - Root extension unit tests: `node --test tests/*.test.js`
  - Relay tests: `cd remote-relay && npm test`
  - Local Remote Search verifier: `node debug/verify-remote-search-local.js`
  - Playwright Remote Search verifier: `node debug/verify-remote-search-playwright.js`
- Timeline copy preview now supports self-hosted share URLs. Set `Settings -> Remote Search -> Relay URL` to your relay base URL such as `http://64.188.6.42:8789`, then use the preview modal's share icon to create a public link and copy it to the clipboard.
- The timeline copy preview's copy button now keeps the Responses summary modal open after copying.
- The preview body now only shows copyable site responses; failed sites stay in the summary header.
- Copy/share actions in the Responses summary modal now show feedback next to the clicked button instead of using the top toast.
- The relay's share endpoints are `POST /shares`, `GET /shares/:shareId`, and `GET /share/:shareId`. For public links, set `PUBLIC_BASE_URL` before starting `remote-relay` so returned `publicUrl` values point at the externally reachable host.
- Share records are now persisted on disk. Set `SHARE_STORE_FILE` for `remote-relay` if you want the share data file in a stable external path; otherwise it defaults to `remote-relay/data/shares.json`.
- The DevTools-based verifier expects a real Chrome profile with the extension installed and a reachable endpoint from `DevToolsActivePort`. If that port points to a stale or non-debuggable browser session, it will fail before the extension flow starts. The Playwright verifier launches its own persistent Chromium profile and does not need `DevToolsActivePort`.
- The packaged MV3 extension no longer includes any Firebase JS SDK CDN imports; membership uses local extension code plus Firebase REST endpoints, while cloud sync now supports WebDAV and Google Drive.
- Site handler synchronization now fetches `config/siteHandlers.json` from GitHub raw at runtime and falls back to the bundled copy if the remote check fails.
- The site-handler update prompt now uses a localized card-style notification plus a details dialog instead of the old plain toast.
- Core end-to-end extension verifiers now exist for ChatGPT, Gemini, DeepSeek, Grok, Claude, MiniMax, Manus, dots.ai, Nano Banana, Google Translate, and Bing Translate.
- Claude can be validated with `node debug/verify-claude-live.js`, which connects to your existing Chrome session through `DevToolsActivePort` and checks the real input -> send -> conversation flow. `node debug/inspect-claude-response.js` prints the outer shell versus the `main .font-claude-response` answer body.
- Timeline copy now keeps each site response as one block, so multi-paragraph answers stay together instead of being split into numbered sub-answers.
- Timeline copy preview now preserves list markers like `•` when the source answer contains bullet lists.
- The timeline copy preview now has a new-tab analysis path: the preview modal can open the default extension compare page, pass the question/summary/raw answers through `chrome.storage.session`, and reuse the existing compare flow without going through OpenClaw.
- The timeline copy preview also supports selectable analysis prompt templates, and the Settings page includes a matching analysis prompt template manager with default presets.
- ChatGPT / Gemini / DeepSeek can also be verified through the extension’s own end-to-end path with `node debug/verify-chatgpt-live.js`, `node debug/verify-gemini-live.js`, and `node debug/verify-deepseek-live.js`.
- Similar scripts exist for other non-trivial sites such as `debug/verify-minimax-live.js`, `debug/verify-manus-live.js`, `debug/verify-metaso-live.js`, `debug/verify-ai-studio-live.js`, `debug/verify-yuanbao-live.js`, `debug/verify-qianwen-live.js`, and `debug/verify-qwen-live.js`.
- Yuanbao / Qwen / 千问 verifiers now follow the explicit send-button or new-chat bootstrap paths exposed by the live pages, instead of relying on Enter alone.
- `dots.ai` is now validated in real user Chrome with `node debug/verify-dots-ai-live.js`; the root URL lands in `/chat/home/<id>`, uses `textarea[placeholder="给点点发消息"]`, and submits through the arrow-up send button.
- Nano Banana’s image flow can be smoke-checked with `node debug/verify-nano-banana-live.js`, which runs the real extension page against the Flow project bootstrap path.
- Static config drift can be checked with `node debug/validate-site-configs.js`.
- Prompt-template persona benchmarking can be run with `node debug/prompt-persona-benchmark.mjs`; set `PPTOKEN_API_KEY`, optionally `PPTOKEN_API_BASE`, `PPTOKEN_MODEL`, `BENCHMARK_RUN_ID`, and `BENCHMARK_CONCURRENCY`, then inspect `debug/benchmark-results/<run-id>/` for raw answers plus the scored report.
- The built-in skill-engine defaults are now centralized in `config/agentEngineConfig.js`, currently targeting Volcengine Ark OpenAI-compatible Coding API at `https://ark.cn-beijing.volces.com/api/coding/v3` with model `glm-5.1`; the bundled API key is stored there as ciphertext and decrypted at runtime, user-saved values still override them, and each skill uses only its own persona prompt as the system prompt.
- Imported GitHub `SKILL.md` entries can be converted into custom skills through `Settings -> Agent settings -> Import from URL`, and the dedicated verifier is `node debug/verify-agent-import-runtime-playwright.js`.
- Built-in skills now support deletion from Settings too. For bundled skills this is implemented as a per-device hidden list stored in local storage, so deleted built-ins disappear from Settings, homepage, and iframe agent selection without mutating the bundled catalog.
- The default retry ceiling for configured step retries is now 10 attempts.
- Config-driven `sendKeys` steps now honor `waitForElement`, `maxAttempts`, and `retryInterval`, so Enter-based submits can retry like `focus` / `setValue` / `triggerEvents`.
- Timeline copy now shows a "Copying..." toast first and falls back to `execCommand('copy')` if `navigator.clipboard.writeText` fails.
- A scheduled real-browser sweep can be run with `node debug/run-live-site-checks.js --group core --write-report`.
- `--group core` is intended for daily smoke checks on the highest-risk adapters; `--group full` adds the broader verifier set and logic/config probes.
- The aggregated report includes pass/fail status, soft external failures such as login/rate-limit, and the current coverage gap list for configured sites that still do not have dedicated live verifiers.
- macOS users can adapt `debug/launchd/com.aicompare.site-checks.plist.template` into `~/Library/LaunchAgents/` to run the core check on a schedule with the real Chrome profile.

### OpenClaw skill integration

- There are two OpenClaw-facing folders in this repo, with different roles:
  - `openclaw-extension/`: the maintainable OpenClaw plugin / hard-router layer. It intercepts search-style requests before normal model dispatch and is the recommended default integration path.
  - `openclaw/`: the runner + skill compatibility layer. It contains the GUI runner, fast wrapper, and installable skill package used by the hard router and by legacy skill-style installs.
- The browser extension itself still lives in the main repo root (`manifest.json`, `iframe/`, `content-scripts/`, etc.). `openclaw-extension/` is not the browser extension bundle; it is the OpenClaw plugin that routes requests into the browser extension.
- Latest end-to-end verification passed on the formal hard-router path: `openclaw-extension/` as the entry layer, `openclaw/ai-compare-openclaw-fast.js` / `openclaw/ai-compare-openclaw-runner.js` as the runner layer, and the browser extension runtime (`iframe/inject.js`, `iframe/iframe.js`, `iframe/openclaw-bridge.js`) as the execution layer.
- If you want the production-style behavior where users can say `搜索 XX` directly without explicitly naming the skill, prefer installing `openclaw-extension/`. Keep `openclaw/` available as the shared runner / compatibility package.
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
- GitHub packaging now maintains two release-note docs before producing the zip artifact:
  `docs/release-notes/latest.md` stores the running user-facing improvement request log, and `docs/release-notes/history.md` appends one user-facing version summary per packaged build.
- Local git commits now auto-refresh the release-note docs in `.githooks/pre-commit`, and `.githooks/post-commit` pushes the committed branch to `origin` so updated `README.md`, privacy docs, and `history.md` sync to GitHub immediately.

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
- **深度研究开关**：iframe 页工具栏新增“深度研究”按钮，可一次性为当前已打开且支持的子页面开启深度研究。
- **文件上传**：上传图片、文档等，一键发送到所有 AI 站点。
- **导出**：将所有 AI 的回答导出为一个文件（如 Markdown）。
- **历史**：历史抽屉展示近期对比记录，点击可重新打开当次对比。
- **查询建议**：输入框上方展示提示词模板按钮，点击即可填入（如「风险分析：「{query}」」）。在 `homepage` 和 `iframe` 中，联想模板会按当前选择的站点类型过滤。
- **启动网址**：官方站点可以单独配置 `entryUrl`，让主页、iframe 对比页和外部快捷入口直接打开已存在的会话 URL，而不是始终回到根页面。URL 需要带查询词时可使用 `{query}`。
- **自定义网站**：可添加只负责打开页面的独立网站，不做提示词注入或自动化操作，还可以附带备注和图标文件名，方便在主页和 iframe 导航中识别。
- **收藏当前问题**：可将当前问题加星，保存到收藏记录。
- **站点选择**：选择要加载的 AI 站点，并保存为合集模式默认。

#### 2. 侧边栏 / 主页

- **打开方式**：点击扩展图标，或快捷键 **⌘+M**（Mac）/ **Ctrl+M**（Windows）。
- **搜索与对比**：输入问题、勾选 AI 站点，点击 PK 打开多 AI 对比页（仅加载支持 iframe 的站点）。
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
- **PK**：将选中内容带到多 AI 对比页（仅加载支持 iframe 的站点），多站点同时查询。  
  可在选项中关闭。

#### 5. 搜索引擎工具栏（可选）

- **出现位置**：Google、百度、Bing（及 cn.bing.com）搜索框旁。
- **内容**：常用站点按钮、站点下拉、PK 按钮（用当前搜索词做多 AI 对比，仅加载支持 iframe 的站点）。  
  可在选项中关闭。

#### 6. AI 站点内按钮（可选）

- **出现位置**：在已配置的 AI 对话页（如 ChatGPT、Claude、Gemini、Kimi 等，见 `siteHandlers.json` 且支持 iframe 的站点）。
- **形式**：发送按钮旁的扩展小图标。
- **作用**：点击后读取当前输入框内容，用该内容打开多 AI 对比页进行查询（仅加载支持 iframe 的站点）。  
  可在配置中关闭。

#### 7. 右键菜单

- **扩展图标右键**：选项、历史记录、收藏记录。
- **选中文字右键**：出现「使用 AI 比一比搜索」，可多站点查询（仅加载支持 iframe 的站点，需在选项中开启「右键菜单」）。

#### 8. 地址栏 Omnibox

- **关键字**：在地址栏输入 `ai` 加空格，再输入问题（如 `ai 什么是机器学习`）。
- **行为**：用该问题打开多 AI 对比页（当前标签或新标签取决于打开方式）。

#### 9. 选项页

- **快捷入口设置**：开关 悬浮球、划词搜索、AI 站内按钮、右键菜单、搜索引擎 是否启用（默认来自 `appConfig.json`）。已打开的页面会立即同步开关状态，无需刷新。
- **启动网址设置**：可配置官方站点入口 URL，并管理独立的自定义网站。
- **智能体设置**：按 Skill 覆盖显示名称、简介和 persona 提示词。
- **API 设置**：配置内置 Skill 共用的引擎参数。
- **侧边栏子页面**：每个设置分组会在右侧作为独立子页面打开，不再堆成一个长滚动页。
- **悬浮球禁用网站**：查看/管理「在此站禁用悬浮球」的列表，可在此重新启用。
- **云同步**：使用 WebDAV 或 Google Drive 在不同设备之间同步设置。
- **提示词模板**：增删改模板（名称、带 `{query}` 的查询模板、类型、排序）。模板类型与站点配置里的 `type` 候选项保持一致。
- **本地备份**：可将当前同步数据导出为 JSON 文件并随后恢复，且不会包含云端凭据。备份中的历史记录最多保留前 500 条。
- **入口**：历史记录页、收藏记录页。

#### 10. 历史记录与收藏记录页

- **历史记录**：全部对比历史，支持搜索、再次打开、清空。
- **收藏记录**：收藏的问题/会话，支持搜索、再次打开、清空。

#### 11. 远程搜索 v1

- **手机发起、电脑执行**：通过二维码把一台手机绑定到一个 Chrome 会话后，手机就可以远程发起 AI Compare 搜索。
- **站点选择仍由桌面端决定**：v1 中手机端不会选择站点，只会沿用扩展当前启用且支持 iframe 的站点集合。
- **隐私模型**：relay 只保存设备 / 配对元数据；查询和结果通过端到端加密的 WebSocket 帧传输。
- **桌面端控制面板**：远程搜索的完整设置位于 `options/options.html#remote-search`，主页只显示一个精简状态卡和入口。
- **当前范围**：Chrome 必须已经打开并加载扩展；非 iframe / 独立页站点有意不纳入远程 v1。

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

- **Chrome**：[Chrome 网上应用店](https://chromewebstore.google.com/detail/multi-ai/<EXTENSION_ID>)
- **Edge**：[Edge 加载项](https://microsoftedge.microsoft.com/addons/detail/ai%E6%AF%94%E4%B8%80%E6%AF%94-%E5%BF%AB%E9%80%9F%E8%AE%BF%E9%97%A8-chatgpt-%E8%B1%86%E5%8C%85-/pehoogkkiaidofipnnafdpcfbkhkhddo)

### 📬 联系我们

- 邮箱：AIShortcuts@outlook.com  
- WeChat（微信）：aipmgpt

### 开源协议

本项目采用 [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html) 协议。

### 开发 / 实时验证

- 仓库在 `debug/` 目录下提供了面向真实浏览器会话的 AI 站点验证脚本，便于排查站点适配问题。
- 本次 UI 优化已把主页、选项页、历史记录、收藏记录、联系页、iframe 工作台和复用弹窗统一到同一套 surface token 语言里，让壳层看起来像同一个产品。
- 远程搜索 v1 新增了三块顶层目录：
  - `remote/`：MV3 service worker 远程运行时、存储助手、协议常量与加密辅助。
  - `remote-relay/`：独立的 Node 20 relay 服务，使用 `express` + `ws`，只保存元数据，并带有 `node:test` 测试。
  - `mobile-app/`：独立的 Flutter 手机端骨架，覆盖扫码配对、重连、搜索输入、流式结果和解绑流程。
- 远程搜索要求 Chrome 116+，因为扩展新增了基于 MV3 的 WebSocket 保活、`alarms` 和 `notifications` 能力。
- 本地启动 relay 的步骤：
  1. `cd remote-relay`
  2. `npm install`
  3. `npm start`
- relay 启动后，打开 `options/options.html#remote-search`，启用远程搜索、填写 relay 地址、保存，然后生成配对二维码。
- 远程搜索相关的测试 / verifier：
  - 扩展根目录单测：`node --test tests/*.test.js`
  - relay 测试：`cd remote-relay && npm test`
  - 本地远程搜索 verifier：`node debug/verify-remote-search-local.js`
  - Playwright 远程搜索 verifier：`node debug/verify-remote-search-playwright.js`
- 基于 DevTools 的本地 verifier 依赖真实 Chrome 用户态、已安装扩展，以及 `DevToolsActivePort` 指向一个可连接的调试端口；如果该端口指向的是过期或不可调试的会话，脚本会在进入扩展链路前失败。Playwright 版本会自己拉起持久化 Chromium 用户态，不需要 `DevToolsActivePort`。
- 打包后的 MV3 扩展不再包含 Firebase JS SDK 的 CDN `import`；会员登录走扩展内本地代码配合 Firebase REST 接口，云同步则支持 WebDAV 和 Google Drive。
- 站点处理器同步现在会在运行时从 GitHub raw 拉取 `config/siteHandlers.json`，失败时回退到扩展包内的内置副本。
- 站点处理器更新提示现在改成了支持国际化的卡片式通知加详情弹窗，不再是旧的纯文本 toast。
- 目前 core 端到端验证已覆盖 ChatGPT、Gemini、DeepSeek、Grok、Claude、MiniMax、Manus、点点、Nano Banana、Google Translate、Bing Translate。
- Claude 可通过 `node debug/verify-claude-live.js` 验证，它会连接当前 Chrome 的 `DevToolsActivePort`，检查真实的输入 -> 点击发送 -> 会话创建链路。`node debug/inspect-claude-response.js` 会把外层壳层和 `main .font-claude-response` 的答案正文分别打印出来。
- 时间线复制现在会把每个站点的回答保留为一个整体，多段落内容不会再被拆成编号子回答。
- ChatGPT / Gemini / DeepSeek 也已支持走扩展自身端到端链路的验证脚本：`node debug/verify-chatgpt-live.js`、`node debug/verify-gemini-live.js`、`node debug/verify-deepseek-live.js`。
- 其他较复杂站点也有对应脚本，例如 `debug/verify-minimax-live.js`、`debug/verify-manus-live.js`、`debug/verify-metaso-live.js`、`debug/verify-ai-studio-live.js`、`debug/verify-yuanbao-live.js`、`debug/verify-qianwen-live.js`、`debug/verify-qwen-live.js`。
- 元宝 / Qwen / 千问 的验证脚本现已改为走页面上的真实发送按钮或“新建对话”引导路径，而不是只依赖 Enter。
- `dots.ai` 现已通过 `node debug/verify-dots-ai-live.js` 在真实用户 Chrome 中验证；根 URL 会落到 `/chat/home/<id>`，输入框为 `textarea[placeholder="给点点发消息"]`，发送方式为点击箭头发送按钮。
- Nano Banana 的图像流可通过 `node debug/verify-nano-banana-live.js` 做烟雾检查，它会走真实扩展页并覆盖 Flow 的项目引导路径。
- 静态配置漂移可通过 `node debug/validate-site-configs.js` 检查。
- 提示词人物模仿 benchmark 可通过 `node debug/prompt-persona-benchmark.mjs` 运行；设置 `PPTOKEN_API_KEY`，如有需要再传 `PPTOKEN_API_BASE`、`PPTOKEN_MODEL`、`BENCHMARK_RUN_ID`、`BENCHMARK_CONCURRENCY`，结果会落在 `debug/benchmark-results/<run-id>/`，其中包含原始回答和评分报告。
- 内置的 Skill 引擎默认配置现已统一收口到 `config/agentEngineConfig.js`，当前默认值为火山方舟兼容 OpenAI 协议的 Coding API：`https://ark.cn-beijing.volces.com/api/coding/v3`，默认模型为 `glm-5.1`；其中内置 API Key 在配置文件中以密文形式保存、运行时再解密，用户在设置页手动保存后的值仍然优先覆盖，并且每个 Skill 只使用自己配置的 persona 提示词作为 system prompt。
- 现在可以通过“设置 -> Skill 设置 -> 从 URL 导入”把 GitHub 上的 `SKILL.md` 转成自定义 Skill；对应的专项验证脚本为 `node debug/verify-agent-import-runtime-playwright.js`。
- 系统自带的 Skill 现在也支持在设置页删除。对内置 Skill 来说，这个“删除”实现为当前设备本地隐藏，因此它会同时从设置页、homepage 和 iframe 的 Skill 选择里消失，但不会改写扩展内置目录。
- 配置步骤的默认重试上限现在是 10 次。
- 配置驱动的 `sendKeys` 步骤现在也会遵循 `waitForElement`、`maxAttempts` 和 `retryInterval`，因此回车提交可以像 `focus` / `setValue` / `triggerEvents` 一样重试。
- 时间线复制现在会先显示“复制中...”，如果 `navigator.clipboard.writeText` 失败，会自动回退到 `execCommand('copy')`。
- 时间线复制预览现在支持新标签页分析：可以把问题、汇总结果和各站原始答案通过 `chrome.storage.session` 传到默认的扩展 compare 页，再复用现有对比流程继续跑多模型分析，不走 OpenClaw。
- 时间线复制预览现在还能选择分析提示词模板；设置页里也新增了对应的“分析提示词”管理入口和默认预置项。
- 面向真实 Chrome 的定期巡检可通过 `node debug/run-live-site-checks.js --group core --write-report` 执行。
- `--group core` 适合每天跑核心站点烟雾检查；`--group full` 会额外跑更广的 verifier 以及逻辑 / 配置探针。
- 汇总报告会同时给出通过 / 失败状态、登录失效 / 限额等软失败分类，以及“当前哪些已配置站点还没有专用 live verifier 覆盖”的缺口清单。
- macOS 可基于 `debug/launchd/com.aicompare.site-checks.plist.template` 生成 `~/Library/LaunchAgents/` 里的定时任务，直接复用真实 Chrome 用户态。

### OpenClaw 技能接入

- 仓库里有两个面向 OpenClaw 的目录，但职责不同：
  - `openclaw-extension/`：可维护的 OpenClaw plugin / 硬路由层，会在正常模型分发前拦截“搜索类”请求，是当前推荐的默认接入方式。
  - `openclaw/`：runner + skill 兼容层，里面放 GUI runner、fast wrapper 和可安装的 skill 包，既可单独做传统 skill 安装，也被硬路由方案复用。
- 真正执行多站点搜索的浏览器扩展本体仍然在仓库根目录，例如 `manifest.json`、`iframe/`、`content-scripts/` 等。`openclaw-extension/` 不是浏览器扩展包，而是 OpenClaw 侧的插件入口层。
- 最近一次端到端验证通过的，是正式硬路由链路：`openclaw-extension/` 负责入口拦截，`openclaw/ai-compare-openclaw-fast.js` / `openclaw/ai-compare-openclaw-runner.js` 负责拉起 GUI runner，浏览器扩展运行时 `iframe/inject.js`、`iframe/iframe.js`、`iframe/openclaw-bridge.js` 负责真正执行搜索与主动上报结果。
- 如果你希望 OpenClaw 用户只说 `搜索 XX` 就能直接触发，而不需要显式提到 skill，优先安装 `openclaw-extension/`；`openclaw/` 建议保留为共享 runner / 兼容层。
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

Last auto-update / 最近自动更新：2026-05-22 17:59:46 UTC+08:00

### Staged changes for this commit / 本次提交暂存变更
- `A` `.githooks/post-commit`
- `M` `.githooks/pre-commit`
- `A` `.github/workflows/package-extension.yml`
- `M` `AGENTS.md`
- `M` `_locales/ar/messages.json`
- `M` `_locales/de/messages.json`
- `M` `_locales/en/messages.json`
- `M` `_locales/es/messages.json`
- `M` `_locales/fr/messages.json`
- `M` `_locales/ja/messages.json`
- `M` `_locales/ko/messages.json`
- `M` `_locales/pt_BR/messages.json`
- `M` `_locales/zh_CN/messages.json`
- `M` `_locales/zh_TW/messages.json`
- `M` `background.js`
- `M` `config/agentCatalog.js`
- `A` `config/agentCatalogData.js`
- `M` `config/appConfig.json`
- `M` `config/siteHandlers.json`
- `M` `contact/contact.css`
- `M` `contact/contact.html`
- `M` `contact/contact.js`
- `A` `docs/release-notes/history.md`
- `A` `docs/release-notes/latest.md`
- `M` `favorites/favorites.html`
- `M` `favorites/favorites.js`
- `M` `history/history.html`
- `M` `history/history.js`
- `M` `homepage/homepage.html`
- `M` `homepage/homepage.js`
- `M` `iframe/agent-panel.html`
- `M` `iframe/iframe.css`
- `M` `iframe/iframe.html`
- `M` `iframe/iframe.js`
- `M` `manifest.json`
- `M` `options/options.html`
- `M` `options/options.js`
- `M` `remote-relay/src/server.js`
- `A` `scripts/generate-release-notes.js`
- `M` `shared/extraction-core.js`
- `A` `shared/runtime-i18n.js`
- `M` `shared/sidebar.js`
- `M` `tests/extraction-core.test.js`

### Recent commits / 最近提交
- `2a720e3` 2026-05-21 V4.1.0 支持分享到链接
- `f79a148` 2026-05-18 V4.0.1 修复小 bug
- `63e4f41` 2026-05-18 V4.0.0 支持智能体
- `16923e6` 2026-05-15 V3.4.2 完善语言包
- `52ad022` 2026-05-14 V3.4.1 修复 UI 小问题

_This section is maintained automatically by `scripts/update-readme.js` via `.githooks/pre-commit`._
<!-- AUTO-README-STATUS:END -->
