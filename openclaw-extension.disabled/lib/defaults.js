import os from "node:os";
import path from "node:path";

export const PLUGIN_ID = "ai-compare-hard-router";
export const PLUGIN_NAME = "AI Compare Hard Router";
export const PLUGIN_DESCRIPTION = "Intercepts search-style requests and routes them directly to the AI Compare browser runner.";

export const PRODUCTION_ENVIRONMENT = "production";
export const DEVELOPMENT_ENVIRONMENT = "development";
export const DEFAULT_RUNTIME_ENVIRONMENT = PRODUCTION_ENVIRONMENT;
export const DEFAULT_RUNTIME_ENVIRONMENT_ENV = "AI_COMPARE_ENVIRONMENT";
export const DEFAULT_EXTENSION_ID = "dkhpgbbhlnmjbkihoeniojpkggkabbbl";
export const DEFAULT_INSTALL_URL = "https://chromewebstore.google.com/detail/dkhpgbbhlnmjbkihoeniojpkggkabbbl";
export const DEVELOPMENT_EXTENSION_ID = "hhkhgpadepocnmjfpohcmjdcgkmfnadi";
export const DEVELOPMENT_INSTALL_URL = "chrome://extensions";
export const DEFAULT_EXTENSION_ID_ENV = "AI_COMPARE_EXTENSION_ID";
export const DEFAULT_INSTALL_URL_ENV = "AI_COMPARE_INSTALL_URL";
export const DEFAULT_SITE_LIMIT = 3000;
export const DEFAULT_TIMEOUT_MS = 190000;
export const DEFAULT_DEBUG_LOG_PATH = path.join(os.homedir(), ".openclaw/logs/ai-compare-hard-router.log");
