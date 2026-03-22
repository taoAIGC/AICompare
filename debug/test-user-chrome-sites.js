const fs = require('fs');
const path = require('path');

const DEFAULT_SITES = [
  'Manus',
  'Vidu',
  'Wan',
  'Suno',
  'ElevenLabs',
  'DeepL',
  'Lovable',
  'Google Translate',
  'Bing Translate'
];

const DEFAULT_TEST_QUERY = process.env.TEST_QUERY || '你好世界';
const TRANSLATION_EXPECTED_REGEX = /hello(?:,\s*|\s+)world/i;

function loadConfig() {
  const configPath = path.join(__dirname, '..', 'config', 'siteHandlers.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function parseSiteNames(raw) {
  if (!raw) return DEFAULT_SITES;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function createClient(wsEndpoint) {
  const ws = new WebSocket(wsEndpoint);
  let id = 0;
  const pending = new Map();
  const listeners = new Set();

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    for (const listener of listeners) listener(msg);
  });

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', (event) => reject(event.error || new Error('WebSocket error')), { once: true });
  });

  return {
    ws,
    opened,
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, { resolve, reject });
        const payload = { id: msgId, method, params };
        if (sessionId) payload.sessionId = sessionId;
        ws.send(JSON.stringify(payload));
      });
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLoad(client, sessionId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off();
      resolve();
    }, timeoutMs);
    const off = client.onEvent((msg) => {
      if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true
  }, sessionId);
  return result.result ? result.result.value : undefined;
}

async function getSelectorInfo(client, sessionId, selector) {
  return evaluate(client, sessionId, `(() => {
    const selector = ${JSON.stringify(selector)};
    const nodes = Array.from(document.querySelectorAll(selector));
    const visible = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      return r.width > 6 && r.height > 6;
    };
    const first = nodes[0];
    return {
      matched: nodes.length > 0,
      count: nodes.length,
      visibleCount: nodes.filter(visible).length,
      firstTag: first ? first.tagName.toLowerCase() : '',
      firstText: first ? (first.innerText || first.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120) : '',
      firstPlaceholder: first && first.getAttribute ? (first.getAttribute('placeholder') || '') : '',
      firstAriaLabel: first && first.getAttribute ? (first.getAttribute('aria-label') || '') : '',
      firstAriaLabelledby: first && first.getAttribute ? (first.getAttribute('aria-labelledby') || '') : ''
    };
  })()`);
}

async function waitForSelectorInfo(client, sessionId, selector, timeoutMs, requireVisible = false) {
  const deadline = Date.now() + timeoutMs;
  let lastInfo = await getSelectorInfo(client, sessionId, selector);

  while (Date.now() < deadline) {
    if (lastInfo.matched && (!requireVisible || lastInfo.visibleCount > 0)) {
      return lastInfo;
    }
    await sleep(Number(process.env.SELECTOR_POLL_MS || 500));
    lastInfo = await getSelectorInfo(client, sessionId, selector);
  }

  return lastInfo;
}

async function clickSelector(client, sessionId, selector) {
  return evaluate(client, sessionId, `(() => {
    const selector = ${JSON.stringify(selector)};
    const nodes = Array.from(document.querySelectorAll(selector));
    const visible = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      return r.width > 6 && r.height > 6;
    };
    const target = nodes.find(visible) || nodes[0] || null;
    if (!target) {
      return { clicked: false, reason: 'not-found' };
    }
    target.click();
    return {
      clicked: true,
      targetText: (target.innerText || target.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120),
      targetTag: target.tagName.toLowerCase()
    };
  })()`);
}

function getSiteType(site) {
  return String(site.type || site.category || '').toLowerCase();
}

