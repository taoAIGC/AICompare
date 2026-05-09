import 'package:ai_compare_remote_search/src/state/remote_search_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('handleRelayError surfaces busy errors in the composer screen', () {
    final controller = RemoteSearchController()
      ..openComposer()
      ..handleRelayError('busy');

    expect(controller.screen, RemoteSearchScreen.searchComposer);
    expect(controller.errorMessage, contains('already running another search'));
  });

  test('handleRelayError returns to idle when the desktop is offline', () {
    final controller = RemoteSearchController()
      ..handleQrScan('{"v":1,"relayBaseUrl":"http://127.0.0.1:8787","ticketId":"ticket-1","desktopDeviceId":"desktop-1","desktopPublicKey":{"kty":"EC"},"desktopName":"Desk","fingerprint":"ABCD-EFGH","expiresAt":"2026-05-08T00:00:00.000Z"}')
      ..markApproved(pairId: 'pair-1')
      ..handleRelayError('relay_unavailable');

    expect(controller.screen, RemoteSearchScreen.connectedIdle);
    expect(controller.errorMessage, contains('offline'));
  });
}
