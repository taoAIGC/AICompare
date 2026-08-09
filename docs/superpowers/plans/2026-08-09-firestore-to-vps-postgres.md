# Firestore To VPS PostgreSQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Firestore from the AI Compare runtime and persist all application documents in PostgreSQL on the existing VPS.

**Architecture:** Keep Firebase Authentication only for issuing and verifying existing user identities. Replace the Firestore Admin client with a PostgreSQL-backed document-store compatibility layer, migrate every Firestore collection recursively into a private PostgreSQL table, and change extension cloud sync and plan reads to authenticated VPS APIs.

**Tech Stack:** Node.js, Express, `pg`, PostgreSQL 16 in Docker, Firebase Admin Authentication, Caddy, Chrome extension APIs.

---

### Task 1: Provision private PostgreSQL

**Files:**
- Create: `backend/docker-compose.postgres.yml`
- Create: `backend/sql/schema.sql`

- [ ] Create a PostgreSQL 16 container bound only to `127.0.0.1`.
- [ ] Generate a server-only password and store it only in `/opt/ai-compare-backend/.env`.
- [ ] Apply schema and verify a local `psql` health query.

### Task 2: Add the PostgreSQL document store

**Files:**
- Create: `backend/postgres-document-store.js`
- Modify: `backend/server.js`
- Modify: `backend/package.json`
- Test: `backend/tests/postgres-document-store.test.js`

- [ ] Write failing unit tests for document CRUD, merge writes, query filters, ordering, batching, and transactions.
- [ ] Implement Firestore-compatible references and snapshots on PostgreSQL JSONB documents.
- [ ] Replace the Firestore database initialization path while retaining Firebase Auth initialization.
- [ ] Run server syntax checks and store tests.

### Task 3: Import and verify historic data

**Files:**
- Create: `backend/scripts/migrate-firestore-to-postgres.js`
- Create: `backend/scripts/verify-postgres-migration.js`

- [ ] Export every root collection and recursive subcollection through the existing Firebase Admin credential.
- [ ] Normalize Firestore timestamps to ISO timestamps and persist source paths deterministically.
- [ ] Compare source and target document counts before switching runtime storage.

### Task 4: Move extension cloud sync behind VPS APIs

**Files:**
- Modify: `backend/server.js`
- Modify: `firebase/firebase-sync.js`
- Modify: `background.js`
- Modify: `config/firebaseConfig.js`
- Modify: `AI Compare PrivacyPolicy.md`
- Modify: `README.md`

- [ ] Add authenticated read/write endpoints scoped to the Firebase UID.
- [ ] Replace direct `firestore.googleapis.com` requests with VPS API requests.
- [ ] Increase sync debouncing and ensure concurrent changes are coalesced.
- [ ] Replace the direct plan document request with the existing VPS plan endpoint.
- [ ] Update user-facing privacy and deployment documentation.

### Task 5: Deploy, switch, and retire Firestore

**Files:**
- Modify: `backend/.env.example`
- Modify: `backend/package-lock.json`

- [ ] Deploy the database and migration tooling to the VPS while production remains on Firestore.
- [ ] Snapshot existing Firestore data, migrate, verify counts, then restart production on PostgreSQL.
- [ ] Exercise `/health/deep`, plan lookup, and authenticated sync endpoints through Caddy.
- [ ] Remove Firestore runtime configuration and client Firestore access rules only after verification.
- [ ] Keep the export and encrypted PostgreSQL backup; then disable Firestore and delete its billing-risking database resources.
