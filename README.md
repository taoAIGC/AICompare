# 🧠 AI Compare — 一键对比多个 AI 的回答

[English](#english) ｜ [中文](#中文)

---

## English

### ✨ Introduction

**AI Compare** (formerly "AI Shortcuts") is a browser extension that lets you compare answers from multiple AI models in one place. Enter a query once and see results from ChatGPT, Gemini, Claude, Grok, DeepSeek, Kimi, 豆包,元宝, and many more — side by side. You use your existing AI accounts; the extension does not require sign-up or paid membership.

### 📦 Features

#### 1. Multi-AI comparison page (iframe)

- **One page, multiple AIs**: Open a single tab with several AI sites embedded (iframes). Enter your query once and get responses from all selected AIs at once.
- **Layout**: Switch between 1 / 2 / 3 / 4 columns.
- **File upload**: Upload files (images, documents, etc.) and send them to all AI sites in one go.
- **Export**: Export all AI responses as a single file (e.g. Markdown).
- **History**: History drawer lists recent comparison sessions; click to reopen a session.
- **Query suggestions**: Prompt templates appear as buttons above the input; one click fills the query (e.g. `风险分析：「{query}」`).
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
- **Prompt templates**: Add / edit / delete templates (name, query text with `{query}`, display order).
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

---

## 中文

### ✨ 简介

**AI 比一比**（原名「AI 任意门」）是一款浏览器扩展，在一个页面里同时对比多个 AI 的回答。输入一次问题，即可并排查看 ChatGPT、Gemini、Claude、Grok、DeepSeek、Kimi、豆包、元宝等十多个 AI 的结果。使用你已有的 AI 账号即可，扩展本身无需注册、无需付费。

### 📦 功能一览

#### 1. 多 AI 对比页（iframe）

- **一页多 AI**：在一个标签页内嵌入多个 AI 站点（iframe），输入一次问题，所有选中的 AI 同时返回结果。
- **布局**：支持 1 / 2 / 3 / 4 列切换。
- **文件上传**：上传图片、文档等，一键发送到所有 AI 站点。
- **导出**：将所有 AI 的回答导出为一个文件（如 Markdown）。
- **历史**：历史抽屉展示近期对比记录，点击可重新打开当次对比。
- **查询建议**：输入框上方展示提示词模板按钮，点击即可填入（如「风险分析：「{query}」」）。
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
- **提示词模板**：增删改模板（名称、带 `{query}` 的查询模板、排序）。
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

---

<!-- AUTO-README-STATUS:START -->
## Development Snapshot / 开发快照

Last auto-update / 最近自动更新：2026-03-22 12:03:36 UTC+08:00

### Staged changes for this commit / 本次提交暂存变更
- `M` `.DS_Store`
- `M` `.claude/settings.local.json`
- `A` `.githooks/pre-commit`
- `M` `.gitignore`
- `A` `AGENTS.md`
- `M` `CLAUDE.md`
- `M` `_locales/ar/messages.json`
- `M` `_locales/de/messages.json`
- `M` `_locales/es/messages.json`
- `M` `_locales/fr/messages.json`
- `M` `_locales/ja/messages.json`
- `M` `_locales/ko/messages.json`
- `M` `_locales/pt_BR/messages.json`
- `M` `_locales/zh_TW/messages.json`
- `M` `config/appConfig.json`
- `M` `config/baseConfig.js`
- `M` `config/siteHandlers.json`
- `A` `contact/contact.css`
- `A` `contact/contact.html`
- `A` `contact/contact.js`
- `A` `debug/capture-site-screenshot.js`
- `A` `debug/fill-missing-locales.js`
- `A` `debug/inspect-new-sites.js`
- `A` `debug/inspect-site-controls.js`
- `A` `debug/inspect-user-chrome-dom.js`
- `A` `debug/output/perplexity-iframe-test/perplexity-iframe-1774150863403.png`
- `A` `debug/output/site-inspection/Canva.png`
- `A` `debug/output/site-inspection/Character-AI.png`
- `A` `debug/output/site-inspection/DeepL.png`
- `A` `debug/output/site-inspection/Dreamina.png`
- `A` `debug/output/site-inspection/ElevenLabs.png`
- `A` `debug/output/site-inspection/Fish-Audio.png`
- `A` `debug/output/site-inspection/Flowith.png`
- `A` `debug/output/site-inspection/Gamma.png`
- `A` `debug/output/site-inspection/GenSpark.png`
- `A` `debug/output/site-inspection/Google-Translate.png`
- `A` `debug/output/site-inspection/HailuoAI.png`
- `A` `debug/output/site-inspection/HeyGen.png`
- `A` `debug/output/site-inspection/Lovable.png`
- `A` `debug/output/site-inspection/Manus.png`
- `A` `debug/output/site-inspection/Midjourney.png`
- `A` `debug/output/site-inspection/NotebookLM.png`
- `A` `debug/output/site-inspection/Pika.png`
- `A` `debug/output/site-inspection/Runway.png`
- `A` `debug/output/site-inspection/SeaArt.png`
- `A` `debug/output/site-inspection/Sora.png`
- `A` `debug/output/site-inspection/Suno.png`
- `A` `debug/output/site-inspection/Vidu.png`
- `A` `debug/output/site-inspection/Wan.png`
- `A` `debug/output/site-inspection/results-1773735031269.json`
- `A` `debug/output/site-inspection/results-1773735356967.json`
- `A` `debug/output/user-chrome-tests/results-1773744272780.json`
- `A` `debug/output/user-chrome-tests/results-1773744423012.json`
- `A` `debug/output/user-chrome-tests/results-1773744842549.json`
- `A` `debug/output/user-chrome-tests/results-1773745146578.json`
- `A` `debug/output/user-chrome-tests/results-1773745160356.json`
- `A` `debug/output/user-chrome-tests/results-1773745165015.json`
- `A` `debug/output/user-chrome-tests/results-1773745207399.json`
- `A` `debug/output/user-chrome-tests/results-1773745247486.json`
- `A` `debug/output/user-chrome-tests/results-1773745417369.json`
- `A` `debug/output/user-chrome-tests/results-1773747528654.json`
- `A` `debug/output/user-chrome-tests/results-1773748208641.json`
- `A` `debug/output/user-chrome-tests/results-1773748280445.json`
- `A` `debug/output/user-chrome-tests/results-1773749750907.json`
- `A` `debug/output/user-chrome-tests/results-1773804796863.json`
- `A` `debug/output/user-chrome-tests/results-1773911410410.json`
- `A` `debug/output/user-chrome-tests/results-1773915902509.json`
- `A` `debug/output/user-chrome-tests/results-1773916103503.json`
- `A` `debug/output/user-chrome-tests/results-1773916335829.json`
- `A` `debug/output/user-chrome-tests/results-1773989374105.json`
- `A` `debug/output/user-chrome-tests/results-1773989934935.json`
- `A` `debug/output/user-chrome-tests/results-1774149434815.json`
- `A` `debug/test-iframe-page-selection.js`
- `A` `debug/test-perplexity-iframe.js`
- `A` `debug/test-user-chrome-sites.js`
- `A` `debug/verify-bing-translate.js`
- `A` `debug/verify-deepl-translate.js`
- `A` `debug/verify-dreamina-input.js`
- `A` `debug/verify-pika-input.js`
- `M` `homepage/homepage.css`
- `M` `homepage/homepage.html`
- `M` `homepage/homepage.js`
- `M` `iframe/iframe.css`
- `M` `iframe/iframe.js`
- `M` `manifest.json`
- `M` `package.json`
- `A` `playwright-report/data/146b60e5e97deed1ff3255715facd62f9891db0b.png`
- `A` `playwright-report/data/75fab12801e2d948ddb8b23d24ebf00b6d592d50.png`
- `A` `playwright-report/data/f3ba4e9df1709b479589e158b1eac07d9b389710.png`
- `M` `playwright-report/index.html`
- `M` `playwright-report/test-results.json`
- `M` `playwright.config.js`
- `A` `scripts/update-readme.js`
- `M` `shared/sidebar.html`
- `M` `shared/sidebar.js`
- `A` `siteIcons/app.heygen.com.png`
- `A` `siteIcons/app.klingai.com.png`
- `A` `siteIcons/app.runwayml.com.png`
- `A` `siteIcons/character.ai.png`
- `A` `siteIcons/dreamina.capcut.com.png`
- `A` `siteIcons/elevenlabs.io.png`
- `A` `siteIcons/fish.audio.png`
- `A` `siteIcons/flowith.io.png`
- `A` `siteIcons/gamma.app.png`
- `A` `siteIcons/hailuoai.video.png`
- `A` `siteIcons/lovable.dev.png`
- `A` `siteIcons/manus.im.png`
- `A` `siteIcons/notebooklm.google.com.png`
- `A` `siteIcons/pika.art.png`
- `A` `siteIcons/sora.com.png`
- `A` `siteIcons/suno.com.png`
- `A` `siteIcons/translate.google.com.png`
- `A` `siteIcons/wan.video.png`
- `A` `siteIcons/www.canva.com.png`
- `A` `siteIcons/www.deepl.com.png`
- `A` `siteIcons/www.genspark.ai.png`
- `A` `siteIcons/www.midjourney.com.png`
- `A` `siteIcons/www.seaart.ai.png`
- `A` `siteIcons/www.vidu.com.png`
- `M` `test-results/.last-run.json`
- `A` `test-results/e2e-ai-sites-inject-AI-dir-78e30--buttons-beside-user-prompt-extension-direct-sites/Qwen-direct-userprompt.png`
- `A` `test-results/e2e-ai-sites-inject-AI-dir-78e30--buttons-beside-user-prompt-extension-direct-sites/attachments/screenshot-Qwen-1d8ff195b674dddf13e6f91fa6b57b76d1f9cee1.png`
- `A` `test-results/e2e-ai-sites-inject-AI-dir-78e30--buttons-beside-user-prompt-extension-direct-sites/test-failed-1.png`
- `A` `test-results/e2e-ai-sites-inject-AI-dir-78e30--buttons-beside-user-prompt-extension-direct-sites/test-failed-2.png`
- `M` `tests/e2e/ai-sites-inject.test.js`
- `M` `tests/setup.js`
- `M` `tests/utils/test-utils.js`
- `A` `userprompt-buttons-qwen-1774110837909.png`
- `A` `userprompt-buttons-yuanbao-1774110762697.png`

### Recent commits / 最近提交
- `0d7ece6` 2026-03-17 V 2.20.4 翻译更多站点
- `dfb1aed` 2026-03-12 V 2.20.3 优化站点导航、输入框大小和脚本进度提示
- `929ca23` 2026-03-04 V2.20.2 修复同步功能
- `720c4ca` 2026-02-20 V2.20.1 修复webdav 和若干问题
- `5c83c89` 2026-02-19 V2.20 支持收藏时选择文件夹；支持 webdav 同步功能

_This section is maintained automatically by `scripts/update-readme.js` via `.githooks/pre-commit`._
<!-- AUTO-README-STATUS:END -->
