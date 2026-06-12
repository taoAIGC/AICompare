#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  classifyExternalStatus,
  createUnifiedResult,
  printResultAndExit,
  trimPreview
} = require('./live-verifier-common');

const SITE_NAME = 'Perplexity';
const TEST_QUERY = process.env.TEST_QUERY || '你好世界';
const WAIT_AFTER_LOAD_MS = Number(process.env.WAIT_AFTER_LOAD_MS || 35000);
const WAIT_AFTER_UPLOAD_PROBE_MS = Number(process.env.WAIT_AFTER_UPLOAD_PROBE_MS || 1800);
const PROBE_UPLOAD = process.env.PROBE_UPLOAD === '1';
const PROBE_UPLOAD_SUBMIT = process.env.PROBE_UPLOAD_SUBMIT === '1';
const DEVTOOLS_ACTIVE_PORT =
  process.env.DEVTOOLS_ACTIVE_PORT ||
  path.join(process.env.HOME || '', 'Library/Application Support/Google/Chrome/DevToolsActivePort');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readChromeEndpoint() {
  const raw = fs.readFileSync(DEVTOOLS_ACTIVE_PORT, 'utf8').trim().split('\n');
  const port = raw[0];
  const browserPath = raw[1];
  if (!port || !browserPath) {
    throw new Error(`DevToolsActivePort is invalid: ${DEVTOOLS_ACTIVE_PORT}`);
  }
  return `ws://127.0.0.1:${port}${browserPath}`;
}

class CDPClient {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.endpoint);
      this.ws = ws;

      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', (error) => reject(error));
      ws.addEventListener('message', (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.id && this.pending.has(msg.id)) {
          const pending = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(JSON.stringify(msg.error)));
          } else {
            pending.resolve(msg.result);
          }
        }
      });
      ws.addEventListener('close', () => {
        for (const pending of this.pending.values()) {
          pending.reject(new Error('CDP connection closed'));
        }
        this.pending.clear();
      });
    });
  }

  send(method, params = {}, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }

  async close() {
    if (!this.ws) return;
    await new Promise((resolve) => {
      this.ws.addEventListener('close', () => resolve(), { once: true });
      this.ws.close();
    }).catch(() => {});
  }
}

function getSiteConfig() {
  const configPath = path.join(__dirname, '..', 'config', 'siteHandlers.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const site = (config.sites || []).find((item) => item && item.name === SITE_NAME);
  if (!site) {
    throw new Error(`Site config not found: ${SITE_NAME}`);
  }
  return site;
}

function resolveTargetUrl(site) {
  const configuredUrl = process.env.PERPLEXITY_URL || site.url;
  return configuredUrl.replace('{query}', encodeURIComponent(TEST_QUERY));
}

async function createPage(client, url) {
  const { targetId } = await client.send('Target.createTarget', { url });
  await sleep(1200);
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  await client.send('Page.enable', {}, sessionId);
  await client.send('Runtime.enable', {}, sessionId);
  return { targetId, sessionId };
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise: true
    },
    sessionId
  );
  return result?.result?.value;
}

async function waitForReady(client, sessionId, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ready = await evaluate(
      client,
      sessionId,
      'document.readyState === "interactive" || document.readyState === "complete"'
    );
    if (ready) return;
    await sleep(300);
  }
  throw new Error('Timed out waiting for page ready state');
}