async function executeStep(client, sessionId, step, query) {
  if (step.action === 'wait') {
    await sleep(Number(step.duration || 0));
    return {
      action: step.action,
      selector: '',
      ok: true,
      duration: Number(step.duration || 0),
      description: step.description || '',
      note: 'wait-step'
    };
  }

  if (!step.selector) {
    return {
      action: step.action,
      selector: '',
      ok: true,
      description: step.description || '',
      note: 'no-selector'
    };
  }

  return evaluate(client, sessionId, `(() => {
    const step = ${JSON.stringify(step)};
    const query = ${JSON.stringify(query)};
    const element = document.querySelector(step.selector);

    const snapshot = (el) => ({
      tag: el ? el.tagName.toLowerCase() : '',
      textContent: el ? (el.textContent || '') : '',
      innerText: el ? (el.innerText || '') : '',
      value: el && 'value' in el ? (el.value ?? null) : null,
      isContentEditable: Boolean(el && el.isContentEditable),
      innerHTML: el ? (el.innerHTML || '') : ''
    });

    if (!element) {
      return {
        action: step.action,
        selector: step.selector,
        ok: false,
        reason: 'element-not-found',
        description: step.description || ''
      };
    }

    if (step.action === 'focus') {
      element.focus();
      return {
        action: step.action,
        selector: step.selector,
        ok: true,
        description: step.description || '',
        active: document.activeElement === element,
        ...snapshot(element)
      };
    }

    if (step.action === 'click') {
      element.click();
      return {
        action: step.action,
        selector: step.selector,
        ok: true,
        description: step.description || '',
        ...snapshot(element)
      };
    }

    if (step.action === 'setValue') {
      if (
        step.inputType === 'special' &&
        step.specialConfig &&
        step.specialConfig.type === 'custom-element' &&
        step.specialConfig.method === 'textContent'
      ) {
        element.textContent = query;
      } else if (element.isContentEditable) {
        element.textContent = query;
      } else if ('value' in element) {
        element.value = query;
      } else {
        element.textContent = query;
      }

      return {
        action: step.action,
        selector: step.selector,
        ok: true,
        description: step.description || '',
        inputType: step.inputType || '',
        ...snapshot(element)
      };
    }

    if (step.action === 'triggerEvents') {
      const events = Array.isArray(step.events) ? step.events : [];
      for (const eventName of events) {
        if (eventName === 'input') {
          if (element.isContentEditable || step.inputType === 'special') {
            element.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: query
            }));
          } else {
            element.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } else {
          element.dispatchEvent(new Event(eventName, { bubbles: true }));
        }
      }

      return {
        action: step.action,
        selector: step.selector,
        ok: true,
        description: step.description || '',
        events,
        ...snapshot(element)
      };
    }

    return {
      action: step.action,
      selector: step.selector,
      ok: false,
      reason: 'unsupported-action',
      description: step.description || ''
    };
  })()`);
}

async function getContentSelectorSnapshots(client, sessionId, selectors) {
  return evaluate(client, sessionId, `(() => {
    const selectors = ${JSON.stringify(selectors)};
    const pickText = (el) => {
      if (!el) return '';
      if (typeof el.innerText === 'string' && el.innerText.trim()) return el.innerText.trim();
      if (typeof el.textContent === 'string' && el.textContent.trim()) return el.textContent.trim();
      if ('value' in el && typeof el.value === 'string' && el.value.trim()) return el.value.trim();
      return '';
    };

    return selectors.map((selector) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      const target = nodes.length > 1 ? nodes[nodes.length - 1] : (nodes[0] || null);
      return {
        selector,
        matched: nodes.length > 0,
        count: nodes.length,
        text: pickText(target),
        innerText: target ? (target.innerText || '') : '',
        textContent: target ? (target.textContent || '') : '',
        value: target && 'value' in target ? (target.value ?? null) : null,
        innerHTML: target ? (target.innerHTML || '') : ''
      };
    });
  })()`);
}

function normalizeContentText(snapshot) {
  if (!snapshot) return '';
  if (typeof snapshot.text === 'string' && snapshot.text.trim()) return snapshot.text.trim();
  if (typeof snapshot.innerText === 'string' && snapshot.innerText.trim()) return snapshot.innerText.trim();
  if (typeof snapshot.textContent === 'string' && snapshot.textContent.trim()) return snapshot.textContent.trim();
  if (typeof snapshot.value === 'string' && snapshot.value.trim()) return snapshot.value.trim();
  return '';
}

function isPlaceholderTranslationOutput(text) {
  const normalized = String(text || '').replace(/\s+/g, '');
  return !normalized || normalized === '...' || normalized === '…';
}

async function validateTranslationFlow(client, sessionId, site) {
  const query = process.env.TRANSLATION_QUERY || DEFAULT_TEST_QUERY;
  const stepExecutions = [];
  const steps = site.searchHandler?.steps || [];

  for (const step of steps) {
    const result = await executeStep(client, sessionId, step, query);
    stepExecutions.push(result);

    if (step.action === 'click') {
      await waitForLoad(client, sessionId, Number(process.env.ACTION_TIMEOUT_MS || 20000));
      await sleep(Number(process.env.POST_LOAD_WAIT_MS || 600));
    } else if (step.action !== 'wait') {
      await sleep(Number(process.env.STEP_SETTLE_MS || 300));
    }
  }

  const selectors = site.contentExtractor?.contentSelectors || [];
  const timeoutMs = Number(process.env.TRANSLATION_TIMEOUT_MS || 20000);
  const pollMs = Number(process.env.TRANSLATION_POLL_MS || 1000);
  const deadline = Date.now() + timeoutMs;
  let selectorSnapshots = [];
  let finalOutput = '';

  while (Date.now() < deadline) {
    selectorSnapshots = await getContentSelectorSnapshots(client, sessionId, selectors);
    finalOutput = selectorSnapshots.map(normalizeContentText).find(Boolean) || '';
    if (!isPlaceholderTranslationOutput(finalOutput)) {
      break;
    }
    await sleep(pollMs);
  }

  const success =
    !isPlaceholderTranslationOutput(finalOutput) &&
    finalOutput !== query &&
    TRANSLATION_EXPECTED_REGEX.test(finalOutput);

  let reason = '';
  if (!finalOutput) {
    reason = 'no-output';
  } else if (isPlaceholderTranslationOutput(finalOutput)) {
    reason = 'placeholder-output';
  } else if (finalOutput === query) {
    reason = 'output-same-as-input';
  } else if (!TRANSLATION_EXPECTED_REGEX.test(finalOutput)) {
    reason = 'output-did-not-match-expected-translation';
  } else {
    reason = 'validated';
  }

  return {
    mode: 'translation',
    query,
    expectedPattern: String(TRANSLATION_EXPECTED_REGEX),
    stepExecutions,
    selectorSnapshots,
    finalOutput,
    success,
    reason
  };
}

