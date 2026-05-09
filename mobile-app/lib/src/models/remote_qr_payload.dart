import 'dart:convert';

class RemoteQrPayload {
  const RemoteQrPayload({
    required this.version,
    required this.relayBaseUrl,
    required this.ticketId,
    required this.desktopDeviceId,
    required this.desktopPublicKey,
    required this.desktopName,
    required this.fingerprint,
    required this.expiresAt,
  });

  final int version;
  final String relayBaseUrl;
  final String ticketId;
  final String desktopDeviceId;
  final Map<String, dynamic> desktopPublicKey;
  final String desktopName;
  final String fingerprint;
  final DateTime expiresAt;

  static const List<String> _requiredKeys = <String>[
    'v',
    'relayBaseUrl',
    'ticketId',
    'desktopDeviceId',
    'desktopPublicKey',
    'desktopName',
    'fingerprint',
    'expiresAt',
  ];

  factory RemoteQrPayload.parseRaw(String raw) {
    final dynamic decoded = jsonDecode(raw);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('QR payload must be a JSON object.');
    }
    return RemoteQrPayload.fromJson(decoded);
  }

  factory RemoteQrPayload.fromJson(Map<String, dynamic> json) {
    for (final String key in _requiredKeys) {
      final bool missingRequiredValue = !json.containsKey(key) || json[key] == null;
      final bool invalidPublicKey = key == 'desktopPublicKey' && json[key] is! Map;
      if (missingRequiredValue || invalidPublicKey) {
        throw FormatException('Missing required QR field: $key');
      }
    }

    final int version = (json['v'] as num).toInt();
    if (version != 1) {
      throw const FormatException('Unsupported QR payload version.');
    }

    for (final String key in <String>[
      'relayBaseUrl',
      'ticketId',
      'desktopDeviceId',
      'desktopName',
      'fingerprint',
      'expiresAt',
    ]) {
      if ('${json[key]}'.trim().isEmpty) {
        throw FormatException('QR field must not be empty: $key');
      }
    }

    final DateTime? expiresAt = DateTime.tryParse('${json['expiresAt']}');
    if (expiresAt == null) {
      throw const FormatException('Invalid QR expiration timestamp.');
    }

    return RemoteQrPayload(
      version: version,
      relayBaseUrl: '${json['relayBaseUrl']}'.trim(),
      ticketId: '${json['ticketId']}'.trim(),
      desktopDeviceId: '${json['desktopDeviceId']}'.trim(),
      desktopPublicKey: Map<String, dynamic>.from(json['desktopPublicKey'] as Map),
      desktopName: '${json['desktopName']}'.trim(),
      fingerprint: '${json['fingerprint']}'.trim(),
      expiresAt: expiresAt,
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'v': version,
      'relayBaseUrl': relayBaseUrl,
      'ticketId': ticketId,
      'desktopDeviceId': desktopDeviceId,
      'desktopPublicKey': desktopPublicKey,
      'desktopName': desktopName,
      'fingerprint': fingerprint,
      'expiresAt': expiresAt.toIso8601String(),
    };
  }
}
