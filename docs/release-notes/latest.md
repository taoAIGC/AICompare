# Latest User-Facing Improvements

- Admin usage analytics now merge API usage and site comparison usage into one 7-day view with shared trend, top target, and recent event tables.
- Admin analytics now include site comparison usage, showing active signed-in/anonymous devices and the most-used sites without storing full prompts or AI responses.
- Added a static SEO/GEO website package with a GEO method hub, self-check checklist, content QA and brand monitoring use-case pages, tutorial articles, sitemap, robots, llms.txt, and Chrome Web Store copy guidance.
- Added a hidden admin-only Stripe live smoke checkout entry so production payments can be verified with a private small-amount price without changing public monthly or yearly plans.
- Admin Failure Logs now show richer diagnostic context, including query preview, sanitized URLs, extension version, and safe metadata for faster troubleshooting.
- Admin API usage statistics now include official API token totals and estimated cost when upstream usage data is available.
- Local failure logs now support automatic VPS synchronization and an admin Failure Logs page for real site/API failure analysis.
- Added a local debug failure-log page for site execution and API request failures, with filters, summary cards, export, clear, and retention cleanup.
- Official API 402 balance errors now explain that the official API balance is insufficient and provide a clickable path to the custom API settings page.
