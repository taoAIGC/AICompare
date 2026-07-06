# Privacy Policy for AI Compare（AI比一比） Browser Extension

**Last Updated:** July 6, 2026

## Introduction

This Privacy Policy explains how AI Compare（AI比一比） ("we", "our", or "the extension") collects, processes, stores, and shares user information. We are committed to protecting your privacy and being transparent about our practices. If you have any questions, please contact us at **AIShortcuts@outlook.com**.

---

## 1. Data Collection

The extension may collect and process the following categories of data:

### 1.1 Locally Stored Data (Default Behavior)

| Data Type | Description | Purpose | Storage Location |
|-----------|-------------|---------|------------------|
| **Search/Query History** | Your AI search queries, site names, and URLs you visited | To display history and allow you to revisit past comparisons | `chrome.storage.local` (on your device only) |
| **Favorites** | Favorite prompts (text you save), favorite AI sites, folder organization | To provide quick access to your preferred prompts and sites | `chrome.storage.sync` or `chrome.storage.local` |
| **Settings** | Button configuration, sync preferences, WebDAV credentials (if you enable sync) | To customize the extension and perform sync when you choose | `chrome.storage.local` |
| **Failure / Diagnostic Logs** | Limited failure records such as failure time, site name or API type, error phase, HTTP status, error summary, model, locale, sanitized URL, `queryPreview`, `queryHash`, repeat count, and sync status | To diagnose site automation failures, API request failures, reliability issues, abuse, and compatibility problems | `chrome.storage.local`; may also be uploaded to our VPS/Firebase Firestore as described below |

### 1.2 Data Requiring Explicit Permission

| Data Type | Description | When Collected | Purpose |
|-----------|-------------|----------------|---------|
| **Clipboard Content** | Text or images from your clipboard | Only when you use the paste feature in the extension | To paste content into AI chat inputs as you requested |
| **Google Account Identity** | Email and user ID (via OAuth) | Only when you sign in with Google for cloud sync | To associate your synced data with your account |
| **Remote Search Query / Result Payloads** | Search text and streamed result frames exchanged between paired devices | Only when you enable Remote Search | To relay your request from phone to desktop and stream results back |
| **Account / Anonymous Identifier for Diagnostics** | Firebase UID for signed-in users, or a hashed anonymous device/client identifier for signed-out users | When diagnostic logs are uploaded | To attribute diagnostic logs, prevent abuse, deduplicate uploads, and enforce upload limits |

### 1.3 Data We Do NOT Collect

- We do not collect your browsing history outside of the extension's own history feature.
- We do not sell or share your data with advertisers.
- Analytics (if configurable) can be disabled; when enabled, it collects only anonymized usage events.
- We do not collect or upload API keys, full prompts, full AI responses, full page contents, clipboard contents, WebDAV credentials, or full payment card details in diagnostic logs.
- URLs in diagnostic logs are sanitized where possible. Obvious sensitive query parameters such as `token`, `key`, `auth`, `code`, `secret`, `password`, `session`, `credential`, `access`, and `refresh` are redacted before storage or upload.

---

## 2. Data Processing

- **Purpose limitation:** All collected data is used solely to provide extension functionality (history, favorites, sync, paste), maintain service reliability, diagnose failures, improve compatibility, and prevent abuse.
- **Local processing:** Query input, site detection, and UI operations are performed locally in your browser.
- **Cloud processing:** Only when you enable Firebase sync or WebDAV sync, your history and favorites are processed for synchronization.
- **Diagnostic processing:** Failure / diagnostic logs are minimized before upload. The extension stores only a short `queryPreview` and a `queryHash` rather than the full prompt, and the backend applies additional field allow-listing, length limits, and sensitive-parameter redaction.

---

## 3. Data Storage

- **Local storage:** Most extension data is stored on your device using Chrome's storage APIs. Search history, favorites, settings, and local failure logs remain available locally until you clear them or uninstall the extension.
- **Diagnostic log upload:** Failure / diagnostic logs may be automatically uploaded in small batches to our VPS backend and stored in Firebase Firestore. Signed-in uploads may be associated with your Firebase UID. Signed-out uploads may be associated with a hashed anonymous client identifier.
- **Firebase (optional):** If you sign in with Google and enable cloud sync, your history, favorites, and folder structure are stored in Google Firestore, associated with your Google account.
- **WebDAV (optional):** If you configure WebDAV sync in settings, a copy of your settings and history is stored on the WebDAV server you specify. You control the server and its location.
- **Retention:** Locally stored data remains until you uninstall the extension or clear it. Local failure logs are capped at 30 days or 2,000 records. Cloud data (Firebase) remains until you request deletion (see Section 7); signing out only stops further syncing. Diagnostic logs uploaded to our backend are retained only as long as needed for reliability analysis, abuse prevention, and troubleshooting, and may be deleted or aggregated over time. WebDAV data is under your control.

---

## 4. Data Sharing

