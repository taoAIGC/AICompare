# Task Plan: Remove Firebase Authentication

## Goal

Firebase removal was investigated and intentionally deferred. Preserve the current Firebase identity layer while continuing to use VPS/PostgreSQL for application data.

## Current Phase

Focused token-refresh fix completed.

## Phases

### Phase 1: Inventory and migration design

- [x] Map Firebase Auth, Firestore, VPS/PostgreSQL, Stripe, and extension call sites.
- [x] Identify compatibility constraints for existing Firebase UID-based account records.
- [x] Define VPS token/session and email-login migration architecture.
- **Status:** complete (migration deferred)

### Phase 2: VPS authentication foundation (not authorized)

- [ ] Add PostgreSQL-backed user identity and refresh-session support.
- [ ] Implement signed VPS access tokens and request authentication.
- [ ] Preserve legacy Firebase UID as the permanent user document id during migration.
- **Status:** complete (explicitly deferred by user)

### Phase 3: Extension migration (not authorized)

- [ ] Replace Firebase token storage/refresh with VPS session storage/refresh.
- [ ] Route quota, sync, billing, and analytics requests through VPS access tokens.
- [ ] Remove Firebase Auth runtime configuration and scripts.
- **Status:** complete (explicitly deferred by user)

### Phase 4: Billing and operational migration (not authorized)

- [ ] Replace Stripe/Firebase UID metadata and email-account binding with VPS user ids.
- [ ] Update hosted pricing and admin user inventory.
- [ ] Provide a one-time legacy account claim/login path.
- **Status:** complete (explicitly deferred by user)

### Phase 5: Verification and deployment preparation (not applicable)

- [ ] Add focused tests for token issuance, refresh, plan entitlement, and anonymous fallback.
- [ ] Run syntax/tests and document deploy-time environment migration.
- [ ] Update README and privacy/deployment documentation.
- **Status:** complete (no migration changes to verify)

### Phase 6: Prevent member sessions from falling back to anonymous quota

- [x] Route background token refresh through the VPS auth endpoint.
- [x] Preserve local credentials for transient refresh/network failures.
- [x] Reject expired member sessions before quota fallback.
- [x] Add and run focused regression coverage.
- **Status:** complete

## Key Questions

1. Which login options must be retained after Firebase is removed: email code only, Google OAuth, or both?
2. Can legacy Firebase accounts be mapped by verified email without a forced user migration?
3. Should this change be delivered as a compatible rollout before Firebase credentials are removed from production?

## Decisions Made

| Decision | Rationale |
|---|---|
| Retain existing user document paths as canonical VPS user IDs | Preserves subscriptions, history, sync, referrals, and usage records without a destructive data migration. |
| Use VPS access + rotating refresh tokens | Lets all protected APIs authenticate without Firebase while keeping extension sessions recoverable. |
| Defer Firebase removal | User requested Firebase remain in place for now. |

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| None | — | — |
