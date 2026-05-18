# Install Or Reload AI Compare For OpenClaw

Use this guide when the OpenClaw runner says the AI Compare browser extension is missing or outdated.

## Install from Chrome Web Store

1. Open:
   `https://chromewebstore.google.com/detail/dkhpgbbhlnmjbkihoeniojpkggkabbbl`
2. Install AI Compare into the same Chrome profile that OpenClaw will connect to.
3. Use plugin config `environment: "production"` when you want OpenClaw to target this store build.

## Load unpacked for local development

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the repository root
5. Confirm the loaded extension id is `hhkhgpadepocnmjfpohcmjdcgkmfnadi`
6. Use plugin config `environment: "development"` when you want OpenClaw to target this unpacked build.

## Find the extension id

1. Open `chrome://extensions`
2. Open AI Compare details
3. Copy the extension id
4. Run the runner with:

```bash
node ./ai-compare-openclaw-runner.js --mode gui --query "你好世界" --extension-id "<YOUR_EXTENSION_ID>"
```

This usually means the browser is still running an older extension build that does not include `iframe/openclaw-bridge.js`.