async function inspectSite(client, site) {
  const { targetId } = await client.send('Target.createTarget', { url: site.url });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });

  try {
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await waitForLoad(client, sessionId);

    const initialPageMeta = await evaluate(client, sessionId, `(() => ({
      title: document.title,
      url: location.href
    }))()`);
    await sleep(Number(process.env.POST_LOAD_WAIT_MS || 600));

    const steps = (site.searchHandler?.steps || []).map((step) => ({
      action: step.action,
      selector: step.selector || '',
      inputType: step.inputType || '',
      keys: step.keys || '',
      duration: step.duration || 0,
      description: step.description || ''
    }));
    const contentSelectors = (site.contentExtractor?.contentSelectors || []).map((selector) => ({
      action: 'extractContent',
      selector,
      inputType: '',
      keys: '',
      duration: 0,
      description: 'contentExtractor selector'
    }));

    const selectorChecks = [];
    for (const step of steps) {
      if (step.action === 'wait') {
        await sleep(step.duration);
        selectorChecks.push({
          action: step.action,
          selector: '',
          matched: true,
          visible: true,
          duration: step.duration,
          description: step.description,
          note: 'wait-step'
        });
        continue;
      }

      if (!step.selector) {
        selectorChecks.push({
          action: step.action,
          selector: '',
          matched: true,
          visible: true,
          description: step.description,
          note: 'no-selector'
        });
        continue;
      }

      const info = await waitForSelectorInfo(
        client,
        sessionId,
        step.selector,
        Number(process.env.SELECTOR_TIMEOUT_MS || 15000),
        true
      );
      const stepResult = {
        action: step.action,
        selector: step.selector,
        description: step.description,
        ...info
      };

      if (step.action === 'click' && info.matched) {
        const clickInfo = await clickSelector(client, sessionId, step.selector);
        stepResult.executed = Boolean(clickInfo && clickInfo.clicked);
        stepResult.clickedTag = clickInfo && clickInfo.targetTag ? clickInfo.targetTag : '';
        stepResult.clickedText = clickInfo && clickInfo.targetText ? clickInfo.targetText : '';
        if (stepResult.executed) {
          await waitForLoad(client, sessionId, Number(process.env.ACTION_TIMEOUT_MS || 20000));
          await sleep(Number(process.env.POST_LOAD_WAIT_MS || 600));
        } else if (clickInfo && clickInfo.reason) {
          stepResult.note = clickInfo.reason;
        }
      }

      selectorChecks.push(stepResult);
    }

    for (const step of contentSelectors) {
      if (!step.selector) {
        selectorChecks.push({
          action: step.action,
          selector: '',
          matched: true,
          visible: true,
          description: step.description,
          note: 'no-selector'
        });
        continue;
      }

      const info = await waitForSelectorInfo(
        client,
        sessionId,
        step.selector,
        Number(process.env.SELECTOR_TIMEOUT_MS || 5000),
        false
      );
      selectorChecks.push({
        action: step.action,
        selector: step.selector,
        description: step.description,
        ...info
      });
    }

    const finalPageMeta = await evaluate(client, sessionId, `(() => ({
      title: document.title,
      url: location.href
    }))()`);

    let translationValidation = null;
    if (getSiteType(site) === 'translation') {
      translationValidation = await validateTranslationFlow(client, sessionId, site);
    }

    return {
      site: site.name,
      targetUrl: site.url,
      initialTitle: initialPageMeta.title,
      initialUrl: initialPageMeta.url,
      ...finalPageMeta,
      selectorChecks,
      translationValidation
    };
  } finally {
    await client.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

async function run() {
  const siteNames = parseSiteNames(process.env.SITE_NAMES);
  const config = loadConfig();
  const sites = siteNames
    .map((name) => config.sites.find((site) => site.name === name))
    .filter(Boolean);

  const lines = fs.readFileSync(
    path.join(process.env.HOME, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
    'utf8'
  ).trim().split('\n');
  const wsEndpoint = 'ws://127.0.0.1:' + lines[0] + lines[1];
  const client = createClient(wsEndpoint);
  await client.opened;

  const results = [];
  for (const site of sites) {
    const result = await inspectSite(client, site);
    results.push(result);
    console.log(`\n=== ${site.name} ===`);
    console.log(JSON.stringify(result, null, 2));
  }

  const outDir = path.join(__dirname, 'output', 'user-chrome-tests');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `results-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved results to ${outPath}`);

  client.ws.close();
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
