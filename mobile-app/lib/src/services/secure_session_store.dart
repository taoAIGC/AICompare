import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecureSessionStore {
  SecureSessionStore({
    FlutterSecureStorage? storage,
  }) : _storage = storage ?? const FlutterSecureStorage();

  static const String _sessionKey = 'ai_compare_remote_search_session';

  final FlutterSecureStorage _storage;

  Future<Map<String, dynamic>?> loadSession() async {
    final String? raw = await _storage.read(key: _sessionKey);
    if (raw == null || raw.isEmpty) {
      return null;
    }

    final dynamic decoded = jsonDecode(raw);
    if (decoded is! Map<String, dynamic>) {
      return null;
    }
    return decoded;
  }

  Future<void> saveSession(Map<String, dynamic> payload) {
    return _storage.write(
      key: _sessionKey,
      value: jsonEncode(payload),
    );
  }

  Future<void> clear() {
    return _storage.delete(key: _sessionKey);
  }
}
