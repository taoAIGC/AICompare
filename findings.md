# Findings: Firebase Removal

## Requirements

- Completely remove Firebase as a runtime dependency, including authentication.
- Continue using the VPS/PostgreSQL backend for memberships, quotas, sync, billing, and account data.
- Avoid breaking paid accounts whose current PostgreSQL document IDs equal Firebase UIDs.

## Research Findings

- Application data already lives in PostgreSQL (`app_documents`) behind the VPS document-store adapter; the extension no longer makes direct Firestore requests.
- Firebase still owns identity. The extension stores `firebase_uid`, `firebase_idToken`, and `firebase_refreshToken`; the VPS verifies Firebase ID tokens with Firebase Admin.
- A missing Firebase token causes `/chatPlanUsage/consume` to use anonymous quota, even if the corresponding PostgreSQL account is a paid member.
- The iframe treats the presence of `firebase_uid` as "logged in", but the background quota request requires both a non-expired `firebase_idToken` and `firebase_refreshToken`. This creates a false logged-in state after token expiry, storage loss, or refresh failure.
- Firebase ID tokens are treated as stale one minute before expiry. Background refresh calls `securetoken.googleapis.com` directly; a network/Google endpoint failure returns an empty token, while a non-OK response also clears all local Firebase credentials.
- Stripe subscription records contain `firebaseUid` metadata and map to `users/{uid}`. Existing document paths must therefore remain compatible during migration.
- Production account `dengjiatao2000@gmail.com` is an active Chat Pro member in PostgreSQL; its quota issue was caused by an anonymous request, not a membership data issue.

## Technical Decisions

| Decision | Rationale |
|---|---|
| Implement a VPS-owned credential layer before deleting Firebase-specific paths | Enables a safe migration and avoids locking out current paid users. |
| Keep legacy UID as `userId`/document id | Existing paid subscriptions and user data remain attached without copying collections. |
| Use verified email-code sign-in initially | Existing VPS email-code delivery can be adapted without a third-party identity provider. Google sign-in requires a separate OAuth replacement decision. |

## Resources

- `backend/server.js`: VPS auth, billing, and PostgreSQL document access.
- `firebase/firebase-auth.js`: extension Firebase identity state and email-code flow.
- `background.js`: quota calls and Firebase token refresh.
- `firebase/stripe-payment.js`: membership plan and billing calls.
