# 微软 Edge 扩展商店：「Store listing 报错 (Errors: 16)」排查指南

## 报错含义

提交时提示 **「We found some errors in the Store listing page」** 且 **Errors: 16**，说明在 **Partner Center（合作伙伴中心）** 的 **「商店列表 / Store listing」** 页面里，有 16 项必填或不合规的内容未通过校验。  
微软不会在弹窗里逐条列出这 16 项，需要你回到 Store listing 页面自己逐项补全/修正。

---

## 为什么是 16 个错误？

常见原因：**多语言 × 每语言多项必填 = 多条错误**。

- 你的扩展在 manifest 里设置了 `default_locale: "en"`，并且有 `_locales/en`、`_locales/zh_CN`、`_locales/zh_TW` 等。
- 在 Partner Center 提交时，如果为 **多种语言** 都创建了「商店列表」条目，则 **每种语言** 下都有一套必填项。
- 例如：4 种语言 × 每语言 4 个必填项未填 = 16 个错误。

因此要按 **「语言」** 维度，在 Store listing 里逐语言检查。

---

## Store listing 常见必填/易错项（按语言检查）

在 Partner Center 中进入你的扩展 → **产品设置 / 提交** → **Store listing**，然后：

### 1. 对「每种语言」分别检查（如 English、中文简体、中文繁体等）

| 必填项 | 说明 | 你可做的检查 |
|--------|------|----------------|
| ** Short description / 简短描述** | 会显示在列表页，有长度限制 | 每语言都要填，且不能为空、不能只填空格 |
| **Full description / 完整描述** | 详情页长描述 | 每语言都要填，需准确描述功能与限制 |
| **Privacy policy URL / 隐私政策链接** | 必须可公网访问的 URL | 填可打开的 https 链接，不要用本地路径或未发布的页面 |
| **Support / Contact URL**（若必填） | 支持或联系页面 | 填有效网页或 mailto: 链接 |
| **Screenshots** | 商店展示用截图 | 数量、尺寸需符合要求（如至少 1 张，通常 1280×800 或 640×400），不能模糊、拉伸 |
| **Search keywords**（若必填） | 搜索关键词 | 按提示数量填写，不要留空 |
| **Category** | 扩展分类 | 从下拉中选一个有效分类 |
| **Small / Large promotional images**（若要求） | 推广图 | 尺寸、比例需符合规范 |

只要某一项在「某一语言」下缺失或无效，就会计为 1 个错误；多语言 × 多项就会累积成 16 个。

### 2. 内容与政策要求

- 描述需 **准确、完整**，不误导，且与扩展实际功能一致。
- 若扩展会收集/使用用户数据，须在 **隐私政策** 中写清楚，且 **Privacy policy URL** 必须可访问。
- 截图需 **清晰、与扩展相关**，不要用占位图或无关内容。

---

## 如何找到并修掉这 16 个错误（操作步骤）

1. **打开 Partner Center**  
   登录 [partner.microsoft.com](https://partner.microsoft.com) → 进入 **Edge 扩展** 对应产品。

2. **进入 Store listing**  
   在左侧或提交流程中找到 **「Store listing」** 或 **「商店列表」** 页面。

3. **按语言 Tab 逐项检查**  
   - 切换 **English、中文(简体)、中文(繁体)** 等每一个你已添加的语言。
   - 在每个语言下，看是否有 **红色星号 *、红色提示、或「必填」标记** 的字段。
   - 重点看：Short description、Full description、Privacy policy URL、Support URL、Screenshots、Category、Keywords 等。

4. **把缺的补全、错的改正**  
   - 未填的：补上符合要求的文字或 URL。  
   - 隐私政策：若还没有线上版，可先把 `AI Compare PrivacyPolicy.md` 放到一个可公网访问的页面（如 GitHub Pages、你个人网站），再填该 URL。  
   - 截图：按要求的尺寸和数量上传，确保能正常显示。

5. **保存后再次提交**  
   保存所有语言下的修改后，再点提交；若仍有错误，错误数量会变化，可据此继续排查剩余项。

---

## 与你项目相关的快速检查

- **隐私政策**  
  你已有 `AI Compare PrivacyPolicy.md`，需把它发布到一个 **公网可访问的 URL**，并在 Store listing 的 **Privacy policy URL** 中填写该链接（每个语言若单独填，都要填这个链接）。

- **多语言**  
  若在 Store listing 里为 en、zh-CN、zh-TW 等多种语言都建了条目，**每种语言** 的 Short/Full description、Privacy URL、Support、Screenshots 等都要完整，否则很容易凑成 16 个错误。

- **描述与截图**  
  - Short description 可参考 manifest 里 `_locales/en/messages.json` 的 `extDescription`（例如："AI Compare helps you find the best answer from multiple AI quickly."），再为其他语言写好对应翻译。  
  - 截图建议展示：侧边栏对比、多 AI 同时查询、收藏/历史等核心功能。

---

## 小结

| 项目 | 说明 |
|------|------|
| **错误来源** | Partner Center 里 **Store listing** 页，多为「多语言 × 每语言多项必填」未填或无效 |
| **如何找** | 在 Store listing 中切换每种语言，看带红色必填标记或提示的字段 |
| **如何修** | 每语言补全 Short/Full description、Privacy URL、Support、Screenshots、Category 等，并确保 URL 可访问、截图符合规范 |
| **隐私政策** | 将 `AI Compare PrivacyPolicy.md` 放到可访问的网页，在 Store listing 填该 URL |

按上述逐语言、逐项补全后再次提交，一般即可通过 Store listing 校验。若你愿意，我可以根据你当前在 Partner Center 里看到的字段名称，帮你列一份「按你界面逐项打勾」的清单（你贴出字段名即可）。
