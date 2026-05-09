import 'package:ai_compare_remote_search/src/state/remote_search_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('restoreFromSnapshot returns to connected idle when a pair exists', () {
    final controller = RemoteSearchController();

    controller.restoreFromSnapshot(<String, dynamic>{
      'pairedDesktop': <String, dynamic>{
        'pairId': 'pair-1',
        'desktopDeviceId': 'desktop-1',
        'desktopName': 'Desk',
        'fingerprint': 'ABCD-EFGH',
        'relayBaseUrl': 'http://127.0.0.1:8787',
      },
      'activeRequestId': '',
      'draftQuery': 'hello',
    });

    expect(controller.screen, RemoteSearchScreen.connectedIdle);
    expect(controller.pairedDesktop?.desktopName, 'Desk');
    expect(controller.draftQuery, 'hello');
  });

  test('restoreFromSnapshot returns to result view when a request is still active', () {
    final controller = RemoteSearchController();

    controller.restoreFromSnapshot(<String, dynamic>{
      'pairedDesktop': <String, dynamic>{
        'pairId': 'pair-1',
        'desktopDeviceId': 'desktop-1',
        'desktopName': 'Desk',
        'fingerprint': 'ABCD-EFGH',
        'relayBaseUrl': 'http://127.0.0.1:8787',
      },
      'activeRequestId': 'req-1',
      'draftQuery': 'hello',
    });

    expect(controller.screen, RemoteSearchScreen.resultView);
  });
}
