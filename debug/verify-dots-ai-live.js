#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { CDPClient } = require('./cdp-client');

const SITE_NAME = '点点';
const TARGET_URL = process.env.DOTS_AI_URL || 'https://dots.ai/';
const TEST_QUERY = process.env.TEST_QUERY || '';
const IFRAME_PROBE = process.env.IFRAME_PROBE === '1';
const SEND_BUTTON_SELECTOR =
  'button[aria-disabled]:has(svg path[d="m5 12 7-7 7 7"]):has(svg path[d="M12 19V5"])';
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

function getSiteConfig() {
  const configPath = path.join(__dirname, '..', 'config', 'siteHandlers.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const site = (config.sites || []).find((item) => item && item.name === SITE_NAME);
  if (!site) {
    throw new Error(`Site config not found: ${SITE_NAME}`);
  }
  return site;
}

async function snapshot(client, sessionId) {
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
          type: el.getAttribute('type'),
          role: el.getAttribute('role'),
          href: el.getAttribute('href'),
          placeholder: el.getAttribute('placeholder'),
          ariaLabel: el.getAttribute('aria-label'),
          className: String(el.className || '').slice(0, 240),
          text: text(el).slice(0, 240),
          disabled: !!el.disabled,
          contenteditable: el.getAttribute('contenteditable'),
          visible: rect.width > 0 && rect.height > 0,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          outerHTML: el.outerHTML ? el.outerHTML.slice(0, 500) : null
        };
      };

      const inputs = Array.from(
        document.querySelectorAll('textarea, input, [contenteditable="true"], [role="textbox"]')
      );
      const buttons = Array.from(document.querySelectorAll('button')).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const userMessages = Array.from(document.querySelectorAll('.user-message-item'));
      const assistantMessages = Array.from(document.querySelectorAll('.assistant-message-item'));
      const links = Array.from(document.querySelectorAll('a')).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const queryHits = Array.from(document.querySelectorAll('div, span, p, section, article'))
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          const value = text(el);
          return rect.width > 0 && rect.height > 0 && value && (
            value.includes('杜邦棉') ||
            value.includes('羊毛q弹棉') ||
            value.includes('新建对话') ||
            value.includes('我的点点')
          );
        })
        .slice(0, 30)
        .map(summarize);

      return {
        url: location.href,
        title: document.title,
        bodyText: text(document.body).slice(0, 2000),
        iconLinks: Array.from(document.querySelectorAll('link[rel*="icon" i]'))
          .map((el) => el.getAttribute('href'))
          .filter(Boolean),
        headings: Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 20).map(summarize),
        inputs: inputs.slice(0, 10).map(summarize),
        buttons: buttons.slice(0, 20).map(summarize),
        userMessageCount: userMessages.length,
        assistantMessageCount: assistantMessages.length,
        lastUserMessage: summarize(userMessages[userMessages.length - 1] || null),
        lastAssistantMessage: summarize(assistantMessages[assistantMessages.length - 1] || null),
        links: links.slice(0, 20).map(summarize),
        queryHits
      };
    })()`
  );
}

async function executeCandidateFlow(client, sessionId, query) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const query = ${JSON.stringify(query)};
      const textarea = document.querySelector('textarea[placeholder="给点点发消息"], textarea[placeholder="给点点发消息..."]');
      const sendButton = document.querySelector(${JSON.stringify(SEND_BUTTON_SELECTOR)});

      if (!textarea) {
        return { ok: false, reason: 'textarea_not_found' };
      }
      if (!sendButton) {
        return { ok: false, reason: 'send_button_not_found' };
      }

      const readButtonState = () => ({
        disabled: !!sendButton.disabled,
        className: String(sendButton.className || ''),
        text: String(sendButton.innerText || sendButton.textContent || '').replace(/\\s+/g, ' ').trim()
      });

      textarea.focus();

      const prototype = Object.getPrototypeOf(textarea);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(textarea, query);
      } else {
        textarea.value = query;
      }

      textarea.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: query
      }));
      textarea.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: query
      }));
      textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      textarea.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
      textarea.dispatchEvent(new Event('focus', { bubbles: true, cancelable: true }));

      return {
        ok: true,
        textareaValue: textarea.value,
        buttonBeforeClick: readButtonState()
      };
    })()`
  );
}

async function clickSendButton(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const sendButton = document.querySelector(${JSON.stringify(SEND_BUTTON_SELECTOR)});
      if (!sendButton) {
        return { ok: false, reason: 'send_button_not_found' };
      }

      const ev = { bubbles: true, cancelable: true, composed: true };
      sendButton.dispatchEvent(new MouseEvent('mousedown', ev));
      sendButton.dispatchEvent(new MouseEvent('mouseup', ev));
      sendButton.dispatchEvent(new MouseEvent('click', ev));
      if (typeof sendButton.click === 'function') {
        sendButton.click();
      }

      return {
        ok: true,
        disabled: !!sendButton.disabled,
        className: String(sendButton.className || '')
      };
    })()`
  );
}

async function iframeProbeSnapshot(client, sessionId) {
  const domSnapshot = await evaluate(
    client,
    sessionId,
    `(() => {
      const iframe = document.querySelector('iframe');
      if (!iframe) {
        return { ok: false, reason: 'iframe_not_found' };
      }
      const rect = iframe.getBoundingClientRect();
      let contentHref = null;
      let contentBodyText = null;
      let sameOriginAccessible = false;
      try {
        contentHref = iframe.contentWindow?.location?.href || null;
        contentBodyText = String(
          iframe.contentDocument?.body?.innerText ||
          iframe.contentDocument?.body?.textContent ||
          ''
        ).replace(/\\s+/g, ' ').trim().slice(0, 500);
        sameOriginAccessible = true;
      } catch (_) {}

      return {
        ok: true,
        src: iframe.getAttribute('src'),
        visible: rect.width > 0 && rect.height > 0,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        contentHref,
        contentBodyText,
        sameOriginAccessible
      };
    })()`
  );
  const frameTree = await client.send('Page.getFrameTree', {}, sessionId).catch(() => null);
  return {
    ...domSnapshot,
    frameTree
  };
}

async function main() {
  const site = getSiteConfig();
  const endpoint = readChromeEndpoint();
  const client = new CDPClient(endpoint);
  await client.connect();

  try {
    const probeUrl = IFRAME_PROBE
      ? `data:text/html,${encodeURIComponent(
          '<!doctype html><html><body style="margin:0"><iframe src="https://dots.ai/" style="width:100vw;height:100vh;border:0"></iframe></body></html>'
        )}`
      : TARGET_URL;
    const page = await createPage(client, probeUrl);
    await waitForReady(client, page.sessionId);
    await sleep(5000);

    const result = {
      checkedAt: new Date().toISOString(),
      siteName: SITE_NAME,
      configuredUrl: site.url,
      targetUrl: probeUrl,
      snapshot: IFRAME_PROBE
        ? await iframeProbeSnapshot(client, page.sessionId)
        : await snapshot(client, page.sessionId)
    };

    if (!IFRAME_PROBE && TEST_QUERY) {
      result.testQuery = TEST_QUERY;
      result.candidateFlow = await executeCandidateFlow(client, page.sessionId, TEST_QUERY);
      await sleep(300);
      result.afterInput = await snapshot(client, page.sessionId);
      result.clickResult = await clickSendButton(client, page.sessionId);
      await sleep(5000);
      result.afterClick = await snapshot(client, page.sessionId);
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
