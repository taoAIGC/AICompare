const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function loadSites() {
  const configPath = path.join(__dirname, '..', 'config', 'siteHandlers.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf8')).sites || [];
}

function getSite(name) {
  const site = loadSites().find((item) => item?.name === name);
  assert.ok(site, `missing site config: ${name}`);
  return site;
}

function selectorList(step) {
  if (Array.isArray(step?.selector)) return step.selector;
  return step?.selector ? [step.selector] : [];
}

test('Claude, DeepSeek, and Grok use resilient input selector families', () => {
  for (const siteName of ['Claude', 'DeepSeek', 'Grok']) {
    const site = getSite(siteName);
    const inputSteps = (site.searchHandler?.steps || []).filter((step) => (
      ['focus', 'setValue', 'triggerEvents', 'sendKeys'].includes(step.action)
    ));
    assert.ok(inputSteps.length >= 3, `${siteName} should have input-related steps`);

    const firstSelectors = selectorList(inputSteps[0]);
    assert.ok(firstSelectors.length >= 3, `${siteName} should not depend on a single fragile input selector`);
    assert.ok(
      firstSelectors.some((selector) => /\[role="textbox"\]|\[contenteditable="true"\]|textarea/.test(selector)),
      `${siteName} should include structural editor fallbacks`
    );

    for (const step of inputSteps.slice(1)) {
      assert.deepEqual(
        selectorList(step),
        firstSelectors,
        `${siteName} ${step.action} should use the same input selector family as focus`
      );
      assert.ok(Number(step.maxAttempts) >= 20, `${siteName} ${step.action} should allow slow editor hydration`);
      assert.ok(Number(step.retryInterval) >= 500, `${siteName} ${step.action} should avoid too-fast retry exhaustion`);
    }
  }
});

test('Claude send button has stable non-copy fallback selectors and retry-on-disabled', () => {
  const claude = getSite('Claude');
  const clickStep = (claude.searchHandler?.steps || []).find((step) => step.action === 'click');
  const selectors = selectorList(clickStep);

  assert.equal(clickStep.retryOnDisabled, true);
  assert.equal(clickStep.waitForElement, true);
  assert.ok(Number(clickStep.maxAttempts) >= 20);
  assert.ok(selectors.some((selector) => selector.includes('button[type="submit"]')));
  assert.ok(selectors.some((selector) => selector.includes('data-testid="send-message-button"')));
  assert.ok(selectors.some((selector) => selector.includes('aria-label*="Send"')));
});
