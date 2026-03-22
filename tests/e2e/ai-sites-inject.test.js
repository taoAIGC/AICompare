// @ts-check
const { test, expect } = require('../setup');
const {
  getDirectSiteSmokeTargets,
  getUserPromptConfig,
  waitForVisible,
  injectMockUserPrompt,
  readVisiblePromptText,
  collectPromptButtonDiagnostics,
  clickVisibleElement,
  getVisibleElementAttribute,
  sanitizePathSegment
} = require('../utils/test-utils');

const directSites = getDirectSiteSmokeTargets();

async function attachJson(testInfo, name, data) {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(data, null, 2)),
    contentType: 'application/json'
  });
}

async function captureDiagnosticsScreenshot(page, testInfo, siteName) {
  const fileName = `${sanitizePathSegment(siteName)}-direct-userprompt.png`;
  const screenshotPath = testInfo.outputPath(fileName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(`screenshot-${siteName}`, {
    path: screenshotPath,
    contentType: 'image/png'
  });
  return screenshotPath;
}

async function countPromptContainers(page, config) {
  if (!config?.containerSelector) {
    return 0;
  }

  try {
    return await page.locator(config.containerSelector).count();
  } catch {
    return 0;
  }
}

async function openComparePage(context, page, selector) {
  const popupPromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  const clicked = await clickVisibleElement(page, selector);
  const popup = await popupPromise;
  return { clicked, popup };
}

test.describe('AI direct-site user prompt buttons', () => {
  test.describe.configure({ mode: 'serial' });

  for (const site of directSites) {
    test(`${site.name} shows compare and favorite buttons beside user prompt`, async ({
      context,
      page,
      extensionId,
      serviceWorkerUrl
    }, testInfo) => {
      const config = getUserPromptConfig(site);
      expect(config, `Missing userPrompt config for ${site.name}`).toBeTruthy();

      const diagnostics = {
        site: site.name,
        targetUrl: site.url,
        extensionId,
        serviceWorkerUrl,
        containerSelector: config?.containerSelector || '',
        textSelector: config?.textSelector || '',
        promptContainersBefore: 0,
        existingPromptText: '',
        injectedWorkflowPrompt: false,
        injectReason: '',
        workflowPromptText: `Playwright direct-site prompt ${site.name} ${Date.now()}`,
        compareClicked: false,
        compareOpened: false,
        compareUrl: '',
        compareQuery: '',
        favoriteStateBefore: null,
        favoriteClicked: false,
        favoriteModalOpened: false,
        favoriteStateAfter: null,
        favoriteStateChanged: false,
        screenshot: ''
      };

      try {
        await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForTimeout(7000);

        diagnostics.promptContainersBefore = await countPromptContainers(page, config);
        diagnostics.existingPromptText = await readVisiblePromptText(page, config);

        const injected = await injectMockUserPrompt(page, site, config, diagnostics.workflowPromptText);
        diagnostics.injectedWorkflowPrompt = !!injected?.injected;
        diagnostics.injectReason = injected?.reason || '';

        expect(diagnostics.injectedWorkflowPrompt, 'Failed to inject workflow prompt').toBe(true);

        await page.waitForTimeout(2500);

        const compareLocator = page.locator('.ai-compare-userprompt-btn');
        const favoriteLocator = page.locator('.ai-compare-userprompt-fav-btn');

        const compareVisible = await waitForVisible(compareLocator, 20000);
        const favoriteVisible = await waitForVisible(favoriteLocator, 20000);

        expect(compareVisible, 'Compare button did not become visible').toBe(true);
        expect(favoriteVisible, 'Favorite button did not become visible').toBe(true);

        const buttonDiagnostics = await collectPromptButtonDiagnostics(page);
        Object.assign(diagnostics, buttonDiagnostics);

        expect(buttonDiagnostics.compareButtonCount).toBeGreaterThan(0);
        expect(buttonDiagnostics.favoriteButtonCount).toBeGreaterThan(0);
        expect(buttonDiagnostics.compareVisibleCount).toBeGreaterThan(0);
        expect(buttonDiagnostics.favoriteVisibleCount).toBeGreaterThan(0);
        expect(buttonDiagnostics.detectedButtonExtensionId).toBe(extensionId);

        const compareResult = await openComparePage(context, page, '.ai-compare-userprompt-btn');
        diagnostics.compareClicked = compareResult.clicked;
        expect(diagnostics.compareClicked, 'Compare button was not clicked').toBe(true);

        const comparePage = compareResult.popup;
        expect(comparePage, 'Compare button did not open a new extension page').toBeTruthy();

        try {
          await comparePage.waitForLoadState('domcontentloaded', { timeout: 10000 });
        } catch {}

        diagnostics.compareOpened = true;
        diagnostics.compareUrl = comparePage.url();

        const compareUrl = new URL(diagnostics.compareUrl);
        diagnostics.compareQuery = compareUrl.searchParams.get('query') || '';

        expect(diagnostics.compareUrl.startsWith(`chrome-extension://${extensionId}/iframe/iframe.html`)).toBe(true);
        expect(diagnostics.compareQuery).toBe(diagnostics.workflowPromptText);

        await comparePage.close().catch(() => {});

        diagnostics.favoriteStateBefore = await getVisibleElementAttribute(
          page,
          '.ai-compare-userprompt-fav-btn',
          'data-favorited'
        );

        expect(diagnostics.favoriteStateBefore).toBe('0');

        diagnostics.favoriteClicked = await clickVisibleElement(page, '.ai-compare-userprompt-fav-btn');
        expect(diagnostics.favoriteClicked, 'Favorite button was not clicked').toBe(true);

        const favoriteModal = page.locator('.ai-fav-modal-overlay');
        diagnostics.favoriteModalOpened = await waitForVisible(favoriteModal, 10000);
        expect(diagnostics.favoriteModalOpened, 'Favorite modal did not open').toBe(true);

        const saveButton = page.locator('.ai-fav-modal-save-btn');
        await expect(saveButton.first()).toBeVisible();
        await saveButton.first().click();

        await page.waitForFunction(() => {
          const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              return false;
            }
            const rect = element.getBoundingClientRect();
            return rect.width > 2 && rect.height > 2;
          };

          const buttons = Array.from(document.querySelectorAll('.ai-compare-userprompt-fav-btn')).filter(isVisible);
          const target = buttons[buttons.length - 1];
          return !!target && target.getAttribute('data-favorited') === '1';
        }, { timeout: 10000 });

        diagnostics.favoriteStateAfter = await getVisibleElementAttribute(
          page,
          '.ai-compare-userprompt-fav-btn',
          'data-favorited'
        );
        diagnostics.favoriteStateChanged = diagnostics.favoriteStateBefore !== diagnostics.favoriteStateAfter;

        expect(diagnostics.favoriteStateAfter).toBe('1');
        expect(diagnostics.favoriteStateChanged).toBe(true);
      } catch (error) {
        diagnostics.error = String(error && error.stack ? error.stack : error);
        throw error;
      } finally {
        diagnostics.screenshot = await captureDiagnosticsScreenshot(page, testInfo, site.name).catch(() => '');
        await attachJson(testInfo, `${sanitizePathSegment(site.name)}-diagnostics.json`, diagnostics);
      }
    });
  }
});
