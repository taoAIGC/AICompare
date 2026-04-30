# Install Or Reload AI Compare For OpenClaw

Use this guide when the OpenClaw runner says the AI Compare browser extension is missing or outdated.

## Install from Chrome Web Store

1. Open:
   `https://chromewebstore.google.com/detail/multi-ai/dkhpgbbhlnmjbkihoeniojpkggkabbbl`
2. Install AI Compare into the same Chrome profile that OpenClaw will connect to.

## Load unpacked for local development

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the repository root:
   `/Users/hasee/Documents/同步文稿/multi-AI/AIShortcuts`

## Find the extension id

1. Open `chrome://extensions`
2. Open AI Compare details
3. Copy the extension id
4. Run the skill with:

```bash
node ./ai-compare-openclaw-runner.js --mode gui --query "你好世界" --extension-id "<YOUR_EXTENSION_ID>"
```

Or build a GUI trigger URL without opening the browser yet:

```bash
node ./ai-compare-openclaw-runner.js --mode gui --query "你好世界" --extension-id "<YOUR_EXTENSION_ID>" --print-only
```

Windows example:

```bat
node .\ai-compare-openclaw-runner.js --mode gui --query "你好世界" --extension-id "<YOUR_EXTENSION_ID>" --browser-app "chrome"
```

macOS example:

```bash
node ./ai-compare-openclaw-runner.js --mode gui --query "你好世界" --extension-id "<YOUR_EXTENSION_ID>" --browser-app "Google Chrome"
```

## If the extension is installed but bridge is missing

1. Open `chrome://extensions`
2. Find AI Compare
3. Click `Reload`
4. Retry the skill

This usually means the browser is still running an older extension build that does not include `iframe/openclaw-bridge.js`.
