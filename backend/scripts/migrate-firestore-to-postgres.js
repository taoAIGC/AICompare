#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const admin = require('firebase-admin');
const { createDocumentStore } = require('../postgres-document-store.js');

function normalize(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
}

function initializeFirebase() {
  const serviceAccountPath = String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  const serviceAccountJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (serviceAccountPath) admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
  else if (serviceAccountJson) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccountJson)) });
  else throw new Error('Firebase service account credentials are required for migration');
  return admin.firestore();
}

async function copyCollection(source, target, collectionPath) {
  const snapshot = await source.collection(collectionPath).get();
  let copied = 0;
  for (const doc of snapshot.docs) {
    const targetRef = target.collection(collectionPath).doc(doc.id);
    await targetRef.set(normalize(doc.data()));
    copied += 1;
    const subcollections = await doc.ref.listCollections();
    for (const subcollection of subcollections) {
      copied += await copyCollection(source, target, `${collectionPath}/${doc.id}/${subcollection.id}`);
    }
  }
  return copied;
}

(async () => {
  if (process.env.CONFIRM_FIRESTORE_MIGRATION !== 'yes') throw new Error('Set CONFIRM_FIRESTORE_MIGRATION=yes to run');
  const source = initializeFirebase();
  const target = createDocumentStore(process.env.POSTGRES_URL);
  await target.initialize();
  const collections = await source.listCollections();
  let total = 0;
  for (const collection of collections) total += await copyCollection(source, target, collection.id);
  console.log(JSON.stringify({ ok: true, copiedDocuments: total }));
  await target.close();
  await admin.app().delete();
  process.exit(0);
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
