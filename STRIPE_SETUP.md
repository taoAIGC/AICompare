# Stripe 订阅集成配置说明

AI比一比 使用 **Stripe + Firebase Cloud Functions** 实现 Pro 会员订阅。

---

## 第一步：Stripe Dashboard 配置

### 1.1 创建订阅商品

1. 打开 [Stripe Dashboard](https://dashboard.stripe.com) → **Products**
2. **+ Add product** → Name: `AI Compare Pro`
3. 添加两个 Price：
   - **月付**：Recurring / `$4.99` / month → 记录 `price_xxx` ID
   - **年付**：Recurring / `$39.99` / year → 记录 `price_xxx` ID

### 1.2 获取 Secret Key

Dashboard → **Developers** → **API keys** → 复制 **Secret key**（`sk_test_xxx` 或 `sk_live_xxx`）

### 1.3 配置 Stripe Customer Portal（用于用户管理订阅）

Dashboard → **Settings** → **Billing** → **Customer portal** → 启用并保存

---

## 第二步：填写 Stripe Price ID

打开 `AIShortcuts/firebase/stripe-payment.js`，替换顶部两行：

```javascript
const STRIPE_PRICES = {
  monthly: 'price_YOUR_MONTHLY_PRICE_ID',  // ← 改成 Stripe 给的真实 ID
  yearly:  'price_YOUR_YEARLY_PRICE_ID',   // ← 改成 Stripe 给的真实 ID
};
```

---

## 第三步：部署 Firebase Cloud Functions

### 3.1 修复 npm 权限问题（如果 npm install 报 EACCES 权限错误）

```bash
sudo chown -R $(whoami) ~/.npm
```

### 3.2 安装 Firebase CLI（如果还没装）

```bash
npm install -g firebase-tools
firebase login
```

### 3.3 创建密钥配置文件

```bash
cd /Users/hasee/Documents/同步文稿/multi-AI/functions
cp .env.example .env
```

用文本编辑器打开 `functions/.env`，填入真实的 Stripe 密钥：

```
STRIPE_SECRET_KEY=sk_test_你的真实密钥
STRIPE_WEBHOOK_SECRET=whsec_占位先填这个等Webhook配好后再更新
STRIPE_SUCCESS_URL=https://aicompare.pro/payment-success
STRIPE_CANCEL_URL=https://aicompare.pro/payment-cancel
```

> ⚠️ `.env` 文件包含密钥，**不要提交到 git**。
> 项目的 `.gitignore` 应已包含 `functions/.env`（如果没有请手动添加）。

### 3.4 安装依赖并部署

```bash
# 安装 Cloud Functions 依赖
cd /Users/hasee/Documents/同步文稿/multi-AI/functions
npm install

# 回到项目根目录部署
cd /Users/hasee/Documents/同步文稿/multi-AI
firebase deploy --only functions,firestore:rules
```

部署成功后会输出函数 URL，格式如：
```
✔ Function URL (createCheckoutSession): https://us-central1-aicompare-12989.cloudfunctions.net/createCheckoutSession
✔ Function URL (stripeWebhook):         https://us-central1-aicompare-12989.cloudfunctions.net/stripeWebhook
```

---

## 第四步：配置 Stripe Webhook

1. Dashboard → **Developers** → **Webhooks** → **+ Add endpoint**
2. **Endpoint URL** 填写：
   ```
   https://us-central1-aicompare-12989.cloudfunctions.net/stripeWebhook
   ```
3. **Listen to events** 选择：
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. 保存后，点进该 Endpoint → 找到 **Signing secret**（`whsec_xxx`）
5. 更新 `functions/.env` 中的 `STRIPE_WEBHOOK_SECRET`
6. 重新部署：
   ```bash
   cd /Users/hasee/Documents/同步文稿/multi-AI
   firebase deploy --only functions
   ```

---

## 第五步：验证功能

1. 打开扩展设置页（chrome-extension://.../options/options.html）
2. 导航到 **Pro 会员** 页
3. 若已登录 Google 账号，应显示 Free 状态和价格卡片
4. 点击「按月订阅」，应跳转到 Stripe Checkout
5. 使用[测试卡](https://stripe.com/docs/testing#cards) `4242 4242 4242 4242`，有效期任意未来日期，CVV `123`
6. 付款成功后，Firestore `users/{uid}.plan` 应变为 `pro`
7. 重新打开会员页，应显示 **Pro** 金色徽章

---

## 常见问题

### npm install 报 EACCES 权限错误
```bash
sudo chown -R $(whoami) ~/.npm
npm install
```

### firebase deploy 报「Couldn't find firebase-functions package」
说明 `npm install` 未成功，先修复权限再重新 install：
```bash
cd functions && npm install
```

### Webhook 签名验证失败
确认 `functions/.env` 中的 `STRIPE_WEBHOOK_SECRET` 是从 Stripe Dashboard → Webhooks → 该 Endpoint → **Signing secret** 复制的（以 `whsec_` 开头），不是 API key。

---

## 在代码中判断 Pro 权限

```javascript
// 任意加载了 baseConfig.js 的页面中
const isPro = await window.isProUser();
if (!isPro) {
  // 提示升级或限制功能
}

// 或获取完整信息
const { plan, planExpiresAt } = await window.getUserPlan();
```

---

## 数据结构（Firestore `users/{uid}` 新增字段）

| 字段 | 类型 | 说明 |
|------|------|------|
| `plan` | string | `'free'` 或 `'pro'` |
| `stripeCustomerId` | string | Stripe Customer ID（`cus_xxx`）|
| `stripeSubscriptionId` | string | Stripe Subscription ID（`sub_xxx`）|
| `planExpiresAt` | Timestamp | 当前订阅周期结束时间 |
| `planUpdatedAt` | Timestamp | 最后更新时间 |

ble Gemini in Firebase features? Yes

i  Firebase optionally collects CLI and Emulator Suite usage and error reporting information to help improve our products. Data is collected in accordance with Google's privacy policy (https://policies.google.com/privacy) and is not used to identify you.
✔ Allow Firebase to collect CLI and Emulator Suite usage and error reporting information? Yes

i  To change your preferences at any time, run `firebase logout` and `firebase login` again.

Visit this URL on this device to log in:
https://accounts.google.com/o/oauth2/auth?client_id=563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com&scope=email%20openid%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcloudplatformprojects.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Ffirebase%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcloud-platform&response_type=code&state=323244459&redirect_uri=http%3A%2F%2Flocalhost%3A9005

Waiting for authentication...

✔  Success! Logged in as hupeitao@gmail.com
cd: no such file or directory: functions

Error: Too many arguments. Run firebase help functions:secrets:set for usage instructions

=== Deploying to 'aicompare-12989'...

i  deploying firestore, functions
i  firestore: ensuring required API firestore.googleapis.com is enabled...
✔  firestore: required API firestore.googleapis.com is enabled
i  firestore: ensuring required API firestore.googleapis.com is enabled...
i  firestore: reading indexes from firestore.indexes.json...
i  cloud.firestore: checking firestore.rules for compilation errors...
✔  cloud.firestore: rules file firestore.rules compiled successfully
i  functions: preparing codebase default for deployment
i  functions: ensuring required API cloudfunctions.googleapis.com is enabled...
i  functions: ensuring required API cloudbuild.googleapis.com is enabled...
i  artifactregistry: ensuring required API artifactregistry.googleapis.com is enabled...
⚠  functions: missing required API cloudfunctions.googleapis.com. Enabling now...
⚠  functions: missing required API cloudbuild.googleapis.com. Enabling now...
⚠  artifactregistry: missing required API artifactregistry.googleapis.com. Enabling now...

Error: Your project aicompare-12989 must be on the Blaze (pay-as-you-go) plan to complete this command. Required API cloudbuild.googleapis.com can't be enabled until the upgrade is complete. To upgrade, visit the following URL:

https://console.firebase.google.com/project/aicompare-12989/usage/details

Having trouble? Try firebase [command] --help
hasee@Mac-mini functions % npm install 
firebase functions:secrets:set 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   # 粘贴 sk_live_xxx
firebase deploy --only functions,firestore:rules
npm error code EEXIST
npm error syscall mkdir
npm error path /Users/hasee/.npm/_cacache/content-v2/sha512/75/34
npm error errno EEXIST
npm error Invalid response body while trying to fetch https://registry.npmjs.org/farmhash-modern: EACCES: permission denied, mkdir '/Users/hasee/.npm/_cacache/content-v2/sha512/75/34'
npm error File exists: /Users/hasee/.npm/_cacache/content-v2/sha512/75/34
npm error Remove the existing file and try again, or run npm
npm error with --force to overwrite files recklessly.
npm error A complete log of this run can be found in: /Users/hasee/.npm/_logs/2026-02-20T14_52_52_122Z-debug-0.log

Error: Too many arguments. Run firebase help functions:secrets:set for usage instructions

=== Deploying to 'aicompare-12989'...

i  deploying firestore, functions
i  firestore: ensuring required API firestore.googleapis.com is enabled...
i  firestore: ensuring required API firestore.googleapis.com is enabled...
i  firestore: reading indexes from firestore.indexes.json...
i  cloud.firestore: checking firestore.rules for compilation errors...
✔  cloud.firestore: rules file firestore.rules compiled successfully
i  functions: preparing codebase default for deployment
i  functions: ensuring required API cloudfunctions.googleapis.com is enabled...
i  functions: ensuring required API cloudbuild.googleapis.com is enabled...
i  artifactregistry: ensuring required API artifactregistry.googleapis.com is enabled...
⚠  functions: missing required API cloudbuild.googleapis.com. Enabling now...
⚠  artifactregistry: missing required API artifactregistry.googleapis.com. Enabling now...
⚠  functions: Runtime Node.js 20 will be deprecated on 2026-04-30 and will be decommissioned on 2026-10-30, after which you will not be able to deploy without upgrading. Consider upgrading now to avoid disruption. See https://cloud.google.com/functions/docs/runtime-support for full details on the lifecycle policy
⚠  functions: Couldn't find firebase-functions package in your source code. Have you run 'npm install'?
i  functions: Loading and analyzing source code for codebase default to determine what to deploy

Error: An unexpected error has occurred.

Having trouble? Try again or contact support with contents of firebase-debug.log
hasee@Mac-mini functions % sudo chown -R $(whoami) ~/.npm
Password:
hasee@Mac-mini functions % cp .env.example .env
hasee@Mac-mini functions % npm install
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: undefined,
npm warn EBADENGINE   required: { node: '20' },
npm warn EBADENGINE   current: { node: 'v22.18.0', npm: '10.9.3' }
npm warn EBADENGINE }
npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.
npm warn deprecated glob@10.5.0: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me
npm warn deprecated glob@7.2.3: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me

added 518 packages, and audited 519 packages in 30s

69 packages are looking for funding
  run `npm fund` for details

19 high severity vulnerabilities

To address issues that do not require attention, run:
  npm audit fix

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
hasee@Mac-mini functions % cd /Users/hasee/Documents/同步文稿/multi-AI
firebase deploy --only hosting,functions,firestore:rules

=== Deploying to 'aicompare-12989'...

i  deploying firestore, functions, hosting
i  firestore: ensuring required API firestore.googleapis.com is enabled...
i  firestore: ensuring required API firestore.googleapis.com is enabled...
i  firestore: reading indexes from firestore.indexes.json...
i  cloud.firestore: checking firestore.rules for compilation errors...
✔  cloud.firestore: rules file firestore.rules compiled successfully
i  functions: preparing codebase default for deployment
i  functions: ensuring required API cloudfunctions.googleapis.com is enabled...
i  functions: ensuring required API cloudbuild.googleapis.com is enabled...
i  artifactregistry: ensuring required API artifactregistry.googleapis.com is enabled...

Error: Detected node engine >=20 in package.json, which is not a supported version. Valid versions are 20, 22, 24
hasee@Mac-mini multi-AI % firebase deploy --only hosting,functions,firestore:rules

=== Deploying to 'aicompare-12989'...

i  deploying firestore, functions, hosting
i  firestore: ensuring required API firestore.googleapis.com is enabled...
i  firestore: ensuring required API firestore.googleapis.com is enabled...
i  firestore: reading indexes from firestore.indexes.json...
i  cloud.firestore: checking firestore.rules for compilation errors...
✔  cloud.firestore: rules file firestore.rules compiled successfully
i  functions: preparing codebase default for deployment
i  functions: ensuring required API cloudfunctions.googleapis.com is enabled...
i  functions: ensuring required API cloudbuild.googleapis.com is enabled...
i  artifactregistry: ensuring required API artifactregistry.googleapis.com is enabled...
⚠  functions: package.json indicates an outdated version of firebase-functions. Please upgrade using npm install --save firebase-functions@latest in your functions directory.
⚠  functions: Please note that there will be breaking changes when you upgrade.
i  functions: Loading and analyzing source code for codebase default to determine what to deploy
i  functions: You are using a version of firebase-functions SDK (4.9.0) that does not have support for the newest Firebase Extensions features. Please update firebase-functions SDK to >=5.1.0 to use them correctly
Serving at port 8941

i  functions: Loaded environment variables from .env.
i  functions: preparing functions directory for uploading...
i  functions: packaged /Users/hasee/Documents/同步文稿/multi-AI/functions (72.2 KB) for uploading
i  functions: ensuring required API run.googleapis.com is enabled...
i  functions: ensuring required API eventarc.googleapis.com is enabled...
i  functions: ensuring required API pubsub.googleapis.com is enabled...
i  functions: ensuring required API storage.googleapis.com is enabled...
✔  functions: required API storage.googleapis.com is enabled
⚠  functions: missing required API run.googleapis.com. Enabling now...
⚠  functions: missing required API eventarc.googleapis.com. Enabling now...
✔  functions: required API pubsub.googleapis.com is enabled
i  functions: generating the service identity for pubsub.googleapis.com...
i  functions: generating the service identity for eventarc.googleapis.com...
i  firestore: uploading rules firestore.rules...
✔  functions: functions source uploaded successfully
i  hosting[aicompare-12989]: beginning deploy...
i  hosting[aicompare-12989]: found 2 files in public
✔  hosting[aicompare-12989]: file upload complete
✔  firestore: released rules firestore.rules to cloud.firestore
i  functions: creating Node.js 22 (2nd Gen) function createCheckoutSession(us-central1)...
i  functions: creating Node.js 22 (2nd Gen) function stripeWebhook(us-central1)...
i  functions: creating Node.js 22 (2nd Gen) function getSubscriptionStatus(us-central1)...
i  functions: creating Node.js 22 (2nd Gen) function createPortalSession(us-central1)...
✔  functions[getSubscriptionStatus(us-central1)] Successful create operation.
✔  functions[stripeWebhook(us-central1)] Successful create operation.
✔  functions[createCheckoutSession(us-central1)] Successful create operation.
✔  functions[createPortalSession(us-central1)] Successful create operation.
Function URL (createCheckoutSession(us-central1)): https://us-central1-aicompare-12989.cloudfunctions.net/createCheckoutSession
Function URL (stripeWebhook(us-central1)): https://us-central1-aicompare-12989.cloudfunctions.net/stripeWebhook
Function URL (getSubscriptionStatus(us-central1)): https://us-central1-aicompare-12989.cloudfunctions.net/getSubscriptionStatus
Function URL (createPortalSession(us-central1)): https://us-central1-aicompare-12989.cloudfunctions.net/createPortalSession
⚠  functions: No cleanup policy detected for repositories in us-central1. This may result in a small monthly bill as container images accumulate over time.
✔ How many days do you want to keep container images before they're deleted? 1
i  functions: Configuring cleanup policy for repository in us-central1. Images older than 1 days will be automatically deleted.
i  functions: Configured cleanup policy for repository in us-central1.
i  hosting[aicompare-12989]: finalizing version...
✔  hosting[aicompare-12989]: version finalized
i  hosting[aicompare-12989]: releasing new version...
✔  hosting[aicompare-12989]: release complete

✔  Deploy complete!

Project Console: https://console.firebase.google.com/project/aicompare-12989/overview
Hosting URL: https://aicompare-12989.web.app




这个报错意思很明确：
> "Your request was in live mode, but used a known test card."
> 你用的是测试卡，但当前运行在生产模式（live mode）
原因是 functions/.env 里填的是 sk_live_xxx（正式密钥），所以 Stripe 创建的是真实付款会话，测试卡 4242... 在生产模式下会被拒绝。
解决方法：先用测试模式验证流程
把 functions/.env 里的密钥换成 sk_test_ 开头的测试密钥：
需要你手动做两件事：
① 在 Stripe Dashboard 获取测试密钥
右上角切换到 Test mode（开关拨到左边）→ Developers → API keys → 复制 sk_test_xxx
② 同样在 Test mode 下配置 Webhook
Test mode 的 Webhook 和 Live mode 是分开的，需要重新添加一个 test 用的 endpoint，获取对应的 whsec_test_xxx
③ 更新 .env 后重新部署
把 .env 第 8 行和第 12 行分别替换为测试密钥，然后：
cd /Users/hasee/Documents/同步文稿/multi-AIfirebase deploy --only functions
测试 vs 生产的区别：
测试模式	生产模式
密钥前缀	sk_test_	sk_live_
可用卡号	4242 4242 4242 4242	真实银行卡
实际扣款	不扣	真实扣款
测试流程跑通后，再把密钥换回 sk_live_ 和对应的 live webhook secret，重新部署即可上线。