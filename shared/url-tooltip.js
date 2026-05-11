(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    module.exports.SiteUrlTooltip = api;
  }

  if (root && typeof root === 'object') {
    root.SiteUrlTooltip = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function ensureTooltip(doc, tooltipId) {
    let tooltip = doc.getElementById(tooltipId);
    if (!tooltip) {
      tooltip = doc.createElement('div');
      tooltip.id = tooltipId;
      tooltip.className = 'sidebar-favorite-tooltip-floating';
      tooltip.setAttribute('role', 'tooltip');
      tooltip.setAttribute('aria-hidden', 'true');
      tooltip.style.display = 'none';
      tooltip.style.pointerEvents = 'none';
      tooltip.style.transform = 'none';
      tooltip.style.maxWidth = 'min(560px, calc(100vw - 24px))';
      tooltip.style.whiteSpace = 'normal';
      tooltip.style.wordBreak = 'break-all';
      tooltip.style.lineHeight = '1.4';
      doc.body.appendChild(tooltip);
    }
    return tooltip;
  }

  function positionTooltip(tooltip, anchorEl, win) {
    const rect = anchorEl.getBoundingClientRect();
    const margin = 8;
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = win.innerWidth || 0;
    const viewportHeight = win.innerHeight || 0;

    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    left = Math.max(margin, Math.min(left, viewportWidth - tooltipRect.width - margin));

    let top = rect.bottom + 8;
    if (top + tooltipRect.height + margin > viewportHeight) {
      top = rect.top - tooltipRect.height - 8;
    }
    top = Math.max(margin, top);

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function attachUrlTooltip(rootEl, options = {}) {
    if (!rootEl || !rootEl.ownerDocument) {
      return null;
    }

    const doc = rootEl.ownerDocument;
    const win = doc.defaultView || window;
    const selector = options.selector || '.site-tag[data-url]';
    const tooltipId = options.tooltipId || 'siteUrlTooltip';
    const showDelay = Number.isFinite(options.showDelay) ? Math.max(0, options.showDelay) : 100;
    const tooltip = ensureTooltip(doc, tooltipId);

    let showTimer = null;
    let activeEl = null;

    function clearTimer() {
      if (showTimer) {
        win.clearTimeout(showTimer);
        showTimer = null;
      }
    }

    function restoreTitle(el) {
      if (!el) return;
      const saved = el.getAttribute('data-original-title');
      if (saved !== null) {
        el.setAttribute('title', saved);
        el.removeAttribute('data-original-title');
      }
    }

    function hideTooltip() {
      clearTimer();
      if (activeEl) {
        restoreTitle(activeEl);
        activeEl = null;
      }
      tooltip.style.display = 'none';
      tooltip.setAttribute('aria-hidden', 'true');
    }

    function showTooltip(el) {
      const text = normalizeText(el?.getAttribute('data-url') || el?.getAttribute('title') || '');
      if (!text) {
        hideTooltip();
        return;
      }

      if (activeEl && activeEl !== el) {
        restoreTitle(activeEl);
      }
      activeEl = el;
      if (!el.getAttribute('data-original-title') && el.hasAttribute('title')) {
        el.setAttribute('data-original-title', el.getAttribute('title') || '');
      }
      el.removeAttribute('title');

      tooltip.textContent = text;
      tooltip.style.display = 'block';
      tooltip.setAttribute('aria-hidden', 'false');
      positionTooltip(tooltip, el, win);
    }

    function scheduleShow(el) {
      clearTimer();
      showTimer = win.setTimeout(() => {
        showTimer = null;
        showTooltip(el);
      }, showDelay);
    }

    function onMouseOver(event) {
      const el = event.target?.closest?.(selector);
      if (!el || !rootEl.contains(el)) return;
      if (activeEl === el) return;
      scheduleShow(el);
    }

    function onMouseOut(event) {
      if (activeEl && event.relatedTarget && activeEl.contains(event.relatedTarget)) {
        return;
      }
      hideTooltip();
    }

    function onWindowChange() {
      if (activeEl && tooltip.style.display !== 'none') {
        positionTooltip(tooltip, activeEl, win);
      }
    }

    rootEl.addEventListener('mouseover', onMouseOver);
    rootEl.addEventListener('mouseout', onMouseOut);
    win.addEventListener('scroll', hideTooltip, true);
    win.addEventListener('resize', onWindowChange);

    return {
      destroy() {
        clearTimer();
        hideTooltip();
        rootEl.removeEventListener('mouseover', onMouseOver);
        rootEl.removeEventListener('mouseout', onMouseOut);
        win.removeEventListener('scroll', hideTooltip, true);
        win.removeEventListener('resize', onWindowChange);
      }
    };
  }

  return {
    attachUrlTooltip
  };
});
