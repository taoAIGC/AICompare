"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var devtools_exports = {};
__export(devtools_exports, {
  default: () => devtools_default
});
module.exports = __toCommonJS(devtools_exports);
var import_mcpBundle = require("playwright-core/lib/mcpBundle");
var import_tool = require("./tool");
const devtoolsConnect = (0, import_tool.defineTool)({
  capability: "devtools",
  skillOnly: true,
  schema: {
    name: "browser_devtools_start",
    title: "Start browser DevTools",
    description: "Start browser DevTools",
    inputSchema: import_mcpBundle.z.object({}),
    type: "action"
  },
  handle: async (context, params, response) => {
    const browserContext = await context.ensureBrowserContext();
    const { url } = await browserContext._devtoolsStart();
    response.addTextResult("Server is listening on: " + url);
  }
});
var devtools_default = [devtoolsConnect];
