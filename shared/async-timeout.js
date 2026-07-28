(function initializeAsyncTimeout(globalScope) {
  function raceWithTimeout(promise, timeoutMs, errorFactory = null) {
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const error = typeof errorFactory === 'function'
          ? errorFactory()
          : new Error('Operation timed out');
        reject(error);
      }, Math.max(0, Number(timeoutMs) || 0));
    });

    return Promise.race([Promise.resolve(promise), timeoutPromise])
      .finally(() => clearTimeout(timeoutId));
  }

  const api = { raceWithTimeout };
  if (globalScope) {
    globalScope.AsyncTimeout = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
