#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const EXTENSION_ID = process.env.EXTENSION_ID || 'hhkhgpadepocnmjfpohcmjdcgkmfnadi';
const SITE_NAME = 'Nano Banana';
const DEVTOOLS_ACTIVE_PORT =
  process.env.DEVTOOLS_ACTIVE_PORT ||
  path.join(process.env.HOME || '', 'Library/Application Support/Google/Chrome/DevToolsActivePort');

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
    this.id = 0;
    this.pending = new Map();
    this.ws = null;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.endpoint);
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (error) => reject(error));
      this.ws.addEventListener('message', (event) => {
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

async function main() {
  const client = new CDPClient(readChromeEndpoint());
  await client.connect();

  try {
    const { targetInfos } = await client.send('Target.getTargets');
    let target = (targetInfos || []).find((item) =>
      item.type === 'page' &&
      String(item.url || '').includes(`chrome-extension://${EXTENSION_ID}/iframe/iframe.html`)
    );

    if (!target) {
      const { targetId } = await client.send('Target.createTarget', {
        url: `chrome-extension://${EXTENSION_ID}/iframe/iframe.html?sites=${encodeURIComponent(SITE_NAME)}&type=image`
      });
      target = { targetId };
    }

    const { sessionId } = await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Page.enable', {}, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const expression = `
      (async () => {
        const sites = typeof getDefaultSites === 'function' ? await getDefaultSites() : [];
        const site = Array.isArray(sites) ? sites.find((item) => item && item.name === ${JSON.stringify(SITE_NAME)}) : null;
        const iframe = document.querySelector('iframe.ai-iframe[data-site="${SITE_NAME}"]');
        const container = document.querySelector('.iframe-container[data-site-name="${SITE_NAME}"]');
        const overlay = container ? container.querySelector('.inject-progress') : null;
        let latestUrl = null;
        let latestUrlError = null;
        if (iframe && typeof getIframeLatestUrl === 'function') {
          try {
            latestUrl = await getIframeLatestUrl(iframe, ${JSON.stringify(SITE_NAME)});
          } catch (error) {
            latestUrlError = String(error && error.message ? error.message : error);
          }
        }
        return {
          pageUrl: location.href,
          pageTitle: document.title,
          runtimeSite: site ? {
            name: site.name,
            url: site.url,
            enabled: site.enabled,
            type: site.type,
            hidden: site.hidden,
            supportIframe: site.supportIframe
          } : null,
          iframeSrc: iframe ? iframe.src : null,
          iframeDataSite: iframe ? iframe.getAttribute('data-site') : null,
          latestUrl,
          latestUrlError,
          searchValue: document.getElementById('searchInput') ? document.getElementById('searchInput').value : null,
          overlayTitle: overlay && overlay.querySelector('.inject-progress-title') ? overlay.querySelector('.inject-progress-title').textContent.trim() : null,
          overlayDetail: overlay && overlay.querySelector('.inject-progress-detail') ? overlay.querySelector('.inject-progress-detail').textContent.trim() : null,
          overlayVisible: !!(overlay && overlay.classList.contains('is-visible')),
          overlayStatus: overlay && overlay.dataset ? (overlay.dataset.lastStatus || null) : null
        };
      })()
    `;

    const result = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    }, sessionId);

    console.log(JSON.stringify(result.result.value, null, 2));
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
