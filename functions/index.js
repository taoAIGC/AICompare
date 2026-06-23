const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const Stripe = require('stripe');
const crypto = require('crypto');

admin.initializeApp();

const db = admin.firestore();
const DAILY_FREE_LIMIT = Number(process.env.OFFICIAL_API_DAILY_FREE_LIMIT || 100);
const DEFAULT_REGION = process.env.FUNCTION_REGION || 'us-central1';
const BILLING_MODE = String(process.env.BILLING_MODE || 'test').trim() || 'test';

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return new Stripe(secretKey, { apiVersion: '2024-06-20' });
}

function getCorsOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return '*';
  if (origin.startsWith('chrome-extension://')) return origin;
  return origin;
}

function applyCors(req, res) {
  res.set('Access-Control-Allow-Origin', getCorsOrigin(req));
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-AI-Compare-Locale, X-AI-Compare-Client-Id');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function handleOptions(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

function isAnthropicOfficialApi(baseUrl = '') {
  const configuredFormat = String(process.env.OFFICIAL_AGENT_API_FORMAT || '').trim().toLowerCase();
  if (configuredFormat === 'anthropic') {
    return true;
  }
  return /\/anthropic(?:\/v\d+)?\/?$/i.test(String(baseUrl || '').trim());
}

function parseDataUrlImageSource(url = '') {
  const match = String(url || '').match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) {
    return null;
  }
  return {
    type: 'base64',
    media_type: match[1],
    data: match[2]
  };
}

function normalizeAnthropicContent(content) {
  if (Array.isArray(content)) {
    const parts = [];
    content.forEach((part) => {
      if (!part || typeof part !== 'object') return;
      if (part.type === 'text' && part.text) {
        parts.push({ type: 'text', text: String(part.text) });
        return;
      }
      if (part.type === 'image_url') {
        const source = parseDataUrlImageSource(part.image_url?.url || part.url || '');
        if (source) {
          parts.push({ type: 'image', source });
        }
      }
    });
    return parts.length ? parts : [{ type: 'text', text: '' }];
  }
  return [{ type: 'text', text: String(content || '') }];
}

function buildAnthropicMessages(openAiMessages = []) {
  const system = [];
  const messages = [];

  (Array.isArray(openAiMessages) ? openAiMessages : []).forEach((message) => {
    const role = String(message?.role || 'user').trim();
    const content = normalizeAnthropicContent(message?.content);
    if (role === 'system') {
      const text = content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim();
      if (text) system.push(text);
      return;
    }

    const anthropicRole = role === 'assistant' ? 'assistant' : 'user';
    const previous = messages[messages.length - 1];
    if (previous && previous.role === anthropicRole) {
      previous.content.push(...content);
      return;
    }
    messages.push({
      role: anthropicRole,
      content
    });
  });

  if (!messages.length) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: '' }]
    });
  }

  return {
    system: system.join('\n\n'),
    messages
  };
}

function buildAnthropicRequestBody(body = {}, model = '') {
  const { system, messages } = buildAnthropicMessages(body.messages);
  const maxTokens = Math.max(
    1,
    Number(body.max_tokens || body.maxTokens || process.env.OFFICIAL_AGENT_MAX_TOKENS || 4096) || 4096
  );
  const payload = {
    model,
    max_tokens: maxTokens,
    messages,
    stream: body.stream === true
  };

  if (system) payload.system = system;
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.top_p !== undefined) payload.top_p = body.top_p;
  if (body.stop !== undefined) {
    payload.stop_sequences = Array.isArray(body.stop) ? body.stop : [String(body.stop)];
  }
  return payload;
}

function anthropicResponseToOpenAiCompletion(data = {}, model = '') {
  const content = Array.isArray(data.content)
    ? data.content
        .filter((part) => part?.type === 'text' && part.text)
        .map((part) => part.text)
        .join('')
    : '';
  const inputTokens = Number(data.usage?.input_tokens) || 0;
  const outputTokens = Number(data.usage?.output_tokens) || 0;

  return {
    id: data.id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model || model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content
      },
      finish_reason: data.stop_reason || 'stop'
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    }
  };
}