- **No sale of data:** We do not sell your data to third parties.
- **Firebase (Google):** When you enable cloud sync, data is transmitted to and stored on Google Cloud (Firestore) under our Firebase project. Google's privacy policy applies to their services: https://policies.google.com/privacy
- **VPS backend / Firebase Firestore for diagnostics:** Failure / diagnostic logs may be sent to our VPS backend and stored in Firebase Firestore. These logs are used only for troubleshooting, reliability analysis, compatibility improvements, abuse prevention, and operational monitoring.
- **WebDAV:** If you configure WebDAV, data is sent only to the URL you provide. We do not have access to your WebDAV server.
- **Remote Search:** If you enable the phone-to-desktop remote search feature, the extension and companion app exchange encrypted frames through the relay you configure. The relay is designed to keep only pairing/device metadata needed for routing; query text and result payloads are not intended to be stored there in plaintext.
- **AI websites:** When you use the extension to query AI sites (e.g., ChatGPT, Gemini), your queries are sent directly to those AI providers according to their own privacy policies. We do not relay or store your full queries on our servers except for the limited diagnostic `queryPreview` and `queryHash` described in this policy.
- **Stripe:** If you use in-app payments, payment processing is handled by Stripe. We do not store full payment details. See Stripe's privacy policy for their practices.

---

## 5. User Consent and Control

- **Local data:** Storing history and favorites locally requires no additional consent beyond installing the extension. By using the extension, you consent to this local storage.
- **Clipboard:** Clipboard access is requested only when you use the paste feature. You may decline when the browser prompts you.
- **Cloud sync:** Firebase sync is optional. You must sign in with Google and explicitly enable sync. You can sign out at any time to stop cloud sync, or disable WebDAV sync in the extension options.
- **Diagnostic logs:** Failure / diagnostic logs may be uploaded automatically to help keep the extension reliable. The logs are minimized and do not include API keys, full prompts, full AI responses, or full page contents. Debug builds may provide tools to view, export, clear, and manually synchronize local failure logs.
- **Opt-out:** You can:
  - Clear history and favorites in the extension
  - Clear local failure logs in debug builds or request deletion of uploaded diagnostic logs by contacting us
  - Sign out of Firebase or disable WebDAV sync to stop cloud transmission
  - Uninstall the extension to remove all local data

---

## 6. Permissions Explained

| Permission | Purpose |
|------------|---------|
| `storage` | Save your settings, history, and favorites locally |
| `activeTab`, `tabs` | Open and interact with AI website tabs |
| `clipboardRead` | Paste content from your clipboard when you use the paste feature |
| `identity` | Sign in with Google for optional cloud sync |
| `host_permissions` (`<all_urls>`) | Detect AI sites, inject query input, and read selected text on web pages you visit |
| `contextMenus` | Provide right-click menu options |
| `sidePanel`, `omnibox` | Extension UI and omnibox keyword |
| `alarms` | Schedule background maintenance tasks, including remote reconnect checks and diagnostic log sync retries |

---

## 7. User Rights

You have the right to:

- **Access** your data: View history and favorites in the History and Favorites pages within the extension.
- **Export** your data: (1) When using WebDAV sync, your settings and history are uploaded to your WebDAV server—you can download them from your own server. (2) From the AI compare view, you can export AI responses (the answers shown) to a local file (Markdown, TXT, or HTML).
- **Delete** your data: Clear history and favorites in the extension (single-item delete or clear all), clear local failure logs where the debug page is available, or uninstall the extension to remove all local data.
- **Withdraw consent:** Sign out of Firebase at any time using the sign-out option in the extension; this stops new data from being transmitted. You can also disable WebDAV sync in the settings. *Note: Signing out does not delete data already stored in Firebase.*
- **Request deletion of cloud data:** To request deletion of your data from Firebase or uploaded diagnostic logs, please contact us at AIShortcuts@outlook.com.

---

## 8. Security

- Data stored locally is protected by Chrome's built-in storage security.
- Cloud data (Firebase) is transmitted over HTTPS and stored in Google Cloud with industry-standard security.
- We do not store your WebDAV credentials in plain text where avoidable; follow secure practices for your own server.
- Diagnostic logs are transmitted over HTTPS, minimized before upload, and filtered on the backend with field allow-lists, length limits, and sensitive URL parameter redaction.

---

## 9. Third-Party Services

- **Google (Firebase, OAuth, Firestore):** For optional cloud sync, sign-in, subscription status, API usage records, and diagnostic log storage. [Google Privacy Policy](https://policies.google.com/privacy)
- **VPS backend:** For official API proxying, membership/admin operations, API usage statistics, and diagnostic log collection.
- **Stripe:** For payment processing. [Stripe Privacy Policy](https://stripe.com/privacy)
- **AI websites (ChatGPT, Gemini, etc.):** Your queries are sent to these services when you use them. Each has its own privacy policy.

---

## 10. Children's Privacy

AI Compare does not knowingly collect information from children under 13. If you believe a child has provided us with personal information, please contact us at AIShortcuts@outlook.com.

---

## 11. Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be reflected in the "Last Updated" date at the top. We encourage you to review this policy periodically.

---

## 12. Contact

For questions about this Privacy Policy or your data:

- **Email:** AIShortcuts@outlook.com
