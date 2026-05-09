(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.SubmitShortcutUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const ENTER_MODE = 'enter';
  const MODIFIER_ENTER_MODE = 'modifierEnter';

  function normalizeSendShortcutMode(value) {
    return value === MODIFIER_ENTER_MODE ? MODIFIER_ENTER_MODE : ENTER_MODE;
  }

  function shouldSubmitOnEnterKey(eventLike = {}, options = {}) {
    if (eventLike.key !== 'Enter' || eventLike.shiftKey) {
      return false;
    }

    const mode = normalizeSendShortcutMode(options.mode);
    if (mode !== MODIFIER_ENTER_MODE) {
      return true;
    }

    return options.isMac ? Boolean(eventLike.metaKey) : Boolean(eventLike.ctrlKey);
  }

  return {
    ENTER_MODE,
    MODIFIER_ENTER_MODE,
    normalizeSendShortcutMode,
    shouldSubmitOnEnterKey
  };
});
