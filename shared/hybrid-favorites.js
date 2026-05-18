(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.AICompareHybridFavorites = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const HybridHistoryDB = (typeof globalThis !== 'undefined' && globalThis.AICompareHybridHistoryDB) || {};
  const DEFAULT_FOLDER_ID = 'default';

  function normalizeString(value) {
    return String(value || '').trim();
  }

  function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function getPanels(session) {
    return session?.panels && typeof session.panels === 'object'
      ? cloneJson(session.panels)
      : {};
  }

  function getPanelEntries(session) {
    const panels = getPanels(session);
    const panelOrder = Array.isArray(session?.panelOrder) ? session.panelOrder : [];
    const ordered = panelOrder
      .map((panelId) => panels[normalizeString(panelId)] || null)
      .filter(Boolean);
    const unordered = Object.entries(panels)
      .filter(([panelId]) => !panelOrder.includes(panelId))
      .map(([, panel]) => panel);
    return [...ordered, ...unordered];
  }

  function getSessionQuery(session) {
    const directQuery = normalizeString(session?.query);
    if (directQuery) return directQuery;

    const timelineEntries = Array.isArray(session?.timelineEntries) ? session.timelineEntries : [];
    const latestTimelineQuery = timelineEntries
      .map((entry) => normalizeString(entry?.query))
      .filter(Boolean)
      .at(-1);
    if (latestTimelineQuery) return latestTimelineQuery;

    const panelEntries = getPanelEntries(session);
    for (const panel of panelEntries) {
      const messages = Array.isArray(panel?.messages) ? panel.messages : [];
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role === 'user') {
          const content = normalizeString(message?.content);
          if (content) return content;
        }
      }
    }

    return '';
  }

  function buildSessionFavoriteSites(session) {
    const openSiteNames = Array.isArray(session?.openSiteNames) ? session.openSiteNames : [];
    const openAgentIds = Array.isArray(session?.openAgentIds) ? session.openAgentIds : [];
    const panels = getPanels(session);
    const panelEntries = getPanelEntries(session);
    const siteEntries = [];
    const isFavorite = isHybridSessionFavorited(session);
    const favoriteFolder = isFavorite
      ? (normalizeString(session?.favoriteFolder) || DEFAULT_FOLDER_ID)
      : '';

    openSiteNames.forEach((name) => {
      const siteName = normalizeString(name);
      if (!siteName) return;
      const panel = panels[`site:${siteName}`] || panelEntries.find((item) => normalizeString(item?.siteName) === siteName) || null;
      siteEntries.push({
        name: siteName,
        url: normalizeString(panel?.url),
        isFavorite,
        favoriteFolder
      });
    });

    openAgentIds.forEach((agentId) => {
      const normalizedAgentId = normalizeString(agentId);
      if (!normalizedAgentId) return;
      siteEntries.push({
        name: `Agent:${normalizedAgentId}`,
        url: '',
        isFavorite,
        favoriteFolder
      });
    });

    return siteEntries;
  }

  function isHybridSessionFavorited(session) {
    return session?.isFavorite === true;
  }

  function buildHybridFavoriteItem(session) {
    return {
      id: normalizeString(session?.id),
      query: getSessionQuery(session),
      timestamp: Number(session?.updatedAt || session?.createdAt) || Date.now(),
      date: '',
      sites: buildSessionFavoriteSites(session),
      source: 'hybrid',
      favoriteFolder: normalizeString(session?.favoriteFolder) || DEFAULT_FOLDER_ID,
      isFavorite: isHybridSessionFavorited(session)
    };
  }

  async function listFavoritedHybridSessions(options = {}) {
    if (typeof HybridHistoryDB.listSessions !== 'function') {
      return [];
    }
    const limit = Math.max(1, Number(options.limit) || 500);
    const sessions = await HybridHistoryDB.listSessions({ limit });
    return sessions
      .filter((session) => isHybridSessionFavorited(session))
      .map((session) => buildHybridFavoriteItem(session));
  }

  async function getHybridSessionById(id) {
    if (!id || typeof HybridHistoryDB.getSession !== 'function') {
      return null;
    }
    return HybridHistoryDB.getSession(id);
  }

  async function updateHybridSessionFavorite(id, options = {}) {
    const session = await getHybridSessionById(id);
    if (!session || typeof HybridHistoryDB.saveSession !== 'function') {
      return null;
    }

    const nextSession = {
      ...session,
      isFavorite: options.isFavorite === true,
      favoriteFolder: options.isFavorite === true
        ? (normalizeString(options.favoriteFolder) || DEFAULT_FOLDER_ID)
        : '',
      updatedAt: Number(options.preserveUpdatedAt ? session.updatedAt : Date.now()) || Date.now()
    };

    await HybridHistoryDB.saveSession(nextSession);
    return nextSession;
  }

  async function moveHybridFavoritesToFolder(folderId) {
    const normalizedFolderId = normalizeString(folderId);
    if (!normalizedFolderId || typeof HybridHistoryDB.listSessions !== 'function' || typeof HybridHistoryDB.saveSession !== 'function') {
      return;
    }

    const sessions = await HybridHistoryDB.listSessions({ limit: 1000 });
    await Promise.all(sessions.map(async (session) => {
      if (normalizeString(session?.favoriteFolder) !== normalizedFolderId) return;
      const nextSession = {
        ...session,
        favoriteFolder: DEFAULT_FOLDER_ID
      };
      await HybridHistoryDB.saveSession(nextSession);
    }));
  }

  async function clearHybridFavorites(targetFolderId = null) {
    if (typeof HybridHistoryDB.listSessions !== 'function' || typeof HybridHistoryDB.saveSession !== 'function') {
      return;
    }
    const normalizedTargetFolderId = targetFolderId == null ? null : (normalizeString(targetFolderId) || DEFAULT_FOLDER_ID);
    const sessions = await HybridHistoryDB.listSessions({ limit: 1000 });
    await Promise.all(sessions.map(async (session) => {
      if (!isHybridSessionFavorited(session)) return;
      const sessionFolderId = normalizeString(session?.favoriteFolder) || DEFAULT_FOLDER_ID;
      if (normalizedTargetFolderId !== null && sessionFolderId !== normalizedTargetFolderId) return;
      const nextSession = {
        ...session,
        isFavorite: false,
        favoriteFolder: ''
      };
      await HybridHistoryDB.saveSession(nextSession);
    }));
  }

  async function getFavoriteFolderCounts() {
    const counts = {};
    const sessions = await listFavoritedHybridSessions({ limit: 1000 });
    sessions.forEach((item) => {
      const folderId = normalizeString(item.favoriteFolder) || DEFAULT_FOLDER_ID;
      counts[folderId] = (counts[folderId] || 0) + 1;
    });
    return counts;
  }

  return {
    DEFAULT_FOLDER_ID,
    buildHybridFavoriteItem,
    buildSessionFavoriteSites,
    clearHybridFavorites,
    getFavoriteFolderCounts,
    getHybridSessionById,
    getSessionQuery,
    isHybridSessionFavorited,
    listFavoritedHybridSessions,
    moveHybridFavoritesToFolder,
    updateHybridSessionFavorite
  };
});
