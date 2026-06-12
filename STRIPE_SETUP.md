# Stripe 订阅集成说明

AI 比一比 使用 `Stripe + Firebase Cloud Functions` 实现 Pro 订阅。

## 1. 创建商品

1. 打开 Stripe Dashboard
2. 创建产品 `AI Compare Pro`
3. 配置月付和年付两个 Price，并记录 `price_xxx`

## 2. 配置密钥

把下面这些值写到 Cloud Functions 或 VPS backend 对应的 `.env`，不要提交到 GitHub：

```bash
STRIPE_SECRET_KEY=sk_test_or_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_SUCCESS_URL=https://aicompare.club/payment-success
STRIPE_CANCEL_URL=https://aicompare.club/payment-cancel
OFFICIAL_AGENT_API_BASE_URL=https://your-official-api.example/v1
OFFICIAL_AGENT_API_KEY=your_official_api_key
OFFICIAL_AGENT_MODEL=your-default-model
OFFICIAL_API_DAILY_FREE_LIMIT=100
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=replace_with_sha256_hex
ADMIN_SESSION_SECRET=replace_with_random_secret
ADMIN_SESSION_TTL_SECONDS=43200
ADMIN_SESSION_ORIGIN=https://aicompare.club
```

注意：

- `sk_test_...` 和 `sk_live_...` 不要混用
- Webhook 的 `whsec_...` 也必须和当前模式一致
- `functions/.env` 只能本地保存
- `OFFICIAL_AGENT_*` 只保存在 Cloud Functions 环境中，不要写入扩展前端代码
- `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` 用于后台账号密码登录
- `ADMIN_SESSION_SECRET` 建议单独设置，不要长期依赖 webhook secret 兼用

## 2.1 VPS backend 额外说明

如果你把官方 API 代理和运营后台跑在仓库里的 `backend/server.js`：

1. 进入 `backend/`
2. `npm install`
3. 写入同样的环境变量
4. 启动 `node server.js`

启动后可用入口：

- `/admin/login`：管理员登录页
- `/admin`：概览页
- `/admin/orders`：会员订单页
- `/admin/api-usage`：API 使用页

后台登录流程：

1. 准备后台管理员账号和密码
2. 打开 `/admin/login`
3. 输入账号密码，换取 HttpOnly session cookie
4. 再访问后台统计页面

## 3. 部署

```bash
cd <REPO_ROOT>
cd functions && npm install && cd ..
firebase deploy --only functions,firestore:rules
```

如果你的 Cloud Functions 不在这个仓库里，把 `<REPO_ROOT>` 换成对应工作区即可。  
如果你使用 VPS backend，则改为在 `backend/` 目录直接启动 Node 服务，不需要 `firebase deploy --only functions` 这一步。

## 4. 配置 Webhook

1. 在 Stripe Dashboard 里创建 Webhook endpoint
2. 指向你的 `stripeWebhook` 函数地址
3. 订阅：
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. 保存后，把新生成的 `whsec_...` 写回 `.env`
5. 重新部署

## 5. 验证

1. 打开扩展的 Pro 页面
2. 点击订阅
3. 在测试模式下使用 Stripe 测试卡 `4242 4242 4242 4242`
4. 调用 `officialAgentChat` 时，登录用户携带 Firebase ID Token，未登录用户携带匿名 client id；免费/未登录用户在非中文界面每天可用 100 次，超过后函数返回 402
5. VPS backend 会在每次官方 API 请求时新增一条 `officialApiEvents` 记录，供后台统计 Pro / free / anonymous 使用量

如果在正式模式下测试，测试卡会被拒绝，这是正常现象。

## 常见问题

- `No such customer`：通常是测试/正式密钥混用了
- `functions/.env` 没生效：确认已重新部署
- Webhook 验证失败：确认 `whsec_...` 来自当前模式的 endpoint
- `Official API proxy is not configured`：确认 `OFFICIAL_AGENT_API_BASE_URL` 和 `OFFICIAL_AGENT_API_KEY` 已配置并重新部署
- 管理后台进不去：确认 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD_HASH` 已正确配置
