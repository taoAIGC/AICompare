# Hermes And OpenClaw Plugin Compatibility

OpenClaw and Hermes Agent do not share the same plugin runtime.

## Why a direct copy does not work

- OpenClaw plugin format:
  - `openclaw.plugin.json`
  - JavaScript entry such as `index.js`
  - runtime hooks like `before_dispatch`
- Hermes plugin format:
  - `plugin.yaml`
  - Python `register(ctx)` entry
  - tool registration and observer-style hooks

So an OpenClaw plugin cannot be used by Hermes unchanged.

## Recommended compatibility pattern

Use a shared core plus two thin host adapters.

- Shared core:
  - runner scripts
  - query normalization
  - result formatting rules
  - site/runtime configuration
- OpenClaw adapter:
  - keeps host-specific hard-routing hooks such as `before_dispatch`
- Hermes adapter:
  - exposes the capability as a tool
  - optionally adds a `pre_llm_call` hint so the model knows when to call that tool

## AI Compare example in this repo

The shared execution core stays in:

- [openclaw/ai-compare-openclaw-fast.js](/Users/hasee/Documents/同步文稿/multi-AI/AIShortcuts/openclaw/ai-compare-openclaw-fast.js)
- [openclaw/ai-compare-openclaw-runner.js](/Users/hasee/Documents/同步文稿/multi-AI/AIShortcuts/openclaw/ai-compare-openclaw-runner.js)

The Hermes adapter lives in:

- [plugin.yaml](/Users/hasee/Documents/同步文稿/multi-AI/AIShortcuts/.hermes/plugins/ai-compare-hard-router/plugin.yaml)
- [__init__.py](/Users/hasee/Documents/同步文稿/multi-AI/AIShortcuts/.hermes/plugins/ai-compare-hard-router/__init__.py)
- [schemas.py](/Users/hasee/Documents/同步文稿/multi-AI/AIShortcuts/.hermes/plugins/ai-compare-hard-router/schemas.py)
- [tools.py](/Users/hasee/Documents/同步文稿/multi-AI/AIShortcuts/.hermes/plugins/ai-compare-hard-router/tools.py)

## Practical rule

If an OpenClaw plugin mainly does one of these:

- wraps an external runner
- formats structured output
- injects a small amount of routing logic

then port it to Hermes as:

- one or more Hermes tools
- plus optional `pre_llm_call` hints

If an OpenClaw plugin depends on host-only interception semantics like `handled: true` from `before_dispatch`, keep that behavior in the OpenClaw adapter and do not try to force a 1:1 port into Hermes.
