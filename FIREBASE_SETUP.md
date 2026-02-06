# Firebase 云端同步配置说明（维护者）

扩展使用**统一的云端 Firebase 项目**，用户通过**谷歌账号**登录后，历史记录与收藏记录将同步到该项目。选项页仅保留「使用谷歌账号登录并同步」按钮，无邮箱/密码注册与登录。

## 维护者：配置统一云端（一次性）

### 1. 创建 Firebase 项目

1. 打开 [Firebase 控制台](https://console.firebase.google.com/)
2. 点击「添加项目」，按提示创建项目
3. 在项目设置 → 常规 → 你的应用 → 添加 Web 应用（或选择已有 Web 应用）
4. 记下配置中的 **apiKey**、**authDomain**、**projectId**

### 2. 启用认证（谷歌登录）

1. 在 Firebase 控制台左侧选择「Authentication」→「Sign-in method」
2. 启用「Google」登录方式，并保存 **Web 客户端 ID**（用于 `firebaseConfig.js` 的 `googleClientId`）

### 3. 配置 OAuth 重定向 URI（谷歌登录必做）

1. 在 Chrome 中加载扩展后，打开 `chrome://extensions`，找到本扩展的 **扩展 ID**
2. 打开 [Google Cloud 控制台](https://console.cloud.google.com/) → 选择与 Firebase 同一项目 →「API 和凭据」→「凭据」
3. 找到用于 Firebase Google 登录的 **OAuth 2.0 客户端 ID**（Web 应用类型）
4. 在「已授权的重定向 URI」中添加：`https://<你的扩展ID>.chromiumapp.org/`  
   例如扩展 ID 为 `abcdefghijklmnop`，则添加：`https://abcdefghijklmnop.chromiumapp.org/`
5. 保存

### 4. 创建 Firestore 数据库

1. 左侧选择「Firestore Database」→「创建数据库」
2. 选择「以生产模式启动」（后续用规则限制访问）
3. 选择区域后创建

### 5. 设置 Firestore 安全规则

在 Firestore → 规则 中，使用以下规则，保证用户只能读写自己的文档：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 6. 在扩展中填写配置

在 **config/firebaseConfig.js** 中填入：

- **apiKey**、**authDomain**、**projectId**：来自 Firebase 项目设置
- **googleClientId**：来自 Firebase → Authentication → 登录方式 → Google → Web 客户端 ID（形如 `xxxxx.apps.googleusercontent.com`）


## 用户侧行为

- 打开扩展**首页（侧边栏）** → 底部点击 **「开启同步」**
- 会打开谷歌账号登录页，登录成功后本地历史与云端自动合并并上传
- 之后每次修改历史/收藏，若已登录会自动上传
- 登录后底部同步栏会显示当前谷歌账号邮箱

数据存储在 Firestore 的 `users/{用户uid}` 文档中，字段包括：`pkHistoryJson`（历史记录）、`favoritePromptsJson`（收藏的提示词）、`favoriteSitesJson`（收藏的站点）、`updatedAt`（时间戳）。Token 仅保存在本机 `chrome.storage.local`，不会上传到除 Firebase 以外的服务器。

**换电脑后**：在新电脑上打开扩展首页 → 点击「开启同步」→ 使用同一谷歌账号登录后，会自动从云端拉取历史记录与收藏并合并到本地，即可在新电脑上看到之前的记录。
