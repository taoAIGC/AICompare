(function(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root && typeof root === 'object') {
    root.TextareaResizeUtils = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function toPositiveNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  }

  function calculateTextareaLayout(options = {}) {
    const defaultHeight = toPositiveNumber(options.defaultHeight, 36);
    const minHeight = Math.max(defaultHeight, toPositiveNumber(options.minHeight, defaultHeight));
    const maxHeight = Math.max(minHeight, toPositiveNumber(options.maxHeight, minHeight));
    const compactContentHeight = Math.max(
      minHeight,
      toPositiveNumber(options.compactContentHeight, minHeight)
    );
    const expandedContentHeight = Math.max(
      minHeight,
      toPositiveNumber(options.expandedContentHeight, minHeight)
    );
    const hasValue = Boolean(options.hasValue);

    if (!hasValue) {
      return {
        height: defaultHeight,
        overflowY: 'hidden',
        avoidOverlap: false,
        compact: true,
        isScrollable: false
      };
    }

    const needsExpandedLayout = compactContentHeight > minHeight + 1;
    if (!needsExpandedLayout) {
      return {
        height: defaultHeight,
        overflowY: 'hidden',
        avoidOverlap: false,
        compact: true,
        isScrollable: false
      };
    }

    const clampedHeight = Math.min(Math.max(expandedContentHeight, minHeight), maxHeight);
    const isScrollable = expandedContentHeight > maxHeight;

    return {
      height: clampedHeight,
      overflowY: isScrollable ? 'auto' : 'hidden',
      avoidOverlap: true,
      compact: false,
      isScrollable
    };
  }

  return {
    calculateTextareaLayout
  };
});
