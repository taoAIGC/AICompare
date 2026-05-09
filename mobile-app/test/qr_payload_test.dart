import 'package:ai_compare_remote_search/src/models/remote_qr_payload.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('RemoteQrPayload.parseRaw validates the required QR fields', () {
    final payload = RemoteQrPayload.parseRaw(
      '{"v":1,"relayBaseUrl":"http://127.0.0.1:8787","ticketId":"ticket-1","desktopDeviceId":"desktop-1","desktopPublicKey":{"kty":"EC"},"desktopName":"Desk","fingerprint":"ABCD-EFGH","expiresAt":"2026-05-08T00:00:00.000Z"}',
    );

    expect(payload.version, 1);
    expect(payload.desktopName, 'Desk');
    expect(payload.ticketId, 'ticket-1');
  });

  test('RemoteQrPayload.parseRaw throws for malformed payloads', () {
    expect(
      () => RemoteQrPayload.parseRaw('{"relayBaseUrl":"http://127.0.0.1:8787"}'),
      throwsFormatException,
    );
  });
}
