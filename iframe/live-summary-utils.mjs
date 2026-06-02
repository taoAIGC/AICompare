export function resolveLiveSummaryAutoAnalysisDueAt({
  existingDueAt = 0,
  hasExistingSummary = false,
  shouldArmAutoAnalysis = true,
  now = Date.now(),
  delayMs = 60000
} = {}) {
  const normalizedExistingDueAt = Math.max(0, Number(existingDueAt) || 0);
  if (!shouldArmAutoAnalysis) {
    return normalizedExistingDueAt;
  }
  if (hasExistingSummary) {
    return 0;
  }

  const normalizedNow = Math.max(0, Number(now) || 0);
  const normalizedDelayMs = Math.max(0, Number(delayMs) || 0);
  return normalizedExistingDueAt || (normalizedNow + normalizedDelayMs);
}
