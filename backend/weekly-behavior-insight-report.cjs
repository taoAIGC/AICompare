#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const admin = require('firebase-admin');

const DEFAULT_DAYS = Math.max(1, Number(process.env.WEEKLY_INSIGHT_DAYS || 7) || 7);
const REPORT_DIR = process.env.WEEKLY_INSIGHT_REPORT_DIR || path.join(__dirname, 'reports');

function parseArgs(argv) {
  const options = { days: DEFAULT_DAYS, write: true };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-write') options.write = false;
    if (arg === '--days') {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value) && value > 0) options.days = Math.round(value);
      index += 1;
    }
  }
  return options;
}

function getDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getRecentDateKeys(days) {
  const keys = [];
  const now = new Date();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    keys.push(getDateKey(date));
  }
  return keys;
}

function ensureFirebase() {
  if (admin.apps.length) return;
  const serviceAccountJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const serviceAccountPath = String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  if (serviceAccountJson) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccountJson)) });
    return;
  }
  if (serviceAccountPath) {
    admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
    return;
  }
  admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'aicompare-12989' });
}

function timestampToIso(value) {
  if (!value) return '';
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value || '');
}

function identityOf(data = {}) {
  const uid = String(data.uid || '').trim();
  const clientHash = String(data.clientHash || '').trim();
  if (uid) return `user:${uid}`;
  if (clientHash) return `anonymous:${clientHash}`;
  return '';
}

function normalizeList(value, limit = 20) {
  const values = Array.isArray(value) ? value : [];
  return Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, limit);
}

function inc(map, key, amount = 1) {
  const normalized = String(key || '').trim();
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) || 0) + amount);
}

