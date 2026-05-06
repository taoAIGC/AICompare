function normalizeQuery(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveIframeAutoRunQuery({
  initialQuery = '',
  lastQuery = '',
  currentInputQuery = ''
} = {}) {
  return normalizeQuery(lastQuery) || normalizeQuery(currentInputQuery) || normalizeQuery(initialQuery);
}

export function shouldAutoRunIframeQuery({
  query = '',
  supportUrlQuery = false,
  queryInUrl = false
} = {}) {
  return Boolean(normalizeQuery(query)) && supportUrlQuery !== true && queryInUrl !== true;
}

export function getIframeLoadBehavior({
  initialQuery = '',
  lastQuery = '',
  currentInputQuery = '',
  supportUrlQuery = false,
  queryInUrl = false,
  clickHandlerAdded = false
} = {}) {
  const resolvedQuery = resolveIframeAutoRunQuery({
    initialQuery,
    lastQuery,
    currentInputQuery
  });

  return {
    resolvedQuery,
    shouldAutoRunQuery: shouldAutoRunIframeQuery({
      query: resolvedQuery,
      supportUrlQuery,
      queryInUrl
    }),
    shouldBindClickHandler: clickHandlerAdded !== true
  };
}
