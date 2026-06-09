require('dotenv').config();

const express = require('express');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const crypto = require('crypto');

const app = express();
const port = Number(process.env.PORT || 8790);
const dailyFreeLimit = Math.max(0, Number(process.env.OFFICIAL_API_DAILY_FREE_LIMIT || 100) || 100);

let adminInitialized = false;
let db = null;

function initializeFirebaseAdmin() {
  if (adminInitialized) return true;

  const serviceAccountJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const serviceAccountPath = String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  try {
    if (serviceAccountPath) {
      admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath))
      });
    } else if (serviceAccountJson) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountJson))
      });
    } else {
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'aicompare-12989'
      });
    }
    db = admin.firestore();
    adminInitialized = true;
    return true;
  } catch (error) {
    console.warn('[ai-compare-backend] Firebase Admin is not configured:', error.message);
    return false;
  }
}

function requireFirebaseAdmin() {
  if (!initializeFirebaseAdmin() || !db) {
    const error = new Error('Firebase Admin is not configured');
    error.status = 500;
    throw error;
  }
}

function getStripe() {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) {
    const error = new Error('STRIPE_SECRET_KEY is not configured');
    error.status = 500;
    throw error;
  }
  return new Stripe(secretKey, { apiVersion: '2024-06-20' });
}

function getCorsOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return '*';
  return origin;
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', getCorsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-AI-Compare-Locale, X-AI-Compare-Client-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.use('/stripeWebhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '2mb' }));

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || String(error) });
    }
  };
}

async function requireUser(req) {
  requireFirebaseAdmin();
  const authorization = String(req.headers.authorization || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }
  try {
    return await admin.auth().verifyIdToken(match[1]);
  } catch (error) {
    error.status = 401;
    throw error;
  }
}

async function getOptionalUser(req) {
  const authorization = String(req.headers.authorization || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  requireFirebaseAdmin();
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

function shouldMeterLocale(locale = '') {
  return !normalizeLocale(locale).startsWith('zh');
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getTimestampSeconds(value) {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return Math.floor(value.toDate().getTime() / 1000);
  if (typeof value.seconds === 'number') return value.seconds;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

async function getUserPlan(uid) {
  requireFirebaseAdmin();
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
    return { billingEnabled: false, limit: dailyFreeLimit, used: 0, remaining: Number.POSITIVE_INFINITY };
  }

  const plan = await getUserPlan(uid);
  if (plan.plan === 'pro') {
    return { billingEnabled: true, plan: 'pro', limit: dailyFreeLimit, used: 0, remaining: Number.POSITIVE_INFINITY };
  }

  const dateKey = getTodayKey();
  const usageRef = db.collection('users').doc(uid).collection('usage').doc(dateKey);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(usageRef);
    const used = snap.exists ? Math.max(0, Number(snap.data().officialApiCount) || 0) : 0;
    if (used >= dailyFreeLimit) {
      const error = new Error(`You've used today's ${dailyFreeLimit} free official API requests. Upgrade to PRO or switch to your own API.`);
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
      limit: dailyFreeLimit,
      used: nextUsed,
      remaining: Math.max(0, dailyFreeLimit - nextUsed)
    };
  });
}

async function consumeAnonymousOfficialApiUsage(clientId, locale) {
  if (!shouldMeterLocale(locale)) {
    return { billingEnabled: false, plan: 'anonymous', limit: dailyFreeLimit, used: 0, remaining: Number.POSITIVE_INFINITY };
  }

  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) {
    const error = new Error('Anonymous client id is required');
    error.status = 400;
    throw error;
  }

  requireFirebaseAdmin();
  const dateKey = getTodayKey();
  const clientHash = getAnonymousUsageDocId(normalizedClientId);
  const usageRef = db.collection('anonymousUsage').doc(clientHash).collection('usage').doc(dateKey);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(usageRef);
    const used = snap.exists ? Math.max(0, Number(snap.data().officialApiCount) || 0) : 0;
    if (used >= dailyFreeLimit) {
      const error = new Error(`You've used today's ${dailyFreeLimit} free official API requests. Upgrade to PRO or switch to your own API.`);
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
      limit: dailyFreeLimit,
      used: nextUsed,
      remaining: Math.max(0, dailyFreeLimit - nextUsed)
    };
  });
}

function getSuccessUrl() {
  return process.env.STRIPE_SUCCESS_URL || 'https://example.com/payment-success';
}

function getCancelUrl() {
  return process.env.STRIPE_CANCEL_URL || 'https://example.com/payment-cancel';
}

async function canReadFirestore() {
  try {
    requireFirebaseAdmin();
    await Promise.race([
      db.collection('users').limit(1).get(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Firestore check timed out')), 2500);
      })
    ]);
    return true;
  } catch (_) {
    return false;
  }
}

function getBasicHealth() {
  const firebaseAdminConfigured = initializeFirebaseAdmin();
  return {
    ok: true,
    firebaseAdminConfigured,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    officialApiConfigured: Boolean(process.env.OFFICIAL_AGENT_API_BASE_URL && process.env.OFFICIAL_AGENT_API_KEY)
  };
}

app.get('/health', (_req, res) => {
  res.json(getBasicHealth());
});

app.get('/health/deep', async (_req, res) => {
  const basicHealth = getBasicHealth();
  res.json({
    ...basicHealth,
    firestoreConfigured: basicHealth.firebaseAdminConfigured ? await canReadFirestore() : false
  });
});

app.post('/createCheckoutSession', asyncRoute(async (req, res) => {
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
}));

app.post('/createPortalSession', asyncRoute(async (req, res) => {
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
}));

app.get('/listInvoices', asyncRoute(async (req, res) => {
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
}));

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

app.post('/stripeWebhook', asyncRoute(async (req, res) => {
  requireFirebaseAdmin();
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!webhookSecret) {
    res.status(500).send('STRIPE_WEBHOOK_SECRET is not configured');
    return;
  }

  const stripe = getStripe();
  let event = null;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
  } catch (error) {
    error.status = 400;
    throw error;
  }

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
}));

app.post('/officialAgentChat', asyncRoute(async (req, res) => {
  const user = await getOptionalUser(req);
  const locale = String(req.headers['x-ai-compare-locale'] || req.body?.locale || '').trim();
  if (user?.uid) {
    await consumeOfficialApiUsage(user.uid, locale);
  } else {
    await consumeAnonymousOfficialApiUsage(getAnonymousClientId(req), locale);
  }

  const apiKey = String(process.env.OFFICIAL_AGENT_API_KEY || '').trim();
  const baseUrl = String(process.env.OFFICIAL_AGENT_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const defaultModel = String(process.env.OFFICIAL_AGENT_MODEL || '').trim();
  if (!apiKey || !baseUrl) {
    res.status(500).json({ error: 'Official API proxy is not configured' });
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
      model: req.body?.model || defaultModel
    })
  });

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
      res.setHeader(key, value);
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
}));

app.listen(port, '0.0.0.0', () => {
  console.log(`[ai-compare-backend] listening on ${port}`);
});