function writeOpenAiStreamDelta(res, content = '') {
  if (!content) return;
  res.write(`data: ${JSON.stringify({
    choices: [{
      index: 0,
      delta: { content },
      finish_reason: null
    }]
  })}\n\n`);
}

async function pipeAnthropicStreamAsOpenAi(upstream, res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');

  const reader = upstream.body?.getReader?.();
  if (!reader) {
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let doneSent = false;

  const handleLine = (rawLine = '') => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const rawPayload = line.slice(5).trim();
    if (!rawPayload || rawPayload === '[DONE]') return;

    let payload = null;
    try {
      payload = JSON.parse(rawPayload);
    } catch (_) {
      return;
    }

    if (payload.type === 'content_block_delta') {
      writeOpenAiStreamDelta(res, payload.delta?.text || '');
      return;
    }
    if (payload.type === 'message_stop') {
      res.write('data: [DONE]\n\n');
      doneSent = true;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(handleLine);
  }

  if (buffer) handleLine(buffer);
  if (!doneSent) {
    res.write('data: [DONE]\n\n');
  }
  res.end();
}

async function proxyAnthropicOfficialAgentChat(req, res, { apiKey, baseUrl, model }) {
  const upstream = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'x-api-key': apiKey,
      'anthropic-version': process.env.OFFICIAL_AGENT_ANTHROPIC_VERSION || '2023-06-01'
    },
    body: JSON.stringify(buildAnthropicRequestBody(req.body || {}, model))
  });

  res.status(upstream.status);
  if (!upstream.ok) {
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    res.send(await upstream.text());
    return;
  }

  if (req.body?.stream === true) {
    await pipeAnthropicStreamAsOpenAi(upstream, res);
    return;
  }

  const data = await upstream.json();
  res.json(anthropicResponseToOpenAiCompletion(data, model));
}

async function requireUser(req) {
  const authorization = String(req.headers.authorization || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }
  return admin.auth().verifyIdToken(match[1]);
}