async function snapshot(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const queryAll = (selector) => Array.from(document.querySelectorAll(selector));
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const summarize = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          id: el.id || null,
          role: el.getAttribute('role'),
          type: el.getAttribute('type'),
          placeholder: el.getAttribute('placeholder'),
          ariaLabel: el.getAttribute('aria-label'),
          href: el.getAttribute('href'),
          className: String(el.className || '').slice(0, 280),
          text: text(el).slice(0, 260),
          disabled: !!el.disabled,
          contenteditable: el.getAttribute('contenteditable'),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      };

      return {
        url: location.href,
        path: location.pathname,
        title: document.title,
        bodyText: text(document.body).slice(0, 3200),
        main: summarize(document.querySelector('main')),
        tablist: summarize(document.querySelector('[role="tablist"]')),
        loginDialog: summarize(document.querySelector('[role="dialog"]')),
        followUpBox: summarize(document.querySelector('#ask-input')),
        addFilesButton: summarize(document.querySelector('button[aria-label="Add files or tools"]')),
        submitButton: summarize(document.querySelector('button[aria-label="Submit"]')),
        userBubbleCandidates: queryAll('div.group.relative.flex.items-end.gap-0\\\\.5')
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && text(el).includes(${JSON.stringify(TEST_QUERY)});
          })
          .slice(0, 10)
          .map(summarize),
        userTextCandidates: queryAll('div.min-w-\\\\[48px\\\\].select-none.p-3.bg-subtle.rounded-2xl.flex.items-center.justify-center span, div.min-w-\\\\[48px\\\\].select-none.p-3.bg-subtle.rounded-2xl.flex.items-center.justify-center')
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && text(el).includes(${JSON.stringify(TEST_QUERY)});
          })
          .slice(0, 10)
          .map(summarize),
        assistantCandidates: queryAll('main div.prose, main div[id^="markdown-content-"], main div[id^="markdown-content-"] p')
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            const value = text(el);
            return rect.width > 0 && rect.height > 0 && value && !value.includes(${JSON.stringify(TEST_QUERY)});
          })
          .slice(0, 12)
          .map(summarize),
        fileUploadCandidates: queryAll('button[aria-label="Add files or tools"], input[type="file"], label[for*="file"]')
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .slice(0, 12)
          .map(summarize)
      };
    })()`
  );
}

async function inspectUserPrompt(client, sessionId, site) {
  const userPrompt = site?.userPrompt || {};
  return evaluate(
    client,
    sessionId,
    `(() => {
      const config = ${JSON.stringify(userPrompt)};
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const summarize = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          className: String(el.className || '').slice(0, 240),
          text: text(el).slice(0, 240),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      };

      const containers = config.containerSelector
        ? Array.from(document.querySelectorAll(config.containerSelector)).slice(0, 10).map(summarize)
        : [];
      const texts = config.textSelector
        ? Array.from(document.querySelectorAll(config.textSelector)).slice(0, 10).map(summarize)
        : [];

      return { containers, texts };
    })()`
  );
}

async function inspectContentExtractor(client, sessionId, site) {
  const extractor = site?.contentExtractor || {};
  return evaluate(
    client,
    sessionId,
    `(() => {
      const extractor = ${JSON.stringify(extractor)};
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const summarize = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          className: String(el.className || '').slice(0, 240),
          id: el.id || null,
          text: text(el).slice(0, 260),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      };

      const root = extractor.containerSelector ? document.querySelector(extractor.containerSelector) : document;
      const messageNodes = extractor.messageContainer && root
        ? Array.from(root.querySelectorAll(extractor.messageContainer)).slice(-5).map(summarize)
        : [];

      const contentHits = Array.isArray(extractor.contentSelectors)
        ? extractor.contentSelectors.map((selector) => {
            const nodes = root ? Array.from(root.querySelectorAll(selector)) : [];
            return {
              selector,
              count: nodes.length,
              samples: nodes.slice(0, 5).map(summarize)
            };
          })
        : [];

      const fallbackHits = Array.isArray(extractor.fallbackSelectors)
        ? extractor.fallbackSelectors.map((selector) => {
            const nodes = root ? Array.from(root.querySelectorAll(selector)) : [];
            return {
              selector,
              count: nodes.length,
              samples: nodes.slice(0, 5).map(summarize)
            };
          })
        : [];

      return {
        root: root ? summarize(root) : null,
        messageNodes,
        contentHits,
        fallbackHits
      };
    })()`
  );
}

async function inspectHistory(client, sessionId, site) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const urlFeature = ${JSON.stringify(site?.historyHandler?.urlFeature || '')};
      return {
        href: location.href,
        pathname: location.pathname,
        urlFeature,
        matched: !!urlFeature && location.pathname.includes(urlFeature)
      };
    })()`
  );
}

