# Stripe 订阅集成说明

AI 比一比 使用 `Stripe + Firebase Cloud Functions` 实现 Pro 订阅。

## 1. 创建商品

1. 打开 Stripe Dashboard
2. 创建产品 `AI Compare Pro`
3. 配置月付和年付两个 Price，并记录 `price_xxx`

## 2. 配置密钥

把下面这些值写到 `<FUNCTIONS_ROOT>/.env`，不要提交到 GitHub：

```bash
STRIPE_SECRET_KEY=sk_test_or_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_SUCCESS_URL=https://your-domain.example/payment-success
STRIPE_CANCEL_URL=https://your-domain.example/payment-cancel
```

注意：

- `sk_test_...` 和 `sk_live_...` 不要混用
- Webhook 的 `whsec_...` 也必须和当前模式一致
- `functions/.env` 只能本地保存

## 3. 部署

```bash
cd <REPO_ROOT>
firebase deploy --only functions,firestore:rules
```

如果你的 Cloud Functions 不在这个仓库里，把 `<REPO_ROOT>` 换成对应工作区即可。

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

如果在正式模式下测试，测试卡会被拒绝，这是正常现象。

## 常见问题

- `No such customer`：通常是测试/正式密钥混用了
- `functions/.env` 没生效：确认已重新部署
- Webhook 验证失败：确认 `whsec_...` 来自当前模式的 endpoint
