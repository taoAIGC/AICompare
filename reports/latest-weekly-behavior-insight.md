# AI Compare Weekly Product Optimization Flywheel

- Report ID: 155acc2fef
- Generated At: 2026-07-13T09:14:44.934Z
- Window: 2026-07-07 to 2026-07-13

## Executive Summary

- Active identities: 358
- API active identities: 245
- Site active identities: 129
- Activation events: 383
- Feature events: 1016
- Site compare events / launches: 650 / 3041
- API requests / tokens / estimated cost: 4450 / 29679999 / 0
- Failure events: 1447
- Subscription funnel events: 96
- Analyzed query insights: 725

## Product Read

- Positioning: 本周产品价值应围绕“research”强化
- Signal: 主任务集中在 research（283）
- Signal: 最强工作流组合是 chatgpt + claude + gemini（138）
- Signal: 最常用目标是 Gemini（523）
- Signal: 最高失败目标是 POE（396，约 5.3% 使用量）

## Fixed Decision Tree

| Question |Answer |Product Implication |
| --- |--- |--- |
| 激活卡在哪一步？ |first_open=111, first_query=44 (39.6%), first_compare=108 (97.3%), first_result=34 (30.6%) |首次提交偏低，优先优化首页默认组合、示例问题和首屏 CTA。 |
| 用户为什么留下？ |高频工作流：chatgpt + claude + gemini (138)；高频功能：homepage_site_toggle (321) |重复出现的组合应产品化为一键预设，并进入留存/付费验证。 |
| 用户真实任务是什么？ |Top task=research (283); Top query type=fact_check (239) |首页模板、默认站点组合和商店文案应向该任务倾斜。 |
| 哪个站点/组合最值得优化？ |Top site=Gemini (523); Top failure=POE (396); failureRate=19.3% |高失败且仍被使用的站点进入最高优先级适配 backlog。 |
| 哪些行为预示付费？ |limit_reached=20; checkout_started=29; checkout_success=1; checkout_conversion=3.4% |支付前转化弱，应检查升级页价值表达、支付路径和额度触达提示。 |
| 哪些行为暴露新功能机会？ |高频组合 chatgpt + claude + gemini，Top task research |组合预设、场景模板、自动总结差异是本周最直接机会。 |

## Insight Action Queue

| Score |Insight |Metric |Hypothesis |Action |Owner |Expected Impact |Success Metric |Review Date |
| --- |--- |--- |--- |--- |--- |--- |--- |--- |
| 254.8 |API 成本洞察缺失 |api_tokens=29679999, estimated_cost=0 |没有成本数据会导致商业化和免费额度策略失真。 |配置 OFFICIAL_AGENT_INPUT_TOKEN_PRICE_PER_MILLION / OUTPUT / COST_CURRENCY。 |Engineering |恢复商业化成本看板 |estimatedCost > 0 且 business dashboard 可显示成本分布 |2026-07-20 |
| 65.21 |高频 Query 模式指向明确任务 |research=283 |任务模板会降低启动成本，并提高用户对产品价值的理解。 |为 research 增加首页模板、推荐组合和结果总结结构。 |Product |提升模板点击、首次提交和任务留存 |模板触发率、首次提交率、同任务 D7 回访提升 |2026-07-20 |
| 50.25 |新用户首次打开后提交率偏低 |first_query_rate=39.6% (44/111) |用户不知道该问什么或不知道该选择哪些站点。 |首页增加 3 个场景化快捷问题，并默认选中一个高频组合。 |Product |提升首次提交率 |activation_first_query_submitted / app_first_open +15% |2026-07-20 |
| 38.5 |首次打开到首次结果率不足 |first_result_rate=30.6% (34/111) |默认站点组合或加载/失败反馈阻碍首次价值。 |优化默认站点组合、iframe 加载状态和失败后的备用站点提示。 |Engineering |提升首次有效结果率 |activation_first_result_seen / app_first_open +20% |2026-07-20 |
| 19.17 |高频站点组合重复出现 |chatgpt + claude + gemini=138 |用户在围绕该组合完成稳定工作流。 |把 chatgpt + claude + gemini 做成一键预设组合。 |Product |提升多站对比启动率和回访率 |该组合使用率 +10%，D7 回访提升 |2026-07-20 |
| 18.2 |升级漏斗存在 checkout 断点 |checkout_started=29, checkout_success=1, conversion=3.4% |用户到达支付意图，但 Pro 价值或支付路径不足以完成转化。 |在额度触达页展示 Pro 对高频工作流的价值，并检查 checkout 路径。 |Growth |提升 checkout success 和升级点击率 |checkout_success / checkout_started 提升 |2026-07-20 |
| 4.09 |热门/关键目标失败较高 |POE failures=396, total_failure_rate=19.3% |高频目标的失败会直接破坏首次价值和工作流留存。 |优先修复 POE 的 timeout/submit 路径，并增加失败降级策略。 |Engineering |降低失败率和失败后流失 |POE 失败率下降 50% |2026-07-20 |

## Weekly Product Meeting Views

### Activation View
Goal: 让新用户尽快体验多 AI 对比价值
- firstOpen: 111
- firstQuery: 44
- firstQueryRate: 39.6
- firstCompare: 108
- firstCompareRate: 97.3
- firstResult: 34
- firstResultRate: 30.6
- topTask: research
Outputs: 首页优化, 默认站点组合, 新手模板, 引导提示

