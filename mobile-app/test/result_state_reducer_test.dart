import 'package:ai_compare_remote_search/src/models/search_models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('SearchResultViewState.reduceFrame groups content by site and preserves latest text', () {
    final SearchResultViewState initialState = SearchResultViewState.initial();

    final SearchResultViewState progressState = initialState.reduceFrame(<String, dynamic>{
      'requestId': 'req-1',
      'completed': false,
      'result': <String, dynamic>{
        'query': 'hello world',
        'results': <Map<String, dynamic>>[
          <String, dynamic>{
            'siteName': 'Qwen',
            'status': 'streaming',
            'content': 'Hello',
          },
          <String, dynamic>{
            'siteName': 'ChatGPT',
            'status': 'queued',
            'content': '',
          },
        ],
      },
    });

    final SearchResultViewState completedState = progressState.reduceFrame(<String, dynamic>{
      'requestId': 'req-1',
      'completed': true,
      'result': <String, dynamic>{
        'query': 'hello world',
        'results': <Map<String, dynamic>>[
          <String, dynamic>{
            'siteName': 'Qwen',
            'status': 'ok',
            'content': 'Hello from Qwen',
          },
        ],
      },
    });

    expect(progressState.resultsBySite['Qwen']?.status, RemoteSearchStatus.streaming);
    expect(progressState.resultsBySite['ChatGPT']?.status, RemoteSearchStatus.queued);
    expect(completedState.completed, isTrue);
    expect(completedState.resultsBySite['Qwen']?.content, 'Hello from Qwen');
  });
}
