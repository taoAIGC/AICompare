(function initFailureLogsPage() {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    daysFilter: $('#daysFilter'),
    categoryFilter: $('#categoryFilter'),
    syncFilter: $('#syncFilter'),
    searchInput: $('#searchInput'),
    syncButton: $('#syncButton'),
    exportButton: $('#exportButton'),
    pruneButton: $('#pruneButton'),
    clearButton: $('#clearButton'),
    todayTotal: $('#todayTotal'),
    todaySites: $('#todaySites'),
    todayApi: $('#todayApi'),
    topTarget: $('#topTarget'),
    topReason: $('#topReason'),
    topSiteReason: $('#topSiteReason'),
    syncPending: $('#syncPending'),
    syncSynced: $('#syncSynced'),
    syncFailed: $('#syncFailed'),
    recordCount: $('#recordCount'),
    statusMessage: $('#statusMessage'),
    logsBody: $('#logsBody')
  };

  let currentLogs = [];

  function getRepeatCount(record) {
    return Math.max(1, Number(record.repeatCount) || 1);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return '-';
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function getFailureDetailCode(record = {}) {
    return String(record.errorCode || record.metadata?.timeoutReason || '').trim();
  }

  function getTarget(record = {}) {
    return record.category === 'api'
      ? (record.apiKind || 'API')
      : (record.siteName || '未知站点');
  }

  function getReasonLabel(record = {}) {
    return getFailureDetailCode(record) || record.phase || record.errorMessage || 'unknown';
  }

  function getPhaseLabel(record = {}) {
    const phase = String(record.phase || '-').trim() || '-';
    const detailCode = getFailureDetailCode(record);
    return detailCode ? `${phase} / ${detailCode}` : phase;
  }

  function showStatus(message, isError = false) {
    elements.statusMessage.textContent = message;
    elements.statusMessage.hidden = !message;
    elements.statusMessage.style.color = isError ? '#b7372f' : '';
  }

  function topCountLabel(counts) {
    const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    return top ? `${top[0]} (${top[1]})` : '暂无';
  }

  function summarizeToday(logs) {
    const today = window.AIFailureLog?.toDateKey?.(new Date()) || new Date().toISOString().slice(0, 10);
    const todayLogs = logs.filter((record) => record.dateKey === today);
    const siteSet = new Set();
    let todayTotal = 0;
    let todayApi = 0;
    const targetCounts = new Map();
    const reasonCounts = new Map();
    const siteReasonCounts = new Map();

    todayLogs.forEach((record) => {
      const count = getRepeatCount(record);
      const target = getTarget(record);
      const reason = getReasonLabel(record);
      todayTotal += count;
      if (record.category === 'site' && record.siteName) {
        siteSet.add(record.siteName);
      }
      if (record.category === 'api') {
        todayApi += count;
      }
      targetCounts.set(target, (targetCounts.get(target) || 0) + count);
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + count);
      siteReasonCounts.set(`${target} / ${reason}`, (siteReasonCounts.get(`${target} / ${reason}`) || 0) + count);
    });

    elements.todayTotal.textContent = String(todayTotal);
    elements.todaySites.textContent = String(siteSet.size);
    elements.todayApi.textContent = String(todayApi);
    elements.topTarget.textContent = topCountLabel(targetCounts);
    elements.topReason.textContent = topCountLabel(reasonCounts);
    elements.topSiteReason.textContent = topCountLabel(siteReasonCounts);
  }

  function buildDiagnosticPayload(record = {}) {
    return {
      siteName: record.siteName || '',
      apiKind: record.apiKind || '',
      phase: record.phase || '',
      errorCode: record.errorCode || '',
      errorMessage: record.errorMessage || '',
      pageUrl: record.pageUrl || '',
      runtimeUrl: record.runtimeUrl || '',
      queryPreview: record.queryPreview || '',
      queryHash: record.queryHash || '',
      repeatCount: getRepeatCount(record),
      metadata: record.metadata || {}
    };
  }

  function renderRows(logs) {
    elements.recordCount.textContent = `${logs.length} 条`;
    if (!logs.length) {
      elements.logsBody.innerHTML = '<tr><td colspan="9" class="empty">没有符合条件的失败日志</td></tr>';
      return;
    }

    elements.logsBody.innerHTML = logs.map((record, index) => {
      const target = getTarget(record);
      const badgeClass = record.category === 'api' ? 'badge api' : 'badge';
      const badgeText = record.category === 'api' ? 'API' : '站点';
      const syncStatus = record.syncStatus || 'pending';
      const syncText = syncStatus === 'synced' ? '已同步' : (syncStatus === 'failed' ? '失败' : '待同步');
      const detailJson = JSON.stringify(buildDiagnosticPayload(record), null, 2);
      return `
        <tr>
          <td>${escapeHtml(formatTime(record.lastSeenAt || record.createdAt))}</td>
          <td><span class="${badgeClass}">${badgeText}</span></td>
          <td>${escapeHtml(target)}</td>
          <td>${escapeHtml(getPhaseLabel(record))}</td>
          <td>${record.status ? escapeHtml(record.status) : '-'}</td>
          <td class="error-cell">${escapeHtml(record.errorMessage || '-')}</td>
          <td>${getRepeatCount(record)}</td>
          <td><span class="sync-pill ${escapeHtml(syncStatus)}">${escapeHtml(syncText)}</span></td>
          <td><button class="detail-toggle" type="button" data-log-index="${index}">展开</button></td>
        </tr>
        <tr class="detail-row" data-detail-index="${index}" hidden>
          <td colspan="9">
            <pre>${escapeHtml(detailJson)}</pre>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function refreshLogs() {
    if (!window.AIFailureLog) {
      showStatus('日志模块加载失败，请确认 shared/failure-log.js 已被打包。', true);
      return;
    }
    const days = Number(elements.daysFilter.value) || 7;
    const category = elements.categoryFilter.value || 'all';
    const query = elements.searchInput.value || '';
    const syncFilter = elements.syncFilter.value || 'all';
    currentLogs = await window.AIFailureLog.getLogs({ days, category, query });
    if (syncFilter !== 'all') {
      currentLogs = currentLogs.filter((record) => String(record.syncStatus || 'pending') === syncFilter);
    }
    currentLogs.sort((a, b) => {
      const aTime = new Date(a.lastSeenAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.lastSeenAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
    summarizeToday(await window.AIFailureLog.getLogs({ days: 1, category: 'all' }));
    const syncSummary = await window.AIFailureLog.getSyncSummary();
    elements.syncPending.textContent = String(syncSummary.pending || 0);
    elements.syncSynced.textContent = String(syncSummary.synced || 0);
    elements.syncFailed.textContent = String(syncSummary.failed || 0);
    renderRows(currentLogs);
    showStatus('');
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(currentLogs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ai-compare-failure-logs-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function pruneLogs() {
    await window.AIFailureLog.pruneLogs();
    showStatus('已清理 30 天外日志，并按 2000 条上限裁剪。');
    await refreshLogs();
  }

  async function clearLogs() {
    if (!confirm('确认清空当前浏览器内的全部失败日志？此操作不可恢复。')) {
      return;
    }
    await window.AIFailureLog.clearLogs();
    showStatus('已清空日志。');
    await refreshLogs();
  }

  async function syncNow() {
    showStatus('正在同步失败日志到 VPS...');
    const response = await chrome.runtime.sendMessage({
      action: 'syncFailureLogsNow',
      force: true
    });
    if (!response?.ok) {
      throw new Error(response?.error || '同步失败');
    }
    const uploaded = Number(response.result?.uploaded || 0);
    showStatus(`同步完成，本次上传 ${uploaded} 条。`);
    await refreshLogs();
  }

  elements.daysFilter.addEventListener('change', refreshLogs);
  elements.categoryFilter.addEventListener('change', refreshLogs);
  elements.syncFilter.addEventListener('change', refreshLogs);
  elements.searchInput.addEventListener('input', () => {
    clearTimeout(elements.searchInput._refreshTimer);
    elements.searchInput._refreshTimer = setTimeout(refreshLogs, 160);
  });
  elements.syncButton.addEventListener('click', () => {
    syncNow().catch((error) => {
      showStatus(error?.message || String(error), true);
    });
  });
  elements.exportButton.addEventListener('click', exportJson);
  elements.pruneButton.addEventListener('click', pruneLogs);
  elements.clearButton.addEventListener('click', clearLogs);
  elements.logsBody.addEventListener('click', (event) => {
    const button = event.target?.closest?.('.detail-toggle');
    if (!button) return;
    const index = button.getAttribute('data-log-index');
    const row = Array.from(elements.logsBody.querySelectorAll('.detail-row'))
      .find((item) => item.getAttribute('data-detail-index') === index);
    if (!row) return;
    const shouldShow = row.hidden;
    row.hidden = !shouldShow;
    button.textContent = shouldShow ? '收起' : '展开';
  });

  refreshLogs().catch((error) => {
    showStatus(error?.message || String(error), true);
  });
})();