function topRows(map, limit = 10) {
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .filter((row) => !/[{}"]/.test(row.name))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, limit);
}

function formatCombinationLabel(value = '') {
  return String(value || '')
    .split('|')
    .map((part) => part.replace(/^site:/, '').replace(/^agent:/, 'Agent: '))
    .filter(Boolean)
    .join(' + ');
}

function percent(numerator, denominator) {
  const bottom = Number(denominator) || 0;
  if (!bottom) return 0;
  return Number((((Number(numerator) || 0) / bottom) * 100).toFixed(1));
}

function ratio(numerator, denominator) {
  const bottom = Number(denominator) || 0;
  if (!bottom) return 0;
  return Number(((Number(numerator) || 0) / bottom).toFixed(4));
}

function getTopCount(rows = [], name = '') {
  const item = rows.find((row) => row.name === name);
  return item ? Number(item.count) || 0 : 0;
}

function addDays(date, days) {
  const value = new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  return value.toISOString().slice(0, 10);
}

function nextReviewDate(generatedAt) {
  const start = new Date(generatedAt);
  const day = start.getUTCDay();
  const daysUntilNextMonday = ((8 - day) % 7) || 7;
  return addDays(start, daysUntilNextMonday);
}

function createSiteCombinationKey(data = {}) {
  const names = [
    ...normalizeList(data.siteNames || data.officialSiteNames || []),
    ...normalizeList(data.customSiteNames || []).map((name) => `custom:${name}`),
    ...normalizeList(data.agentIds || []).map((name) => `agent:${name}`)
  ];
  return Array.from(new Set(names)).sort((left, right) => left.localeCompare(right)).join('|');
}

async function listRecent(db, collectionName, dateKeys, limit = 10000) {
  const snapshot = await db.collection(collectionName)
    .where('dateKey', '>=', dateKeys[0])
    .where('dateKey', '<=', dateKeys[dateKeys.length - 1])
    .limit(limit)
    .get()
    .catch(() => ({ docs: [] }));
  const allowed = new Set(dateKeys);
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((row) => allowed.has(String(row.dateKey || '')));
}

async function listQueryInsights(db, limit = 1000) {
  const snapshot = await db.collection('queryInsightAnalyses').limit(limit).get().catch(() => ({ docs: [] }));
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function summarize({ activationRows, featureRows, siteRows, failureRows, subscriptionRows, apiRows, queryInsights, dateKeys }) {
  const identities = new Set();
  const apiIdentities = new Set();
  const siteIdentities = new Set();
  const activationEvents = new Map();
  const featureEvents = new Map();
  const siteCounts = new Map();
  const combinations = new Map();
  const versions = new Map();
  const failureTargets = new Map();
  const failurePhases = new Map();
  const subscriptionEvents = new Map();
  const queryTypes = new Map();
  const tasks = new Map();
  const audiences = new Map();
  const useCases = new Map();
  const dailyActivity = new Map(dateKeys.map((dateKey) => [dateKey, new Set()]));
  let siteLaunches = 0;
  let apiTokens = 0;
  let apiCost = 0;

  const touch = (row) => {
    const identity = identityOf(row);
    if (identity) {
      identities.add(identity);
      if (row.dateKey && dailyActivity.has(row.dateKey)) dailyActivity.get(row.dateKey).add(identity);
    }
    inc(versions, row.extensionVersion || 'unknown');
    return identity;
  };

  activationRows.forEach((row) => {
    touch(row);
    inc(activationEvents, row.eventName || 'unknown');
  });
  featureRows.forEach((row) => {
    touch(row);
    inc(featureEvents, row.eventName || 'unknown');
  });
  siteRows.forEach((row) => {
    const identity = touch(row);
    if (identity) siteIdentities.add(identity);
    const siteNames = normalizeList(row.siteNames);
    const agentIds = normalizeList(row.agentIds);
    siteLaunches += siteNames.length + agentIds.length;
    siteNames.forEach((name) => inc(siteCounts, name));
    agentIds.forEach((name) => inc(siteCounts, `Agent: ${name}`));
    inc(combinations, row.siteCombinationKey || createSiteCombinationKey(row));
  });
  failureRows.forEach((row) => {
    touch(row);
    inc(failureTargets, row.siteName || row.failureTarget || row.apiKind || row.model || 'unknown', Math.max(1, Number(row.repeatCount) || 1));
    inc(failurePhases, row.phase || row.failurePhase || row.errorCode || 'unknown', Math.max(1, Number(row.repeatCount) || 1));
  });
  subscriptionRows.forEach((row) => {
    touch(row);
    inc(subscriptionEvents, row.eventName || 'unknown');
  });
  apiRows.forEach((row) => {
    const identity = touch(row);
    if (identity) apiIdentities.add(identity);
    apiTokens += Number(row.totalTokens || 0);
    apiCost += Number(row.estimatedCost || 0);
  });
  queryInsights.forEach((row) => {
    const analysis = row.analysis || row;
    inc(queryTypes, analysis.queryType);
    inc(tasks, analysis.taskCategory);
    inc(audiences, analysis.audience);
    inc(useCases, analysis.useCase);
  });

  return {
    activeIdentities: identities.size,
    apiActiveIdentities: apiIdentities.size,
    siteActiveIdentities: siteIdentities.size,
    activationEvents: activationRows.length,
    featureEvents: featureRows.length,
    siteEvents: siteRows.length,
    siteLaunches,
    failureEvents: failureRows.reduce((sum, row) => sum + Math.max(1, Number(row.repeatCount) || 1), 0),
    subscriptionEvents: subscriptionRows.length,
    apiRequests: apiRows.length,
    apiTokens: Math.round(apiTokens),
    apiCost: Number(apiCost.toFixed(6)),
    analyzedQueries: queryInsights.filter((row) => {
      const analysis = row.analysis || row;
      return analysis.queryType || analysis.taskCategory || analysis.audience || analysis.useCase;
    }).length,
    dailyActiveIdentities: Array.from(dailyActivity.entries()).map(([dateKey, set]) => ({ dateKey, activeIdentities: set.size })),
    topActivationEvents: topRows(activationEvents, 8),
    topFeatureEvents: topRows(featureEvents, 8),
    topSites: topRows(siteCounts, 12),
    topCombinations: topRows(combinations, 10),
    topVersions: topRows(versions, 10),
    topFailures: topRows(failureTargets, 10),
    topFailurePhases: topRows(failurePhases, 8),
    topSubscriptionEvents: topRows(subscriptionEvents, 8),
    topQueryTypes: topRows(queryTypes, 10),
    topTasks: topRows(tasks, 10),
    topAudiences: topRows(audiences, 8),
    topUseCases: topRows(useCases, 8)
  };
}

function inferInsight(summary) {
  const actions = [];
  const signals = [];
  const topQueryType = summary.topQueryTypes[0];
  const topTaskCandidate = summary.topTasks[0];
  const topTask = topTaskCandidate && (!topQueryType || topTaskCandidate.count >= topQueryType.count * 0.5)
    ? topTaskCandidate
    : topQueryType;
  const topCombo = summary.topCombinations[0];
  const topSite = summary.topSites[0];
  const topFailure = summary.topFailures[0];

  if (topTask) {
    signals.push(`主任务集中在 ${topTask.name}（${topTask.count}）`);
    if (/fact_check|事实|verify|核查/i.test(topTask.name)) {
      actions.push('把首页和默认模板聚焦到“多模型事实核查 / 答案验证”，提供一键验证模板和共识/分歧摘要。');
    } else if (/how_to|教程|操作/i.test(topTask.name)) {
      actions.push('增加“操作教程”场景模板，并在结果页突出步骤、风险点和不同模型的补充信息。');
    } else if (/shopping|product|选购/i.test(topTask.name)) {
      actions.push('增加“产品研究/选购对比”模板，输出购买标准、候选项差异和不确定信息。');
    } else if (/business|marketing|营销/i.test(topTask.name)) {
      actions.push('增加商业/营销任务入口，沉淀可复制的案例、GEO/SEO 内容检查和品牌问答模板。');
    }
  }

  if (topCombo) {
    const combinationLabel = formatCombinationLabel(topCombo.name);
    signals.push(`最强工作流组合是 ${combinationLabel}（${topCombo.count}）`);
    actions.push(`把 ${combinationLabel} 做成可见预设，并跟踪它的留存、失败率和付费转化。`);
  }

  if (topSite) {
    signals.push(`最常用目标是 ${topSite.name}（${topSite.count}）`);
  }

  if (topFailure) {
    const failureRate = percent(topFailure.count, Math.max(1, summary.siteLaunches + summary.apiRequests));
    signals.push(`最高失败目标是 ${topFailure.name}（${topFailure.count}，约 ${failureRate}% 使用量）`);
    actions.push(`优先修复 ${topFailure.name} 的失败链路，并在失败后提供备用站点/重试/降级提示。`);
  }

  if (summary.featureEvents === 0) {
    actions.push('继续观察新版插件版本的功能事件，若 72 小时后仍为空，优先排查功能事件分类或客户端上报路径。');
  }

  if (summary.subscriptionEvents > 0) {
    actions.push('把订阅漏斗和高频任务关联起来，识别“额度触达 -> 升级入口 -> checkout”的断点。');
  }

  if (summary.apiTokens > 0 && summary.apiCost === 0) {
    actions.push('配置官方 API 成本环境变量，否则商业看板无法判断高成本未付费用户。');
  }

  return {
    positioning: topTask ? `本周产品价值应围绕“${topTask.name}”强化` : '本周样本不足，先扩大新版埋点覆盖并观察激活漏斗',
    signals,
    actions: Array.from(new Set(actions)).slice(0, 8)
  };
}

function scoreAction({ affectedUsers = 1, pain = 0.1, strategicWeight = 1, effort = 1 } = {}) {
  const score = (Math.max(1, affectedUsers) * Math.max(0.01, pain) * Math.max(0.1, strategicWeight)) / Math.max(1, effort);
  return Number(score.toFixed(2));
}

function createAction({ insight, metric, hypothesis, action, owner, expectedImpact, successMetric, reviewDate, affectedUsers, pain, strategicWeight, effort }) {
  return {
    insight,
    metric,
    hypothesis,
    action,
    owner,
    expectedImpact,
    successMetric,
    reviewDate,
    priorityScore: scoreAction({ affectedUsers, pain, strategicWeight, effort })
  };
}

function buildProductFlywheel(summary, generatedAt) {
  const reviewDate = nextReviewDate(new Date(generatedAt));
  const firstOpen = getTopCount(summary.topActivationEvents, 'app_first_open');
  const firstQuery = getTopCount(summary.topActivationEvents, 'activation_first_query_submitted');
  const firstCompare = getTopCount(summary.topActivationEvents, 'activation_first_compare_opened');
  const firstResult = getTopCount(summary.topActivationEvents, 'activation_first_result_seen');
  const checkoutStarted = getTopCount(summary.topSubscriptionEvents, 'checkout_started');
  const checkoutSuccess = getTopCount(summary.topSubscriptionEvents, 'checkout_success');
  const limitReached = summary.topSubscriptionEvents
    .filter((row) => /limit_reached/i.test(row.name))
    .reduce((sum, row) => sum + Number(row.count || 0), 0);
  const topTask = summary.topTasks[0] || summary.topQueryTypes[0] || null;
  const topQueryType = summary.topQueryTypes[0] || null;
  const topCombo = summary.topCombinations[0] || null;
  const topSite = summary.topSites[0] || null;
  const topFailure = summary.topFailures[0] || null;
  const topFeature = summary.topFeatureEvents[0] || null;
  const totalUsage = Math.max(1, summary.siteLaunches + summary.apiRequests);
  const firstQueryRate = percent(firstQuery, firstOpen);
  const firstCompareRate = percent(firstCompare, firstOpen);
  const firstResultRate = percent(firstResult, firstOpen);
  const checkoutConversionRate = percent(checkoutSuccess, checkoutStarted);
  const failureRate = percent(summary.failureEvents, totalUsage);

  const decisionTree = [
    {
      question: '激活卡在哪一步？',
      answer: `first_open=${firstOpen}, first_query=${firstQuery} (${firstQueryRate}%), first_compare=${firstCompare} (${firstCompareRate}%), first_result=${firstResult} (${firstResultRate}%)`,
      implication: firstOpen && firstQueryRate < 50
        ? '首次提交偏低，优先优化首页默认组合、示例问题和首屏 CTA。'
        : (firstQuery && firstResultRate < 70 ? '首次结果不足，优先优化默认站点组合、失败提示和加载状态。' : '激活漏斗没有出现单一明显断点，继续按版本观察。')
    },
    {
      question: '用户为什么留下？',
      answer: topCombo ? `高频工作流：${formatCombinationLabel(topCombo.name)} (${topCombo.count})；高频功能：${topFeature?.name || '暂无'} (${topFeature?.count || 0})` : '暂无稳定高频工作流。',
      implication: topCombo ? '重复出现的组合应产品化为一键预设，并进入留存/付费验证。' : '先提高事件覆盖和样本规模。'
    },
    {
      question: '用户真实任务是什么？',
      answer: `Top task=${topTask?.name || '-'} (${topTask?.count || 0}); Top query type=${topQueryType?.name || '-'} (${topQueryType?.count || 0})`,
      implication: topTask ? '首页模板、默认站点组合和商店文案应向该任务倾斜。' : 'Query insight 样本或分类维度不足。'
    },
    {
      question: '哪个站点/组合最值得优化？',
      answer: `Top site=${topSite?.name || '-'} (${topSite?.count || 0}); Top failure=${topFailure?.name || '-'} (${topFailure?.count || 0}); failureRate=${failureRate}%`,
      implication: topFailure ? '高失败且仍被使用的站点进入最高优先级适配 backlog。' : '本周无明确质量修复对象。'
    },
    {
      question: '哪些行为预示付费？',
      answer: `limit_reached=${limitReached}; checkout_started=${checkoutStarted}; checkout_success=${checkoutSuccess}; checkout_conversion=${checkoutConversionRate}%`,
      implication: checkoutStarted && checkoutConversionRate < 20
        ? '支付前转化弱，应检查升级页价值表达、支付路径和额度触达提示。'
        : '继续观察付费前置行为与高频工作流的关联。'
    },
    {
      question: '哪些行为暴露新功能机会？',
      answer: topCombo ? `高频组合 ${formatCombinationLabel(topCombo.name)}，Top task ${topTask?.name || '-'}` : '暂无足够信号。',
      implication: topCombo ? '组合预设、场景模板、自动总结差异是本周最直接机会。' : '先积累更多工作流信号。'
    }
  ];

  const actionQueue = [];
  if (firstOpen && firstQueryRate < 50) {
    actionQueue.push(createAction({
      insight: '新用户首次打开后提交率偏低',
      metric: `first_query_rate=${firstQueryRate}% (${firstQuery}/${firstOpen})`,
      hypothesis: '用户不知道该问什么或不知道该选择哪些站点。',
      action: '首页增加 3 个场景化快捷问题，并默认选中一个高频组合。',
      owner: 'Product',
      expectedImpact: '提升首次提交率',
      successMetric: 'activation_first_query_submitted / app_first_open +15%',
      reviewDate,
      affectedUsers: firstOpen,
      pain: 1 - ratio(firstQuery, firstOpen),
      strategicWeight: 1.5,
      effort: 2
    }));
  }
  if (firstOpen && firstResultRate < 70) {
    actionQueue.push(createAction({
      insight: '首次打开到首次结果率不足',
      metric: `first_result_rate=${firstResultRate}% (${firstResult}/${firstOpen})`,
      hypothesis: '默认站点组合或加载/失败反馈阻碍首次价值。',
      action: '优化默认站点组合、iframe 加载状态和失败后的备用站点提示。',
      owner: 'Engineering',
      expectedImpact: '提升首次有效结果率',
      successMetric: 'activation_first_result_seen / app_first_open +20%',
      reviewDate,
      affectedUsers: firstOpen,
      pain: 1 - ratio(firstResult, firstOpen),
      strategicWeight: 1.5,
      effort: 3
    }));
  }
  if (topCombo) {
    actionQueue.push(createAction({
      insight: '高频站点组合重复出现',
      metric: `${formatCombinationLabel(topCombo.name)}=${topCombo.count}`,
      hypothesis: '用户在围绕该组合完成稳定工作流。',
      action: `把 ${formatCombinationLabel(topCombo.name)} 做成一键预设组合。`,
      owner: 'Product',
      expectedImpact: '提升多站对比启动率和回访率',
      successMetric: '该组合使用率 +10%，D7 回访提升',
      reviewDate,
      affectedUsers: summary.siteActiveIdentities,
      pain: ratio(topCombo.count, Math.max(1, summary.siteEvents)),
      strategicWeight: 1.4,
      effort: 2
    }));
  }
  if (topTask) {
    actionQueue.push(createAction({
      insight: '高频 Query 模式指向明确任务',
      metric: `${topTask.name}=${topTask.count}`,
      hypothesis: '任务模板会降低启动成本，并提高用户对产品价值的理解。',
      action: `为 ${topTask.name} 增加首页模板、推荐组合和结果总结结构。`,
      owner: 'Product',
      expectedImpact: '提升模板点击、首次提交和任务留存',
      successMetric: '模板触发率、首次提交率、同任务 D7 回访提升',
      reviewDate,
      affectedUsers: summary.activeIdentities,
      pain: ratio(topTask.count, Math.max(1, summary.analyzedQueries)),
      strategicWeight: 1.4,
      effort: 3
    }));
  }
  if (topFailure) {
    actionQueue.push(createAction({
      insight: '热门/关键目标失败较高',
      metric: `${topFailure.name} failures=${topFailure.count}, total_failure_rate=${failureRate}%`,
      hypothesis: '高频目标的失败会直接破坏首次价值和工作流留存。',
      action: `优先修复 ${topFailure.name} 的 timeout/submit 路径，并增加失败降级策略。`,
      owner: 'Engineering',
      expectedImpact: '降低失败率和失败后流失',
      successMetric: `${topFailure.name} 失败率下降 50%`,
      reviewDate,
      affectedUsers: summary.siteActiveIdentities,
      pain: ratio(topFailure.count, totalUsage),
      strategicWeight: 1.2,
      effort: 2
    }));
  }
  if (checkoutStarted > 0) {
    actionQueue.push(createAction({
      insight: '升级漏斗存在 checkout 断点',
      metric: `checkout_started=${checkoutStarted}, checkout_success=${checkoutSuccess}, conversion=${checkoutConversionRate}%`,
      hypothesis: '用户到达支付意图，但 Pro 价值或支付路径不足以完成转化。',
      action: '在额度触达页展示 Pro 对高频工作流的价值，并检查 checkout 路径。',
      owner: 'Growth',
      expectedImpact: '提升 checkout success 和升级点击率',
      successMetric: 'checkout_success / checkout_started 提升',
      reviewDate,
      affectedUsers: checkoutStarted,
      pain: 1 - ratio(checkoutSuccess, checkoutStarted),
      strategicWeight: 1.3,
      effort: 2
    }));
  }
  if (summary.apiTokens > 0 && summary.apiCost === 0) {
    actionQueue.push(createAction({
      insight: 'API 成本洞察缺失',
      metric: `api_tokens=${summary.apiTokens}, estimated_cost=${summary.apiCost}`,
      hypothesis: '没有成本数据会导致商业化和免费额度策略失真。',
      action: '配置 OFFICIAL_AGENT_INPUT_TOKEN_PRICE_PER_MILLION / OUTPUT / COST_CURRENCY。',
      owner: 'Engineering',
      expectedImpact: '恢复商业化成本看板',
      successMetric: 'estimatedCost > 0 且 business dashboard 可显示成本分布',
      reviewDate,
      affectedUsers: summary.apiActiveIdentities,
      pain: 0.8,
      strategicWeight: 1.3,
      effort: 1
    }));
  }
  actionQueue.sort((left, right) => right.priorityScore - left.priorityScore);

  const meetingViews = {
    activation: {
      goal: '让新用户尽快体验多 AI 对比价值',
      metrics: {
        firstOpen,
        firstQuery,
        firstQueryRate,
        firstCompare,
        firstCompareRate,
        firstResult,
        firstResultRate,
        topTask: topTask?.name || ''
      },
      outputs: ['首页优化', '默认站点组合', '新手模板', '引导提示']
    },
    workflow: {
      goal: '找到用户留下来的原因',
      metrics: {
        topCombination: topCombo ? formatCombinationLabel(topCombo.name) : '',
        topCombinationCount: topCombo?.count || 0,
        topFeature: topFeature?.name || '',
        topFeatureCount: topFeature?.count || 0,
        topSites: summary.topSites.slice(0, 5).map((row) => `${row.name}:${row.count}`).join(', ')
      },
      outputs: ['一键组合', '场景模板', '工作区/项目化', '自动总结差异']
    },
    quality: {
      goal: '减少失败和流失',
      metrics: {
        totalFailures: summary.failureEvents,
        failureRate,
        topFailure: topFailure?.name || '',
        topFailureCount: topFailure?.count || 0,
        topFailurePhase: summary.topFailurePhases[0]?.name || ''
      },
      outputs: ['站点适配 backlog', '失败提示优化', '降级策略', '默认站点排序调整']
    },
    business: {
      goal: '找到自然付费点',
      metrics: {
        limitReached,
        checkoutStarted,
        checkoutSuccess,
        checkoutConversionRate,
        apiTokens: summary.apiTokens,
        apiCost: summary.apiCost
      },
      outputs: ['升级提示时机', 'Pro 权益包装', '免费额度策略', '成本控制']
    }
  };

  const validationPlan = [
    '修复站点适配、默认站点排序、模板、失败提示、快捷组合：采用发布前 7 天 vs 发布后 7 天对比。',
    '首屏文案、默认站点组合、升级提示、模板推荐：后续加 experimentId / variant / surface / trigger 做轻量 A/B。',
    '每条 Action Queue 必须有 successMetric 和 reviewDate；复盘时保留、升级、回滚或关闭。'
  ];

  return {
    decisionTree,
    actionQueue,
    meetingViews,
    validationPlan
  };
}

function table(rows, columns) {
  if (!rows.length) return '暂无数据';
  const header = `| ${columns.map((item) => item.label).join(' |')} |`;
  const divider = `| ${columns.map(() => '---').join(' |')} |`;
  const body = rows.map((row) => `| ${columns.map((item) => String(row[item.key] ?? '').replace(/\|/g, '/')).join(' |')} |`);
  return [header, divider, ...body].join('\n');
}

function renderObjectMetrics(metrics = {}) {
  return Object.entries(metrics).map(([key, value]) => `- ${key}: ${value}`).join('\n') || '- 暂无数据';
}

function renderMarkdown({ summary, insight, flywheel, dateKeys, generatedAt }) {
  const reportId = crypto.createHash('sha1').update(`${generatedAt}:${dateKeys.join(',')}`).digest('hex').slice(0, 10);
  return [
    `# AI Compare Weekly Product Optimization Flywheel`,
    ``,
    `- Report ID: ${reportId}`,
    `- Generated At: ${generatedAt}`,
    `- Window: ${dateKeys[0]} to ${dateKeys[dateKeys.length - 1]}`,
    ``,
    `## Executive Summary`,
    ``,
    `- Active identities: ${summary.activeIdentities}`,
    `- API active identities: ${summary.apiActiveIdentities}`,
    `- Site active identities: ${summary.siteActiveIdentities}`,
    `- Activation events: ${summary.activationEvents}`,
    `- Feature events: ${summary.featureEvents}`,
    `- Site compare events / launches: ${summary.siteEvents} / ${summary.siteLaunches}`,
    `- API requests / tokens / estimated cost: ${summary.apiRequests} / ${summary.apiTokens} / ${summary.apiCost}`,
    `- Failure events: ${summary.failureEvents}`,
    `- Subscription funnel events: ${summary.subscriptionEvents}`,
    `- Analyzed query insights: ${summary.analyzedQueries}`,
    ``,
    `## Product Read`,
    ``,
    `- Positioning: ${insight.positioning}`,
    ...insight.signals.map((item) => `- Signal: ${item}`),
    ``,
    `## Fixed Decision Tree`,
    ``,
    table(flywheel.decisionTree, [
      { key: 'question', label: 'Question' },
      { key: 'answer', label: 'Answer' },
      { key: 'implication', label: 'Product Implication' }
    ]),
    ``,
    `## Insight Action Queue`,
    ``,
    table(flywheel.actionQueue, [
      { key: 'priorityScore', label: 'Score' },
      { key: 'insight', label: 'Insight' },
      { key: 'metric', label: 'Metric' },
      { key: 'hypothesis', label: 'Hypothesis' },
      { key: 'action', label: 'Action' },
      { key: 'owner', label: 'Owner' },
      { key: 'expectedImpact', label: 'Expected Impact' },
      { key: 'successMetric', label: 'Success Metric' },
      { key: 'reviewDate', label: 'Review Date' }
    ]),
    ``,
    `## Weekly Product Meeting Views`,
    ``,
    `### Activation View`,
    `Goal: ${flywheel.meetingViews.activation.goal}`,
    renderObjectMetrics(flywheel.meetingViews.activation.metrics),
    `Outputs: ${flywheel.meetingViews.activation.outputs.join(', ')}`,
    ``,
    `### Workflow View`,
    `Goal: ${flywheel.meetingViews.workflow.goal}`,
    renderObjectMetrics(flywheel.meetingViews.workflow.metrics),
    `Outputs: ${flywheel.meetingViews.workflow.outputs.join(', ')}`,
    ``,
    `### Quality View`,
    `Goal: ${flywheel.meetingViews.quality.goal}`,
    renderObjectMetrics(flywheel.meetingViews.quality.metrics),
    `Outputs: ${flywheel.meetingViews.quality.outputs.join(', ')}`,
    ``,
    `### Business View`,
    `Goal: ${flywheel.meetingViews.business.goal}`,
    renderObjectMetrics(flywheel.meetingViews.business.metrics),
    `Outputs: ${flywheel.meetingViews.business.outputs.join(', ')}`,
    ``,
    `## Validation Plan`,
    ``,
    ...flywheel.validationPlan.map((item, index) => `${index + 1}. ${item}`),
    ``,
    `## Version Distribution`,
    ``,
    table(summary.topVersions, [{ key: 'name', label: 'Version' }, { key: 'count', label: 'Events' }]),
    ``,
    `## Top Workflows`,
    ``,
    table(summary.topCombinations, [{ key: 'name', label: 'Combination' }, { key: 'count', label: 'Count' }]),
    ``,
    `## Top Sites`,
    ``,
    table(summary.topSites, [{ key: 'name', label: 'Site' }, { key: 'count', label: 'Launches' }]),
    ``,
    `## Query Insight`,
    ``,
    `### Query Types`,
    table(summary.topQueryTypes, [{ key: 'name', label: 'Type' }, { key: 'count', label: 'Count' }]),
    ``,
    `### Tasks`,
    table(summary.topTasks, [{ key: 'name', label: 'Task' }, { key: 'count', label: 'Count' }]),
    ``,
    `### Audiences`,
    table(summary.topAudiences, [{ key: 'name', label: 'Audience' }, { key: 'count', label: 'Count' }]),
    ``,
    `## Quality`,
    ``,
    `### Failure Targets`,
    table(summary.topFailures, [{ key: 'name', label: 'Target' }, { key: 'count', label: 'Failures' }]),
    ``,
    `### Failure Phases`,
    table(summary.topFailurePhases, [{ key: 'name', label: 'Phase' }, { key: 'count', label: 'Failures' }]),
    ``,
    `## Funnel Events`,
    ``,
    `### Activation`,
    table(summary.topActivationEvents, [{ key: 'name', label: 'Event' }, { key: 'count', label: 'Count' }]),
    ``,
    `### Features`,
    table(summary.topFeatureEvents, [{ key: 'name', label: 'Event' }, { key: 'count', label: 'Count' }]),
    ``,
    `### Subscription`,
    table(summary.topSubscriptionEvents, [{ key: 'name', label: 'Event' }, { key: 'count', label: 'Count' }]),
    ``
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv);
  ensureFirebase();
  const db = admin.firestore();
  const dateKeys = getRecentDateKeys(options.days);
  const [
    activationRows,
    featureRows,
    siteRows,
    failureRows,
    subscriptionRows,
    apiRows,
    queryInsights
  ] = await Promise.all([
    listRecent(db, 'activationEvents', dateKeys),
    listRecent(db, 'productFeatureEvents', dateKeys),
    listRecent(db, 'siteCompareEvents', dateKeys),
    listRecent(db, 'failureLogEvents', dateKeys),
    listRecent(db, 'subscriptionFunnelEvents', dateKeys),
    listRecent(db, 'officialApiEvents', dateKeys),
    listQueryInsights(db)
  ]);
  const summary = summarize({
    activationRows,
    featureRows,
    siteRows,
    failureRows,
    subscriptionRows,
    apiRows,
    queryInsights,
    dateKeys
  });
  const insight = inferInsight(summary);
  const generatedAt = new Date().toISOString();
  const flywheel = buildProductFlywheel(summary, generatedAt);
  const markdown = renderMarkdown({ summary, insight, flywheel, dateKeys, generatedAt });
  const payload = { generatedAt, dateKeys, summary, insight, flywheel };

  if (options.write) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const reportKey = dateKeys[dateKeys.length - 1];
    fs.writeFileSync(path.join(REPORT_DIR, `weekly-behavior-insight-${reportKey}.md`), markdown);
    fs.writeFileSync(path.join(REPORT_DIR, `weekly-behavior-insight-${reportKey}.json`), JSON.stringify(payload, null, 2));
    fs.writeFileSync(path.join(REPORT_DIR, 'latest-weekly-behavior-insight.md'), markdown);
    fs.writeFileSync(path.join(REPORT_DIR, 'latest-weekly-behavior-insight.json'), JSON.stringify(payload, null, 2));
  }

  console.log(markdown);
}

main().catch((error) => {
  console.error('[weekly-behavior-insight-report] failed:', error);
  process.exit(1);
});
