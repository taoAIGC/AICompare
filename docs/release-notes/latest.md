# User Improvement Request Log

Updated at: 2026-05-29 00:10:29
Branch: dev
Head: 0a94946

## Latest User-Facing Improvement Requests

<!-- COMMANDS:START -->
- 需求日志只保留真正影响功能体验的改进诉求，避免被无关指令干扰。
- 改进评分入口跳转逻辑，点击五星好评时打开正确的 Chrome Web Store 评论页，避免跳到错误的扩展 ID 链接。
- skills 的配置保存一个配置文件中吧，并且模仿站点的配置文件，可以远端检查更新情况，实现自动更新
- homepage 页面，对于每个site-item，在站点名称的左边显示站点的头像
- skills，增加 1、多学科思维：从经济学、心理学、物理学、生物学等角度分析当前的问题 2、六顶思考帽 3、苏格拉底提问连续追问“为什么？依据是什么？反例呢？” 4、大佬开会：马斯克、巴菲特等等大佬会怎么看待这个问题
- 在 skills 列表中使用开关样式图标，并支持直接修改每个 skill 的启用状态
- homepage 页面不再显示 skills 的启用状态，并且只展示已经启用的 skills
- 中文提问时，skills 默认跟随用户语言返回中文，而不是因为英文 prompt 返回英文
- 改进 skills 面板只开一个时大模型长时间 thinking 不返回的问题，避免长请求卡住
- homepage 页面，hover 到每个 skills 上面后，出现 skills 的全称提示更稳定，不再有时显示不出来
- 改进 homepage skills 名称 hover 提示，长名称现在会稳定显示完整名称，不再时有时无
<!-- COMMANDS:END -->