async function inspectUploadSurface(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const summarize = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          id: el.id || null,
          role: el.getAttribute('role'),
          type: el.getAttribute('type'),
          ariaLabel: el.getAttribute('aria-label'),
          className: String(el.className || '').slice(0, 240),
          text: text(el).slice(0, 220),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      };

      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      return {
        addFilesButton: summarize(document.querySelector('button[aria-label="Add files or tools"]')),
        visibleFileInputs: Array.from(document.querySelectorAll('input[type="file"]'))
          .filter(visible)
          .slice(0, 10)
          .map(summarize),
        allFileInputs: Array.from(document.querySelectorAll('input[type="file"]'))
          .slice(0, 10)
          .map(summarize),
        popupButtons: Array.from(document.querySelectorAll('[role="menu"] button, [role="dialog"] button, [data-radix-popper-content-wrapper] button, [data-radix-menu-content] button, [data-radix-popper-content-wrapper] [role="menuitem"]'))
          .filter(visible)
          .slice(0, 20)
          .map(summarize),
        popupContainers: Array.from(document.querySelectorAll('[role="menu"], [role="dialog"], [data-radix-popper-content-wrapper], [data-radix-menu-content]'))
          .filter(visible)
          .slice(0, 10)
          .map(summarize)
      };
    })()`
  );
}

async function runUploadProbe(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const probeFileName = 'perplexity-upload-probe.txt';
      const editor = document.querySelector('#ask-input');
      const addFilesButton = document.querySelector('button[aria-label="Add files or tools"]');
      const result = {
        focusedEditor: false,
        clickedAddFiles: false,
        dispatchedPaste: false,
        activeElementTag: document.activeElement ? document.activeElement.tagName : null,
        activeElementId: document.activeElement ? document.activeElement.id || null : null
      };

      if (addFilesButton) {
        addFilesButton.click();
        result.clickedAddFiles = true;
      }

      if (!editor) {
        result.error = 'ask-input not found';
        return result;
      }

      editor.focus();
      result.focusedEditor = document.activeElement === editor;

      const dataTransfer = new DataTransfer();
      const file = new File(['perplexity upload probe'], probeFileName, { type: 'text/plain' });
      dataTransfer.items.add(file);

      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
      });

      editor.dispatchEvent(pasteEvent);
      result.dispatchedPaste = true;
      result.activeElementTag = document.activeElement ? document.activeElement.tagName : null;
      result.activeElementId = document.activeElement ? document.activeElement.id || null : null;
      result.editorText = String(editor.innerText || editor.textContent || '').trim();
      return result;
    })()`
  );
}

async function inspectUploadProbeResult(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const probeFileName = 'perplexity-upload-probe.txt';
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const summarize = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          id: el.id || null,
          role: el.getAttribute('role'),
          type: el.getAttribute('type'),
          ariaLabel: el.getAttribute('aria-label'),
          className: String(el.className || '').slice(0, 240),
          text: text(el).slice(0, 220),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      };

      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const probeHits = Array.from(document.querySelectorAll('div, span, p, button, a, li'))
        .filter((el) => visible(el) && text(el).includes(probeFileName))
        .slice(0, 20)
        .map(summarize);

      return {
        bodyHasProbeName: text(document.body).includes(probeFileName),
        probeHits,
        visibleFileInputs: Array.from(document.querySelectorAll('input[type="file"]'))
          .filter(visible)
          .slice(0, 10)
          .map(summarize),
        popupButtons: Array.from(document.querySelectorAll('[role="menu"] button, [role="dialog"] button, [data-radix-popper-content-wrapper] button, [data-radix-menu-content] button, [data-radix-popper-content-wrapper] [role="menuitem"]'))
          .filter(visible)
          .slice(0, 20)
          .map(summarize),
        askInput: summarize(document.querySelector('#ask-input')),
        submitButton: summarize(document.querySelector('button[aria-label="Submit"]'))
      };
    })()`
  );
}

async function runUploadSubmitProbe(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const editor = document.querySelector('#ask-input');
      const submitButton = document.querySelector('button[aria-label="Submit"]');
      const result = {
        editorFound: !!editor,
        submitFound: !!submitButton
      };

      if (!editor) {
        result.error = 'ask-input not found';
        return result;
      }

      editor.focus();
      const paragraph = editor.querySelector('p') || (() => {
        const p = document.createElement('p');
        editor.appendChild(p);
        return p;
      })();
      paragraph.textContent = '请结合刚才的附件简单概括内容';
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: '请结合刚才的附件简单概括内容'
      }));
      editor.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      result.editorText = String(editor.innerText || editor.textContent || '').trim();
      result.submitDisabledBeforeClick = submitButton ? !!submitButton.disabled : null;

      if (submitButton && !submitButton.disabled) {
        submitButton.click();
        result.clickedSubmit = true;
      } else {
        result.clickedSubmit = false;
      }

      return result;
    })()`
  );
}

