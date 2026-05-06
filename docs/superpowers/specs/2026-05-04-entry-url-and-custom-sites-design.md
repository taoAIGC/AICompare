# Entry URL and Custom Sites Design

## 背景
用户希望对站点的默认打开地址做长期自定义，典型场景是复用已存在的 AI 会话 URL，而不是每次都打开站点根页再新建会话。另一类需求是新增“完全自定义的网站”，它们不属于现有 `siteHandlers.json` 站点体系，只需要作为分屏页打开，不做自动注入或回答提取。

## 目标
- 允许官方站点长期覆盖默认启动地址。
- 覆盖地址同时影响首页、iframe 对比页、外部搜索快捷入口。
- 保留 `{query}` 模板能力。
- 新增独立的 `customSites`，只负责打开页面，不参与自动化。

## 非目标
- 不把 `customSites` 合并进 `config/siteHandlers.json`。
- 不让 `customSites` 参与 `searchHandler`、`userPrompt`、`contentExtractor`、`historyHandler`。
- 不改变现有官方站点的自动化能力。

## 数据模型

### 官方站点覆盖
官方站点仍然来自 `config/siteHandlers.json`，用户覆盖放在现有 `chrome.storage.sync.sites[siteName]` 中，新增字段：

```json
{
  "DeepSeek": {
    "enabled": true,
    "order": 3,
    "entryUrl": "https://chat.deepseek.com/a/chat/s/cccdaaa8-874a-43f5-a741-1234567890"
  }
}
```

- `entryUrl` 是站点级启动模板。
- 它只覆盖打开地址，不覆盖官方站点定义本身。
- 站点检测、域名映射、远程配置更新仍以 `site.url` 作为基线。

### customSites
新增独立集合 `chrome.storage.sync.customSites`，与官方站点完全分离。

建议字段：

```json
{
  "id": "custom-deepseek-notes",
  "name": "DeepSeek Notes",
  "url": "https://chat.deepseek.com/a/chat/s/...",
  "enabled": true,
  "supportIframe": true,
  "icon": "",
  "note": "",
  "order": 0
}
```

- `id` 必须稳定，用于编辑/删除/同步。
- `name` 用于展示。
- `url` 是最终打开地址。
- `supportIframe` 控制是否可嵌入 iframe。
- `customSites` 不需要 `searchHandler`、`contentExtractor`、`userPrompt`、`historyHandler`、`type`。

## URL 解析规则

### 官方站点
统一通过一个解析器生成启动 URL：

1. 优先读取 `sites[siteName].entryUrl`。
2. 没有 `entryUrl` 时，回退到 `siteHandlers.json` 的 `site.url`。
3. 如果最终 URL 包含 `{query}`，则替换为编码后的查询词。
4. 如果 `entryUrl` 不包含 `{query}`，则直接打开该固定页面。
5. 固定页面打开后，仍可继续走原有官方站点的 `searchHandler` 注入流程。
6. 如果 `entryUrl` 已经把查询编码进 URL，则不再额外注入输入。

### customSites
1. 只打开 `customSites.url`。
2. 查询词忽略。
3. 不执行任何自动注入、点击、提取、历史处理。

## 入口行为

### 首页
- 官方站点继续使用现有选择列表和分类标签。
- `customSites` 在首页单独成区，不进官方分类。
- 官方站点选中后继续按现有查询流程工作。
- `customSites` 选中后只打开页面，作为分屏页或外部页展示。

### iframe 对比页
- 官方站点和 `customSites` 都可以进入 iframe 对比页。
- `customSites.supportIframe === true` 时嵌入 iframe。
- `customSites.supportIframe !== true` 时退化为外部页打开。
- `customSites` 在 iframe 中不执行任何自动化。

### 外部搜索快捷
- 官方站点继续走统一解析器。
- 如果命中 `entryUrl`，则以 `entryUrl` 为准。
- `customSites` 不进入搜索快捷入口的自动化链路。

### 单站点搜索
- 官方站点仍可执行原有 `searchHandler`。
- 如果该站点配置了 `entryUrl`，先按解析器打开对应地址。
- `customSites` 不参与单站点搜索。

## UI 设计

### options 页面
- 给官方站点增加 `entryUrl` 输入框。
- 提供“恢复默认”按钮，清空覆盖值。
- 新增 `customSites` 管理区，支持新增、编辑、删除。
- `customSites` 表单保持轻量，避免引入官方站点那套复杂配置。

### homepage 页面
- 保留现有官方站点列表和拖拽排序。
- 新增 `customSites` 区块，和官方站点视觉上分开。
- 所有新增文案走 `chrome.i18n`。

## 存储与同步
- 官方站点覆盖继续放在现有 `sites` 同步对象里。
- `customSites` 作为独立同步项加入 WebDAV / 导入导出。
- 远程 `siteHandlers.json` 更新不会覆盖 `entryUrl`。
- `customSites` 不参与远程站点更新逻辑。

## 兼容性
- 未配置 `entryUrl` 的站点行为不变。
- 旧用户不需要迁移即可继续使用。
- 官方站点重命名会影响 `sites[siteName]` 覆盖键，这是当前版本接受的边界。

## 实现影响点
- `config/baseConfig.js`
- `background.js`
- `homepage/homepage.js`
- `iframe/iframe.js`
- `options/options.js`
- `firebase/firebase-sync.js`
- `config/siteDetector.js` 保持官方站点路径，不接入 `customSites`

## 验收
- DeepSeek 这类官方站点可长期默认打开到指定会话 URL。
- `entryUrl` 带 `{query}` 时，官方站点能正确拼接查询词。
- `entryUrl` 不带 `{query}` 时，仍可打开固定页面并继续自动注入。
- `customSites` 只打开页面，不做其他操作。
- 官方站点和 `customSites` 的同步、导入导出都可独立工作。

## 风险
- 以站点名作为覆盖键，后续官方改名可能导致用户覆盖失效。
- `customSites` 若过多，homepage 需要清晰分区，避免和官方站点混淆。
- 少数站点对固定会话 URL 和 iframe 的兼容性可能不同，需要在真实页面验证。
