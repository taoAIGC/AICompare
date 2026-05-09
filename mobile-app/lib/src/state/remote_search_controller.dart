import 'package:flutter/foundation.dart';

import '../models/remote_qr_payload.dart';
import '../models/search_models.dart';

enum RemoteSearchScreen {
  splashReconnect,
  scanQr,
  pendingApproval,
  connectedIdle,
  searchComposer,
  resultView,
  unpair,
}

class PairedDesktopSession {
  const PairedDesktopSession({
    required this.pairId,
    required this.desktopDeviceId,
    required this.desktopName,
    required this.fingerprint,
    required this.relayBaseUrl,
  });

  final String pairId;
  final String desktopDeviceId;
  final String desktopName;
  final String fingerprint;
  final String relayBaseUrl;

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'pairId': pairId,
      'desktopDeviceId': desktopDeviceId,
      'desktopName': desktopName,
      'fingerprint': fingerprint,
      'relayBaseUrl': relayBaseUrl,
    };
  }

  factory PairedDesktopSession.fromJson(Map<String, dynamic> json) {
    return PairedDesktopSession(
      pairId: '${json['pairId'] ?? ''}',
      desktopDeviceId: '${json['desktopDeviceId'] ?? ''}',
      desktopName: '${json['desktopName'] ?? ''}',
      fingerprint: '${json['fingerprint'] ?? ''}',
      relayBaseUrl: '${json['relayBaseUrl'] ?? ''}',
    );
  }
}

class RemoteSearchController extends ChangeNotifier {
  RemoteSearchScreen _screen = RemoteSearchScreen.splashReconnect;
  RemoteQrPayload? _pendingQrPayload;
  PairedDesktopSession? _pairedDesktop;
  SearchResultViewState _resultState = SearchResultViewState.initial();
  String _draftQuery = '';
  String? _errorMessage;

  RemoteSearchScreen get screen => _screen;
  RemoteQrPayload? get pendingQrPayload => _pendingQrPayload;
  PairedDesktopSession? get pairedDesktop => _pairedDesktop;
  SearchResultViewState get resultState => _resultState;
  String get draftQuery => _draftQuery;
  String? get errorMessage => _errorMessage;

  void showScanner() {
    _screen = RemoteSearchScreen.scanQr;
    _errorMessage = null;
    notifyListeners();
  }

  void handleQrScan(String rawPayload) {
    _pendingQrPayload = RemoteQrPayload.parseRaw(rawPayload);
    _screen = RemoteSearchScreen.pendingApproval;
    _errorMessage = null;
    notifyListeners();
  }

  void markApproved({required String pairId}) {
    final RemoteQrPayload qrPayload = _pendingQrPayload!;
    _pairedDesktop = PairedDesktopSession(
      pairId: pairId,
      desktopDeviceId: qrPayload.desktopDeviceId,
      desktopName: qrPayload.desktopName,
      fingerprint: qrPayload.fingerprint,
      relayBaseUrl: qrPayload.relayBaseUrl,
    );
    _pendingQrPayload = null;
    _screen = RemoteSearchScreen.connectedIdle;
    _errorMessage = null;
    notifyListeners();
  }

  void openComposer() {
    _screen = RemoteSearchScreen.searchComposer;
    notifyListeners();
  }

  void showConnectedIdle() {
    _screen = RemoteSearchScreen.connectedIdle;
    notifyListeners();
  }

  void updateDraftQuery(String query) {
    _draftQuery = query;
    notifyListeners();
  }

  void startSearch(String requestId) {
    _resultState = SearchResultViewState(
      requestId: requestId,
      query: _draftQuery,
      completed: false,
      resultsBySite: const <String, SiteResultSnapshot>{},
    );
    _screen = RemoteSearchScreen.resultView;
    _errorMessage = null;
    notifyListeners();
  }

  void applySearchFrame(Map<String, dynamic> frame) {
    _resultState = _resultState.reduceFrame(frame);
    if (_resultState.completed) {
      _screen = RemoteSearchScreen.resultView;
    }
    notifyListeners();
  }

  void handleRelayError(String code) {
    switch (code) {
      case 'busy':
        _errorMessage = 'The desktop is already running another search.';
        _screen = RemoteSearchScreen.searchComposer;
        break;
      case 'relay_unavailable':
      case 'offline':
        _errorMessage = 'The desktop is offline. Reconnect and try again.';
        _screen = RemoteSearchScreen.connectedIdle;
        break;
      default:
        _errorMessage = 'Remote search failed: $code';
        break;
    }
    notifyListeners();
  }

  void showUnpairScreen() {
    _screen = RemoteSearchScreen.unpair;
    notifyListeners();
  }

  void clearPairing() {
    _pendingQrPayload = null;
    _pairedDesktop = null;
    _draftQuery = '';
    _resultState = SearchResultViewState.initial();
    _screen = RemoteSearchScreen.scanQr;
    _errorMessage = null;
    notifyListeners();
  }

  void restoreFromSnapshot(Map<String, dynamic>? snapshot) {
    if (snapshot == null || snapshot.isEmpty) {
      _screen = RemoteSearchScreen.scanQr;
      notifyListeners();
      return;
    }

    final Map<String, dynamic>? pairedDesktop = snapshot['pairedDesktop'] as Map<String, dynamic>?;
    final bool hasActiveRequest = '${snapshot['activeRequestId'] ?? ''}'.isNotEmpty;
    _pairedDesktop = pairedDesktop == null ? null : PairedDesktopSession.fromJson(pairedDesktop);
    _draftQuery = '${snapshot['draftQuery'] ?? ''}';
    _screen = _pairedDesktop == null
        ? RemoteSearchScreen.scanQr
        : hasActiveRequest
            ? RemoteSearchScreen.resultView
            : RemoteSearchScreen.connectedIdle;
    notifyListeners();
  }

  Map<String, dynamic> toSnapshot() {
    return <String, dynamic>{
      'pairedDesktop': _pairedDesktop?.toJson(),
      'activeRequestId': _resultState.requestId,
      'draftQuery': _draftQuery,
    };
  }
}
