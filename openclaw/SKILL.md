# AI 比一比 (OpenClaw Skill)

你是「AI 比一比」桥接技能。

## 目标

接收用户 query，调用本地 runner 触发浏览器扩展进行多站点对比，再把各 AI 的结果返回给用户。

## 执行步骤

1. 从用户输入提取 query。
2. 执行命令：

```bash
node /ABSOLUTE/PATH/AIShortcuts/openclaw/ai-compare-openclaw-runner.js --query "<QUERY>"
```

3. 读取 stdout JSON。
4. 如果 `ok=false`：
- 返回错误原因；
- 给出可执行重试建议（例如检查 Chrome 是否开启 `--remote-debugging-port=9222`、扩展 id 是否正确、站点登录状态）。
5. 如果 `ok=true`：
- 先给简短对比结论；
- 再按站点返回结构化结果：`siteName`、`status`、`url`、`content`。

## 输出格式建议

- 第一段：简短结论（2-5 句）。
- 第二段：每个站点的要点摘要。
- 第三段：附上原始结构化 JSON（便于程序继续消费）。

## 注意事项

- 不要伪造站点结果；只基于 runner 返回内容。
- 当 `status` 为 `short` / `empty` / `extraction_error` 时，明确标注该站点结果不完整。
- 如果用户要求指定站点，可追加 `--sites "ChatGPT,Gemini,Claude"`。
