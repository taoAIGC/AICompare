(function initializeDailyDismissal(globalScope) {
  function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async function dismissForToday(key, storage, date = new Date()) {
    await storage.set({ [key]: getLocalDateKey(date) });
  }

  async function isDismissedToday(key, storage, date = new Date()) {
    const stored = await storage.get(key);
    return String(stored?.[key] || '') === getLocalDateKey(date);
  }

  const api = { dismissForToday, getLocalDateKey, isDismissedToday };
  if (globalScope) {
    globalScope.DailyDismissal = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