### Workflow View
Goal: 找到用户留下来的原因
- topCombination: chatgpt + claude + gemini
- topCombinationCount: 138
- topFeature: homepage_site_toggle
- topFeatureCount: 321
- topSites: Gemini:523, ChatGPT:442, Claude:264, DeepSeek:259, 豆包:228
Outputs: 一键组合, 场景模板, 工作区/项目化, 自动总结差异

### Quality View
Goal: 减少失败和流失
- totalFailures: 1447
- failureRate: 19.3
- topFailure: POE
- topFailureCount: 396
- topFailurePhase: timeout
Outputs: 站点适配 backlog, 失败提示优化, 降级策略, 默认站点排序调整

### Business View
Goal: 找到自然付费点
- limitReached: 20
- checkoutStarted: 29
- checkoutSuccess: 1
- checkoutConversionRate: 3.4
- apiTokens: 29679999
- apiCost: 0
Outputs: 升级提示时机, Pro 权益包装, 免费额度策略, 成本控制

## Validation Plan

1. 修复站点适配、默认站点排序、模板、失败提示、快捷组合：采用发布前 7 天 vs 发布后 7 天对比。
2. 首屏文案、默认站点组合、升级提示、模板推荐：后续加 experimentId / variant / surface / trigger 做轻量 A/B。
3. 每条 Action Queue 必须有 successMetric 和 reviewDate；复盘时保留、升级、回滚或关闭。

## Version Distribution

| Version |Events |
| --- |--- |
| unknown |3859 |
| 4.3.4 |3044 |
| 4.3.3 |968 |
| 4.3.2 |51 |
| direct-test |1 |

## Top Workflows

| Combination |Count |
| --- |--- |
| site:chatgpt/site:claude/site:gemini |138 |
| site:deepseek/site:gemini |50 |
| agent:executive_roundtable/agent:multidisciplinary_thinking/agent:six_thinking_hats/agent:systems_thinking/site:chatgpt/site:claude/site:gemini |41 |
| site:chatgpt/site:gemini |34 |
| ChatGPT/Gemini/豆包 |24 |
| site:chatgpt/site:gemini/site:豆包 |22 |
| site:chatgpt/site:deepseek/site:gemini/site:豆包 |15 |
| site:gemini |11 |
| agent:executive_roundtable/agent:multidisciplinary_thinking/agent:six_thinking_hats/agent:systems_thinking/site:豆包 |10 |
| site:chatgpt/site:deepseek/site:gemini/site:kimi/site:qwen/site:元宝/site:千问/site:豆包 |10 |

## Top Sites

| Site |Launches |
| --- |--- |
| Gemini |523 |
| ChatGPT |442 |
| Claude |264 |
| DeepSeek |259 |
| 豆包 |228 |
| Agent: six_thinking_hats |152 |
| Agent: systems_thinking |144 |
| Agent: multidisciplinary_thinking |139 |
| Agent: executive_roundtable |131 |
| 元宝 |118 |
| 千问 |110 |
| Kimi |100 |

## Query Insight

### Query Types
| Type |Count |
| --- |--- |
| fact_check |239 |
| how_to |127 |
| other |107 |
| business_marketing |96 |
| learning |83 |
| shopping_research |50 |
| coding_debug |11 |
| writing_summary |6 |
| policy_legal |3 |
| life_travel |2 |

### Tasks
| Task |Count |
| --- |--- |
| research |283 |
| quick_answer |189 |
| writing |47 |
| content_review |44 |
| purchase_decision |44 |
| coding |30 |
| other |19 |
| translation |10 |
| coding_debug |4 |
| fact_check |1 |

### Audiences
| Audience |Count |
| --- |--- |
| general |68 |
| general_public |43 |
| consumer |25 |
| developer |21 |
| developers |18 |
| general_consumer |12 |
| unknown |10 |
| investors |9 |

## Quality

### Failure Targets
| Target |Failures |
| --- |--- |
| POE |396 |
| ChatGPT |288 |
| Claude |224 |
| Grok |123 |
| official |99 |
| DeepSeek |74 |
| Gemini |73 |
| 豆包 |26 |
| 元宝 |20 |
| custom |18 |

### Failure Phases
| Phase |Failures |
| --- |--- |
| timeout |798 |
| submit |530 |
| agent |63 |
| http |32 |
| network |22 |
| final_failure_popup |2 |

## Funnel Events

### Activation
| Event |Count |
| --- |--- |
| app_first_open |111 |
| activation_first_compare_opened |108 |
| activation_site_selected |66 |
| activation_first_query_submitted |44 |
| activation_first_result_seen |34 |
| homepage_search_submit |12 |
| iframe_search_submit |8 |

### Features
| Event |Count |
| --- |--- |
| homepage_site_toggle |321 |
| iframe_search_submit |172 |
| query_result_loaded |172 |
| homepage_agent_toggle |123 |
| homepage_search_submit |111 |
| sidebar_settings_click |27 |
| iframe_upload_click |23 |
| sidebar_history_click |21 |

### Subscription
| Event |Count |
| --- |--- |
| checkout_started |29 |
| anonymous_official_api_limit_reached |17 |
| rating_prompt_shown |17 |
| rating_prompt_later |13 |
| sidebar_membership_click |12 |
| anonymous_chat_plan_limit_reached |3 |
| checkout_success |1 |
| customer_subscription_updated |1 |