async function getOptionalUser(req) {
  const authorization = String(req.headers.authorization || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  try {
    return await admin.auth().verifyIdToken(match[1]);
  } catch (error) {
    error.status = 401;
    throw error;
  }
}

function getAnonymousClientId(req) {
  return String(req.headers['x-ai-compare-client-id'] || req.body?.anonymousClientId || '').trim();
}

function getAnonymousUsageDocId(clientId) {
  return crypto
    .createHash('sha256')
    .update(String(clientId || ''))
    .digest('hex');
}

function normalizeLocale(locale = '') {
  return String(locale || '').trim().replace('-', '_').toLowerCase();
}

function isChineseLocale(locale = '') {
  return normalizeLocale(locale).startsWith('zh');
}

function shouldMeterLocale(locale = '') {
  return !isChineseLocale(locale);
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getTimestampSeconds(value) {
  if (!value) return 0;
  if (typeof value.toDate === 'function') {
    return Math.floor(value.toDate().getTime() / 1000);
  }
  if (typeof value.seconds === 'number') {
    return value.seconds;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

async function getUserPlan(uid) {
  const snap = await db.collection('users').doc(uid).get();
  const data = snap.exists ? snap.data() || {} : {};
  const expiresAtSeconds = getTimestampSeconds(data.planExpiresAt);
  const isActive = data.plan === 'pro' && (!expiresAtSeconds || expiresAtSeconds > Math.floor(Date.now() / 1000));
  return {
    plan: isActive ? 'pro' : 'free',
    planExpiresAt: data.planExpiresAt || null,
    stripeCustomerId: data.stripeCustomerId || ''
  };
}

async function consumeOfficialApiUsage(uid, locale) {
  if (!shouldMeterLocale(locale)) {
    return { billingEnabled: false, limit: DAILY_FREE_LIMIT, used: 0, remaining: Number.POSITIVE_INFINITY };
  }

  const plan = await getUserPlan(uid);
  if (plan.plan === 'pro') {
    return { billingEnabled: true, plan: 'pro', limit: DAILY_FREE_LIMIT, used: 0, remaining: Number.POSITIVE_INFINITY };
  }

  const dateKey = getTodayKey();
  const usageRef = db.collection('users').doc(uid).collection('usage').doc(dateKey);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(usageRef);
    const used = snap.exists ? Math.max(0, Number(snap.data().officialApiCount) || 0) : 0;
    if (used >= DAILY_FREE_LIMIT) {
      const error = new Error(`You've used today's ${DAILY_FREE_LIMIT} free official API requests. Upgrade to PRO or switch to your own API.`);
      error.status = 402;
      throw error;
    }
    const nextUsed = used + 1;
    transaction.set(usageRef, {
      officialApiCount: nextUsed,
      date: dateKey,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return {
      billingEnabled: true,
      plan: 'free',
      limit: DAILY_FREE_LIMIT,
      used: nextUsed,
      remaining: Math.max(0, DAILY_FREE_LIMIT - nextUsed)
    };
  });
}

async function consumeAnonymousOfficialApiUsage(clientId, locale) {
  if (!shouldMeterLocale(locale)) {
    return { billingEnabled: false, plan: 'anonymous', limit: DAILY_FREE_LIMIT, used: 0, remaining: Number.POSITIVE_INFINITY };
  }

  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) {
    const error = new Error('Anonymous client id is required');
    error.status = 400;
    throw error;
  }

  const dateKey = getTodayKey();
  const clientHash = getAnonymousUsageDocId(normalizedClientId);
  const usageRef = db.collection('anonymousUsage').doc(clientHash).collection('usage').doc(dateKey);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(usageRef);
    const used = snap.exists ? Math.max(0, Number(snap.data().officialApiCount) || 0) : 0;
    if (used >= DAILY_FREE_LIMIT) {
      const error = new Error(`You've used today's ${DAILY_FREE_LIMIT} free official API requests. Upgrade to PRO or switch to your own API.`);
      error.status = 402;
      throw error;
    }
    const nextUsed = used + 1;
    transaction.set(usageRef, {
      officialApiCount: nextUsed,
      date: dateKey,
      clientHash,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return {
      billingEnabled: true,
      plan: 'anonymous',
      limit: DAILY_FREE_LIMIT,
      used: nextUsed,
      remaining: Math.max(0, DAILY_FREE_LIMIT - nextUsed)
    };
  });
}

function getSuccessUrl() {
  return process.env.STRIPE_SUCCESS_URL || 'https://example.com/payment-success';
}

function getCancelUrl() {
  return process.env.STRIPE_CANCEL_URL || 'https://example.com/payment-cancel';
}

function getStripePrices() {
  return {
    monthly: String(process.env.STRIPE_PRICE_MONTHLY || '').trim(),
    yearly: String(process.env.STRIPE_PRICE_YEARLY || '').trim()
  };
}

exports.billingConfig = onRequest({ region: DEFAULT_REGION }, async (req, res) => {
  if (handleOptions(req, res)) return;
  applyCors(req, res);
  res.json({
    mode: BILLING_MODE,
    prices: getStripePrices()
  });
});

exports.createCheckoutSession = onRequest({ region: DEFAULT_REGION }, async (req, res) => {
  if (handleOptions(req, res)) return;
  applyCors(req, res);

  try {
    const user = await requireUser(req);
    const priceId = String(req.body?.priceId || '').trim();
    if (!priceId) {
      res.status(400).json({ error: 'priceId is required' });
      return;
    }

    const stripe = getStripe();
    const userRef = db.collection('users').doc(user.uid);
    const plan = await getUserPlan(user.uid);
    let customerId = plan.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { firebaseUid: user.uid }
      });
      customerId = customer.id;
      await userRef.set({ stripeCustomerId: customerId }, { merge: true });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: getSuccessUrl(),
      cancel_url: getCancelUrl(),
      metadata: { firebaseUid: user.uid },
      subscription_data: {
        metadata: { firebaseUid: user.uid }
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || String(error) });
  }
});