async function inspectPostSubmit(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const summarize = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          id: el.id || null,
          role: el.getAttribute('role'),
          ariaLabel: el.getAttribute('aria-label'),
          className: String(el.className || '').slice(0, 240),
          text: text(el).slice(0, 220),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      };
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      return {
        url: location.href,
        title: document.title,
        bodyHasProbeFile: text(document.body).includes('perplexity-upload-probe.txt'),
        bodyHasSubmitPrompt: text(document.body).includes('请结合刚才的附件简单概括内容'),
        submitButton: summarize(document.querySelector('button[aria-label="Submit"]')),
        askInput: summarize(document.querySelector('#ask-input')),
        userPromptHits: Array.from(document.querySelectorAll('div, span, p'))
          .filter((el) => visible(el) && text(el).includes('请结合刚才的附件简单概括内容'))
          .slice(0, 10)
          .map(summarize)
      };
    })()`
  );
}

async function main() {
  const site = getSiteConfig();
  const targetUrl = resolveTargetUrl(site);
  const endpoint = readChromeEndpoint();
  const client = new CDPClient(endpoint);
  await client.connect();

  let targetId = null;
  try {
    const page = await createPage(client, targetUrl);
    targetId = page.targetId;
    await waitForReady(client, page.sessionId);
    await sleep(WAIT_AFTER_LOAD_MS);

    const payload = {
      siteName: SITE_NAME,
      targetUrl,
      configuredUrl: site.url,
      query: TEST_QUERY,
      waitAfterLoadMs: WAIT_AFTER_LOAD_MS,
      snapshot: await snapshot(client, page.sessionId),
      historyInspection: await inspectHistory(client, page.sessionId, site),
      userPromptInspection: await inspectUserPrompt(client, page.sessionId, site),
      extractorInspection: await inspectContentExtractor(client, page.sessionId, site)
    };

    if (PROBE_UPLOAD) {
      payload.uploadSurfaceBefore = await inspectUploadSurface(client, page.sessionId);
      payload.uploadProbe = await runUploadProbe(client, page.sessionId);
      await sleep(WAIT_AFTER_UPLOAD_PROBE_MS);
      payload.uploadSurfaceAfter = await inspectUploadSurface(client, page.sessionId);
      payload.uploadProbeResult = await inspectUploadProbeResult(client, page.sessionId);

      if (PROBE_UPLOAD_SUBMIT) {
        payload.uploadSubmitProbe = await runUploadSubmitProbe(client, page.sessionId);
        await sleep(6000);
        payload.postSubmitInspection = await inspectPostSubmit(client, page.sessionId);
      }
    }

    const snapshotState = payload.snapshot || {};
    const bodyText = String(snapshotState.bodyText || '');
    const externalStatus = classifyExternalStatus(bodyText);
    const hasPromptSignal = Array.isArray(snapshotState.userBubbleCandidates) && snapshotState.userBubbleCandidates.length > 0;
    const hasAssistantSignal = Array.isArray(snapshotState.assistantCandidates) && snapshotState.assistantCandidates.length > 0;
    const historyUrl = String(payload.historyInspection?.urlFeature || '');
    const runtimeUrl = String(snapshotState.url || targetUrl);
    const status = externalStatus || ((hasPromptSignal || hasAssistantSignal || /\/search\//i.test(runtimeUrl)) ? 'ok' : 'landing_page');
    const contentPreview = trimPreview(
      snapshotState.assistantCandidates?.[0]?.text
      || snapshotState.userBubbleCandidates?.[0]?.text
      || bodyText
    );
    const unified = createUnifiedResult({
      siteName: SITE_NAME,
      mode: 'live_direct',
      ok: status === 'ok',
      status,
      query: TEST_QUERY,
      pageUrl: targetUrl,
      runtimeUrl,
      contentPreview,
      evidence: {
        ...payload,
        historyUrlFeature: historyUrl
      }
    });

    if (targetId) {
      await client.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    await client.close();
    printResultAndExit(unified);
  } finally {
    // best effort debug script
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
