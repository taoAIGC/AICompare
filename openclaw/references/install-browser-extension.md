# Install Or Reload AI Compare For OpenClaw

Use this guide when the OpenClaw runner says the AI Compare browser extension is missing or outdated.

## Install from Chrome Web Store

1. Open:
   `<INSTALL_URL>`
2. Install AI Compare into the same Chrome profile that OpenClaw will connect to.

## Load unpacked for local development

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the repository root

## Find the extension id

1. Open `chrome://extensions`
2. Open AI Compare details
3. Copy the extension id
4. Run the skill with:

```bash
node ./ai-compare-openclaw-runner.js --mode gui --query "你好世界" --extension-id "<YOUR_EXTENSION_ID>"
```

This usually means the browser is still running an older extension build that does not include `iframe/openclaw-bridge.js`.
