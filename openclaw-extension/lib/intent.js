import {
  ALT_TOOL_RULES,
  LOCAL_TASK_GUARD_RULES,
  RESPONSE_DIRECTIVE_RULES,
  SEARCH_PREFIX_RULES,
  SOFT_SEARCH_PREFIX_RULES,
  SITE_ALIAS_RULES
} from "../config/route-rules.js";

function compileRule(pattern, flags = "i") {
  return new RegExp(pattern, flags);
}

const SITE_ALIASES = SITE_ALIAS_RULES.map((site) => ({
  name: site.name,
  patterns: Array.isArray(site.patterns) ? site.patterns.map((pattern) => compileRule(pattern)) : []
}));

const SEARCH_PREFIX_PATTERNS = SEARCH_PREFIX_RULES.map((pattern) => compileRule(pattern));
const SOFT_SEARCH_PREFIX_PATTERNS = SOFT_SEARCH_PREFIX_RULES.map((pattern) => compileRule(pattern));
const ALT_TOOL_PATTERNS = ALT_TOOL_RULES.map((pattern) => compileRule(pattern));
const RESPONSE_DIRECTIVE_PATTERNS = RESPONSE_DIRECTIVE_RULES.map((pattern) => compileRule(pattern));
const LOCAL_TASK_GUARD_PATTERNS = LOCAL_TASK_GUARD_RULES.map((pattern) => compileRule(pattern));

function normalizeWhitespace(input) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function buildIntentCandidates(input) {
  const raw = String(input || "");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== "```json" && line !== "```");

  const lastLine = lines.length > 0 ? lines[lines.length - 1] : "";
  const deTimestamped = lastLine.replace(/^\[[^\]]+\]\s*/, "").trim();
  const fullNormalized = normalizeWhitespace(raw);
  const candidates = [deTimestamped, lastLine, fullNormalized].filter(Boolean);
  return Array.from(new Set(candidates));
}

function stripOuterQuotes(input) {
  return input.replace(/^["'“”‘’「『]+/, "").replace(/["'“”‘’」』]+$/, "").trim();
}

function removeTrailingDirectives(input) {
  let result = input;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of RESPONSE_DIRECTIVE_PATTERNS) {
      const next = result.replace(pattern, "").trim();
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
  }
  return result.replace(/[，,。.;；:\s]+$/, "").trim();
}

function looksLikeLocalTaskQuery(query) {
  return LOCAL_TASK_GUARD_PATTERNS.some((pattern) => pattern.test(query));
}

function matchIntentWithPatterns(normalized, patterns, options = {}) {
  for (const pattern of patterns) {
    const matched = normalized.match(pattern);
    if (!matched) continue;

    const remainder = normalized.slice(matched[0].length).trim();
    const query = stripOuterQuotes(removeTrailingDirectives(remainder));
    if (!query) continue;
    if (options.guardLocalTasks && looksLikeLocalTaskQuery(query)) {
      continue;
    }

    return {
      query,
      noSummary: RESPONSE_DIRECTIVE_PATTERNS.some((directive) => directive.test(normalized)),
      original: normalized,
      matchType: options.matchType || "search"
    };
  }

  return null;
}

function extractSearchIntent(text) {
  const candidates = buildIntentCandidates(text);
  if (candidates.length === 0) return null;

  for (const normalized of candidates) {
    if (!normalized) continue;
    if (ALT_TOOL_PATTERNS.some((pattern) => pattern.test(normalized))) continue;

    const hardMatch = matchIntentWithPatterns(normalized, SEARCH_PREFIX_PATTERNS, {
      matchType: "explicit_search"
    });
    if (hardMatch) return hardMatch;

    const softMatch = matchIntentWithPatterns(normalized, SOFT_SEARCH_PREFIX_PATTERNS, {
      matchType: "soft_search",
      guardLocalTasks: true
    });
    if (softMatch) return softMatch;
  }

  return null;
}

export function extractSearchIntentFromEvent(event) {
  const inputs = [event?.body, event?.content]
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean);

  for (const input of inputs) {
    const intent = extractSearchIntent(input);
    if (intent) {
      return {
        ...intent,
        matchedFrom: input
      };
    }
  }

  return null;
}

export function detectSites(text) {
  const hits = [];
  for (const site of SITE_ALIASES) {
    if (site.patterns.some((pattern) => pattern.test(text))) {
      hits.push(site.name);
    }
  }
  return Array.from(new Set(hits));
}