exports.createPortalSession = onRequest({ region: DEFAULT_REGION }, async (req, res) => {
  if (handleOptions(req, res)) return;
  applyCors(req, res);

  try {
    const user = await requireUser(req);
    const plan = await getUserPlan(user.uid);
    if (!plan.stripeCustomerId) {
      res.status(400).json({ error: 'No Stripe customer found for this user' });
      return;
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: plan.stripeCustomerId,
      return_url: getSuccessUrl()
    });
    res.json({ url: session.url });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || String(error) });
  }
});

exports.listInvoices = onRequest({ region: DEFAULT_REGION }, async (req, res) => {
  if (handleOptions(req, res)) return;
  applyCors(req, res);

  try {
    const user = await requireUser(req);
    const plan = await getUserPlan(user.uid);
    if (!plan.stripeCustomerId) {
      res.json({ invoices: [] });
      return;
    }

    const stripe = getStripe();
    const result = await stripe.invoices.list({
      customer: plan.stripeCustomerId,
      limit: 20
    });

    const invoices = Array.isArray(result?.data) ? result.data.map((invoice) => ({
      id: String(invoice.id || ''),
      number: String(invoice.number || ''),
      status: String(invoice.status || ''),
      currency: String(invoice.currency || 'usd'),
      amountPaid: Number(invoice.amount_paid || 0),
      amountDue: Number(invoice.amount_due || 0),
      createdAt: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
      hostedInvoiceUrl: String(invoice.hosted_invoice_url || ''),
      invoicePdf: String(invoice.invoice_pdf || '')
    })) : [];

    res.json({ invoices });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || String(error) });
  }
});

async function updateUserFromSubscription(subscription) {
  const uid = subscription.metadata?.firebaseUid;
  if (!uid) return;

  const item = subscription.items?.data?.[0];
  const periodEnd = item?.current_period_end || subscription.current_period_end || 0;
  const isActive = ['active', 'trialing'].includes(subscription.status);

  await db.collection('users').doc(uid).set({
    plan: isActive ? 'pro' : 'free',
    planExpiresAt: periodEnd ? admin.firestore.Timestamp.fromMillis(periodEnd * 1000) : null,
    stripeCustomerId: String(subscription.customer || ''),
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

exports.stripeWebhook = onRequest({ region: DEFAULT_REGION }, async (req, res) => {
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    const stripe = getStripe();
    const signature = req.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(req.rawBody, signature, webhookSecret);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        await updateUserFromSubscription(subscription);
      }
    }

    if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted' ||
      event.type === 'invoice.payment_succeeded'
    ) {
      const object = event.data.object;
      const subscriptionId = object.subscription || object.id;
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await updateUserFromSubscription(subscription);
      }
    }

    res.json({ received: true });
  } catch (error) {
    res.status(400).send(`Webhook Error: ${error.message || error}`);
  }
});

exports.officialAgentChat = onRequest({ region: DEFAULT_REGION, timeoutSeconds: 300 }, async (req, res) => {
  if (handleOptions(req, res)) return;
  applyCors(req, res);

  try {
    const user = await getOptionalUser(req);
    const locale = String(req.headers['x-ai-compare-locale'] || req.body?.locale || '').trim();
    if (user?.uid) {
      await consumeOfficialApiUsage(user.uid, locale);
    } else {
      await consumeAnonymousOfficialApiUsage(getAnonymousClientId(req), locale);
    }

    const apiKey = process.env.OFFICIAL_AGENT_API_KEY;
    const baseUrl = String(process.env.OFFICIAL_AGENT_API_BASE_URL || '').replace(/\/+$/, '');
    const defaultModel = String(process.env.OFFICIAL_AGENT_MODEL || '').trim();
    const model = String(req.body?.model || defaultModel).trim();
    if (!apiKey || !baseUrl || !model) {
      res.status(500).json({ error: 'Official API proxy is not configured' });
      return;
    }

    if (isAnthropicOfficialApi(baseUrl)) {
      await proxyAnthropicOfficialAgentChat(req, res, { apiKey, baseUrl, model });
      return;
    }

    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        ...req.body,
        model
      })
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
        res.set(key, value);
      }
    });

    if (!upstream.body) {
      res.send(await upstream.text());
      return;
    }

    const reader = upstream.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || String(error) });
  }
});
