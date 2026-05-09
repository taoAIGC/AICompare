import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

class RelayClient {
  WebSocketChannel? _channel;

  Stream<Map<String, dynamic>> connect(String relayBaseUrl) {
    final Uri relayUri = Uri.parse(
      relayBaseUrl.replaceFirst(RegExp(r'^http:'), 'ws:').replaceFirst(RegExp(r'^https:'), 'wss:'),
    ).replace(path: '/ws');

    _channel = WebSocketChannel.connect(relayUri);
    return _channel!.stream.map((dynamic event) {
      return Map<String, dynamic>.from(jsonDecode(event as String) as Map);
    });
  }

  void sendFrame(Map<String, dynamic> frame) {
    _channel?.sink.add(jsonEncode(frame));
  }

  Future<void> close() async {
    await _channel?.sink.close();
    _channel = null;
  }
}

class RemoteFrameCrypto {
  const RemoteFrameCrypto();

  static final AesGcm _cipher = AesGcm.with256bits();

  Future<SecretBox> encrypt({
    required SecretKey sharedSecret,
    required Uint8List plaintext,
    required List<int> nonce,
  }) {
    return _cipher.encrypt(
      plaintext,
      secretKey: sharedSecret,
      nonce: nonce,
    );
  }

  Future<Uint8List> decrypt({
    required SecretKey sharedSecret,
    required SecretBox secretBox,
  }) async {
    final List<int> bytes = await _cipher.decrypt(
      secretBox,
      secretKey: sharedSecret,
    );
    return Uint8List.fromList(bytes);
  }
}
