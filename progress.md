# Progress Log

## Session: 2026-08-13

### Phase 1: Inventory and migration design

- **Status:** in_progress
- Actions taken:
  - Confirmed current data reads use VPS/PostgreSQL rather than Firestore.
  - Mapped remaining Firebase Auth usage in the extension and VPS.
  - Confirmed paid-user quota failure occurs when the extension sends no valid identity token.
  - Started a safe migration plan that preserves legacy user document IDs.
  - Confirmed email-code verification is already VPS-hosted but currently delegates user creation and token issuance to Firebase.
  - Confirmed Google account login is fully Firebase-mediated and cannot be retained after removal without a new direct Google OAuth/OIDC configuration.
  - Identified the current entitlement failure mechanism: the iframe displays logged-in state from a cached UID only, while the quota request falls back to anonymous usage whenever Firebase token refresh returns no usable ID token.
- Files created/modified:
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

## Test Results

| Test | Expected | Actual | Status |
|---|---|---|---|
| Production entitlement lookup for paid account | Active Chat Pro record | Active Chat Pro through 2026-09-12 | Pass |

## Current Blocker

- Firebase removal is deferred by user direction. No Firebase identity, configuration, or login flow will be removed in this task.
- The investigation is complete; the separately identified token-to-anonymous fallback issue remains available for a focused fix if requested.

### Phase 6: Prevent member sessions from falling back to anonymous quota

- **Status:** complete
- Actions taken:
  - Changed background token refresh from direct Google Secure Token access to the existing VPS `/auth/firebase-token/refresh` endpoint.
  - Preserved locally stored credentials for transient VPS/upstream failures; only explicit 400/401 refresh failures clear the Firebase session.
  - Blocked the quota request with `AUTH_SESSION_EXPIRED` when a stored signed-in UID cannot obtain a token, preventing anonymous quota fallback.
  - Added regression tests for the VPS refresh route and the no-anonymous-fallback invariant.
- Files modified:
  - `background.js`
  - `tests/chat-plan-auth.test.js`
- Verification:
  - `node --check background.js` passed.
  - `node --test tests/chat-plan-auth.test.js tests/auth-error-handling.test.js tests/membership-plan-source.test.js` passed (10 tests).
