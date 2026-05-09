enum RemoteSearchStatus {
  queued,
  executing,
  pending,
  streaming,
  ok,
  timeout,
  loginRequired,
  blocked,
  landingPage,
  notSubmitted,
  error,
}

RemoteSearchStatus parseRemoteSearchStatus(String rawStatus) {
  switch (rawStatus.trim()) {
    case 'queued':
      return RemoteSearchStatus.queued;
    case 'executing':
      return RemoteSearchStatus.executing;
    case 'pending':
      return RemoteSearchStatus.pending;
    case 'streaming':
      return RemoteSearchStatus.streaming;
    case 'ok':
      return RemoteSearchStatus.ok;
    case 'timeout':
      return RemoteSearchStatus.timeout;
    case 'login_required':
      return RemoteSearchStatus.loginRequired;
    case 'blocked':
      return RemoteSearchStatus.blocked;
    case 'landing_page':
      return RemoteSearchStatus.landingPage;
    case 'not_submitted':
      return RemoteSearchStatus.notSubmitted;
    default:
      return RemoteSearchStatus.error;
  }
}

class SiteResultSnapshot {
  const SiteResultSnapshot({
    required this.siteName,
    required this.status,
    required this.content,
    required this.error,
  });

  final String siteName;
  final RemoteSearchStatus status;
  final String content;
  final String error;

  SiteResultSnapshot copyWith({
    RemoteSearchStatus? status,
    String? content,
    String? error,
  }) {
    return SiteResultSnapshot(
      siteName: siteName,
      status: status ?? this.status,
      content: content ?? this.content,
      error: error ?? this.error,
    );
  }

  factory SiteResultSnapshot.fromFrame(Map<String, dynamic> json) {
    return SiteResultSnapshot(
      siteName: '${json['siteName'] ?? ''}'.trim(),
      status: parseRemoteSearchStatus('${json['status'] ?? 'error'}'),
      content: '${json['content'] ?? ''}',
      error: '${json['error'] ?? ''}',
    );
  }
}

class SearchResultViewState {
  const SearchResultViewState({
    required this.requestId,
    required this.query,
    required this.completed,
    required this.resultsBySite,
  });

  final String requestId;
  final String query;
  final bool completed;
  final Map<String, SiteResultSnapshot> resultsBySite;

  factory SearchResultViewState.initial() {
    return const SearchResultViewState(
      requestId: '',
      query: '',
      completed: false,
      resultsBySite: <String, SiteResultSnapshot>{},
    );
  }

  SearchResultViewState reduceFrame(Map<String, dynamic> frame) {
    final Map<String, SiteResultSnapshot> nextResults = Map<String, SiteResultSnapshot>.from(resultsBySite);
    final Map<String, dynamic> result = Map<String, dynamic>.from(
      frame['result'] as Map<String, dynamic>? ?? <String, dynamic>{},
    );
    final List<dynamic> items = result['results'] as List<dynamic>? ?? const <dynamic>[];

    for (final dynamic item in items) {
      if (item is! Map<String, dynamic>) {
        continue;
      }

      final SiteResultSnapshot snapshot = SiteResultSnapshot.fromFrame(item);
      if (snapshot.siteName.isEmpty) {
        continue;
      }

      final SiteResultSnapshot? previous = nextResults[snapshot.siteName];
      nextResults[snapshot.siteName] = previous == null
          ? snapshot
          : previous.copyWith(
              status: snapshot.status,
              content: snapshot.content.isEmpty ? previous.content : snapshot.content,
              error: snapshot.error.isEmpty ? previous.error : snapshot.error,
            );
    }

    return SearchResultViewState(
      requestId: '${frame['requestId'] ?? requestId}',
      query: '${result['query'] ?? query}',
      completed: frame['completed'] == true,
      resultsBySite: nextResults,
    );
  }
}
