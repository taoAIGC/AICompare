const test = require('node:test');
const assert = require('node:assert/strict');

(async () => {
  const {
    resolveLiveSummaryAutoAnalysisDueAt
  } = await import('../iframe/live-summary-utils.mjs');

  test('resolveLiveSummaryAutoAnalysisDueAt preserves existing countdown during deferred refresh', () => {
    const existingDueAt = 1_000_000;
    const resolved = resolveLiveSummaryAutoAnalysisDueAt({
      existingDueAt,
      hasExistingSummary: false,
      shouldArmAutoAnalysis: false,
      now: 950_000,
      delayMs: 60_000
    });

    assert.equal(resolved, existingDueAt);
  });

  test('resolveLiveSummaryAutoAnalysisDueAt reuses existing dueAt when auto analysis remains armed', () => {
    const existingDueAt = 1_000_000;
    const resolved = resolveLiveSummaryAutoAnalysisDueAt({
      existingDueAt,
      hasExistingSummary: false,
      shouldArmAutoAnalysis: true,
      now: 950_000,
      delayMs: 60_000
    });

    assert.equal(resolved, existingDueAt);
  });

  test('resolveLiveSummaryAutoAnalysisDueAt starts a fresh countdown when no dueAt exists', () => {
    const resolved = resolveLiveSummaryAutoAnalysisDueAt({
      existingDueAt: 0,
      hasExistingSummary: false,
      shouldArmAutoAnalysis: true,
      now: 950_000,
      delayMs: 60_000
    });

    assert.equal(resolved, 1_010_000);
  });

  test('resolveLiveSummaryAutoAnalysisDueAt clears countdown once a summary already exists', () => {
    const resolved = resolveLiveSummaryAutoAnalysisDueAt({
      existingDueAt: 1_000_000,
      hasExistingSummary: true,
      shouldArmAutoAnalysis: true,
      now: 950_000,
      delayMs: 60_000
    });

    assert.equal(resolved, 0);
  });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
