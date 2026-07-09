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
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, limit);
}

function percent(numerator, denominator) {
  const bottom = Number(denominator) || 0;
  if (!bottom) return 0;
  return Number((((Number(numerator) || 0) / bottom) * 100).toFixed(1));
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
    signals.push(`最强工作流组合是 ${topCombo.name}（${topCombo.count}）`);
    actions.push(`把 ${topCombo.name.replace(/\|/g, ' + ')} 做成可见预设，并跟踪它的留存、失败率和付费转化。`);
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

function table(rows, columns) {
  if (!rows.length) return '暂无数据';
  const header = `| ${columns.map((item) => item.label).join(' |')} |`;
  const divider = `| ${columns.map(() => '---').join(' |')} |`;
  const body = rows.map((row) => `| ${columns.map((item) => String(row[item.key] ?? '').replace(/\|/g, '/')).join(' |')} |`);
  return [header, divider, ...body].join('\n');
}

function renderMarkdown({ summary, insight, dateKeys, generatedAt }) {
  const reportId = crypto.createHash('sha1').update(`${generatedAt}:${dateKeys.join(',')}`).digest('hex').slice(0, 10);
  return [
    `# AI Compare Weekly Behavior Insight Report`,
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
    `## Recommended Product Actions`,
    ``,
    ...(insight.actions.length ? insight.actions.map((item, index) => `${index + 1}. ${item}`) : ['1. 样本不足，先等待新版插件覆盖并验证激活事件是否稳定进入 VPS。']),
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
  const markdown = renderMarkdown({ summary, insight, dateKeys, generatedAt });
  const payload = { generatedAt, dateKeys, summary, insight };

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
