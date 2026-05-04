import os from "node:os";
import path from "node:path";

export const PLUGIN_ID = "ai-compare-hard-router";
export const PLUGIN_NAME = "AI Compare Hard Router";
export const PLUGIN_DESCRIPTION = "Intercepts search-style requests and routes them directly to the AI Compare browser runner.";

export const DEFAULT_EXTENSION_ID = "hhkhgpadepocnmjfpohcmjdcgkmfnadi";
export const DEFAULT_INSTALL_URL = "https://chromewebstore.google.com/detail/multi-ai/hhkhgpadepocnmjfpohcmjdcgkmfnadi";
export const DEFAULT_SITE_LIMIT = 3000;
export const DEFAULT_TIMEOUT_MS = 190000;
export const DEFAULT_DEBUG_LOG_PATH = path.join(os.homedir(), ".openclaw/logs/ai-compare-hard-router.log");
