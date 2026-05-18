# Hybrid Site + Agent Compare Plan

Date: 2026-05-16

## Goal

Upgrade the current compare experience so one compare session can contain:

- N external AI site panels
- M internal agent panels powered by a shared LLM API

The core product shape is:

- Homepage `information` tab allows selecting both sites and agents
- Compare page renders sites and agents as peer top-level panels
- Site panels remain external webpage iframes
- Agent panels are internal extension-powered conversation panels

## Locked Product Decisions

### Homepage

- The feature stays under the existing `information` tab.
- No extra top-level mode switcher is added.
- Homepage has two lightweight sections:
  - `AI Sites`
  - `AI Agents`
- Users may select:
  - only sites
  - only agents
  - both
- PK requires at least one selected panel.
- Agent list:
  - grouped by static categories
  - category supports batch selection
  - no search in V1
- Site order and agent order are managed separately.

### Compare Page

- The compare page becomes a unified `panel` system.
- `site panel` and `agent panel` are peer top-level items in the main grid.
- No nested agent tabs container is used.
- Left nav is grouped into:
  - `Sites`
  - `Agents`
- Closing a panel means:
  - remove it from the current compare view
  - it does not receive future global questions
  - reopening it starts a brand new empty conversation
- Reopened panels do not auto-replay prior questions.
- Panels opened mid-session do not backfill historical rounds.

### Input Model

- Global top search box broadcasts to currently enabled panels.
- Agent panels also support local single-panel input.
- Local panel input:
  - only affects that agent thread
  - does not auto-enable the panel for future global broadcasts
  - does not sync with the top input box
- UI does not visibly label messages as global or local.
- Data model keeps hidden source metadata:
  - `global`
  - `local`

### Agent Behavior

- V1 uses a single shared OpenAI-compatible API backend.
- All agents share the same global model configuration.
- Agent output language follows the user input language.
- Agent persona definitions are authored in Chinese first.
- Agent output has a shared structure:
  - conclusion
  - key reasons
  - risks / opposing view
  - action suggestion
- Agent panels show:
  - user / assistant message stream
  - structured answer inside assistant replies
  - collapsible reasoning summary
- Agent attachments are not supported in V1.
- Agent auto-judging / ranking is not part of V1.
- Each agent panel allows only one active request at a time.
- Newer requests interrupt older in-flight requests for the same agent.
- Newer queued requests take priority over stale queued requests.
- Global concurrency limit is shared across all agent requests.

### History

- Every new top-level global submit creates a new compare record.
- No duplicate-merge logic is used for hybrid compare sessions.
- History details reuse `iframe/iframe.html` in read-only mode.
- Read-only history:
  - site panels show saved result snapshots
  - agent panels show full read-only conversation history
  - no live interaction is resumed
- History page list shows summary cards only.
- Full content is shown only in detail mode.
- History detail page keeps the top input bar.
- Submitting from read-only history starts a brand new live compare, not a mutation of the historical record.

### Persistence

- Cloud sync for the new hybrid history path is out of scope.
- Future direction is to remove cloud sync.
- V1 persistent hybrid history should not stay in the existing large `pkHistory` JSON blob model.
- V1 will migrate hybrid compare persistence to IndexedDB.
- `chrome.storage` remains for light config and lightweight indexes.

## Technical Architecture

### New Core Abstraction

Introduce a `panel` abstraction:

```js
{
  panelId: 'site:ChatGPT' | 'agent:buffett',
  panelType: 'site' | 'agent',
  title: 'ChatGPT' | '巴菲特',
  siteName: 'ChatGPT' | null,
  agentId: 'buffett' | null,
  isOpen: true,
  participatesInGlobal: true,
  order: 0
}
```

### Agent Catalog

Add a static catalog file for V1:

- categories
- agents
- persona prompt content
- display metadata

Planned location:

- `config/agentCatalog.js`

### Agent Runtime

- Agent API requests are routed through `background.js`.
- Agent UI panels do not hold API secrets.
- Agent panels connect to background through a long-lived runtime channel.
- Agent runtime emits:
  - status updates
  - stream deltas
  - completion
  - error
  - cancel acknowledgement

### Storage

Planned IndexedDB stores:

- `compare_sessions`
- `panel_snapshots`
- `agent_threads`
- optional `settings_cache` if needed later

### History Detail Mode

Use `iframe.html` for both:

- live compare mode
- read-only history mode

History mode should disable:

- file upload
- live site refresh semantics
- agent request sending

But preserve:

- layout
- nav grouping
- message viewing
- top bar as an entry to start a fresh live compare

## Expected File Areas

Primary files expected to change:

- `homepage/homepage.html`
- `homepage/homepage.css`
- `homepage/homepage.js`
- `iframe/iframe.html`
- `iframe/iframe.css`
- `iframe/iframe.js`
- `history/history.js`
- `background.js`
- `options/options.html`
- `options/options.js`
- `manifest.json`
- `_locales/*/messages.json`
- `README.md`

Primary new files expected:

- `config/agentCatalog.js`
- `shared/agent-prompt-utils.js`
- `shared/hybrid-history-db.js`
- `iframe/agent-panel.html`
- `iframe/agent-panel.css`
- `iframe/agent-panel.js`

## API Config For Development

Development API config provided by user:

- Base URL: `https://api.pptoken.org/v1`
- API key: `sk-70bb623796ad0ab71ea469bc48c835ca64699779d927220aaeba0ba6d4ab6554`

The implementation should store this in extension settings, with the secret held in local storage rather than sync storage.

## Validation Goals

The implementation is not done until these flows work cleanly:

1. Homepage can select sites and agents together.
2. Compare page opens with mixed site and agent panels.
3. Global question reaches all currently enabled panels.
4. Agent panel local input only affects that agent.
5. Closing and reopening a panel creates a fresh empty conversation.
6. Mixed history is persisted and listed.
7. History detail opens in read-only mode.
8. Submitting from read-only history starts a fresh compare.
9. Agent error states are isolated and actionable.
10. UX feels coherent without hidden state surprises.
