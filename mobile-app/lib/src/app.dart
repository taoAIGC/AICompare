import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'services/secure_session_store.dart';
import 'state/remote_search_controller.dart';

class RemoteSearchApp extends StatefulWidget {
  const RemoteSearchApp({super.key});

  @override
  State<RemoteSearchApp> createState() => _RemoteSearchAppState();
}

class _RemoteSearchAppState extends State<RemoteSearchApp> {
  late final RemoteSearchController _controller;
  late final SecureSessionStore _sessionStore;

  @override
  void initState() {
    super.initState();
    _controller = RemoteSearchController()
      ..addListener(_persistSnapshot);
    _sessionStore = SecureSessionStore();
    _restoreSnapshot();
  }

  Future<void> _restoreSnapshot() async {
    final Map<String, dynamic>? snapshot = await _sessionStore.loadSession();
    _controller.restoreFromSnapshot(snapshot);
  }

  Future<void> _persistSnapshot() async {
    await _sessionStore.saveSession(_controller.toSnapshot());
  }

  @override
  void dispose() {
    _controller.removeListener(_persistSnapshot);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AI Compare Remote Search',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0F172A)),
        useMaterial3: true,
      ),
      home: AnimatedBuilder(
        animation: _controller,
        builder: (BuildContext context, _) {
          return Scaffold(
            appBar: AppBar(
              title: const Text('Remote Search'),
              actions: <Widget>[
                if (_controller.pairedDesktop != null)
                  IconButton(
                    icon: const Icon(Icons.link_off),
                    onPressed: _controller.showUnpairScreen,
                  ),
              ],
            ),
            body: SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: _buildScreen(),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildScreen() {
    switch (_controller.screen) {
      case RemoteSearchScreen.splashReconnect:
        return const Center(child: CircularProgressIndicator());
      case RemoteSearchScreen.scanQr:
        return _ScanQrScreen(controller: _controller);
      case RemoteSearchScreen.pendingApproval:
        return _PendingApprovalScreen(controller: _controller);
      case RemoteSearchScreen.connectedIdle:
        return _ConnectedIdleScreen(controller: _controller);
      case RemoteSearchScreen.searchComposer:
        return _SearchComposerScreen(controller: _controller);
      case RemoteSearchScreen.resultView:
        return _ResultViewScreen(controller: _controller);
      case RemoteSearchScreen.unpair:
        return _UnpairScreen(
          controller: _controller,
          sessionStore: _sessionStore,
        );
    }
  }
}

class _ScanQrScreen extends StatelessWidget {
  const _ScanQrScreen({required this.controller});

  final RemoteSearchController controller;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text(
          'Scan the desktop pairing QR',
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        const Text(
          'The mobile app does not choose sites in v1. It always uses the desktop extension’s enabled iframe sites.',
        ),
        const SizedBox(height: 20),
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(24),
            child: MobileScanner(
              onDetect: (BarcodeCapture capture) {
                final String? rawValue = capture.barcodes.firstOrNull?.rawValue;
                if (rawValue == null || rawValue.isEmpty) {
                  return;
                }
                controller.handleQrScan(rawValue);
              },
            ),
          ),
        ),
      ],
    );
  }
}

class _PendingApprovalScreen extends StatelessWidget {
  const _PendingApprovalScreen({required this.controller});

  final RemoteSearchController controller;

  @override
  Widget build(BuildContext context) {
    final payload = controller.pendingQrPayload;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text(
          'Waiting for approval',
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 12),
        Text('Desktop: ${payload?.desktopName ?? '-'}'),
        Text('Fingerprint: ${payload?.fingerprint ?? '-'}'),
        Text('Relay: ${payload?.relayBaseUrl ?? '-'}'),
        const SizedBox(height: 20),
        const Text(
          'In production this screen remains connected to the relay until the desktop approves the pair request.',
        ),
        const Spacer(),
        FilledButton(
          onPressed: () => controller.markApproved(pairId: 'mock-pair'),
          child: const Text('Simulate approval'),
        ),
      ],
    );
  }
}

class _ConnectedIdleScreen extends StatelessWidget {
  const _ConnectedIdleScreen({required this.controller});

  final RemoteSearchController controller;

  @override
  Widget build(BuildContext context) {
    final session = controller.pairedDesktop;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          session?.desktopName ?? 'Desktop connected',
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        Text('Fingerprint: ${session?.fingerprint ?? '-'}'),
        const Spacer(),
        FilledButton(
          onPressed: controller.openComposer,
          child: const Text('Start a remote search'),
        ),
      ],
    );
  }
}

class _SearchComposerScreen extends StatefulWidget {
  const _SearchComposerScreen({required this.controller});

  final RemoteSearchController controller;

  @override
  State<_SearchComposerScreen> createState() => _SearchComposerScreenState();
}

class _SearchComposerScreenState extends State<_SearchComposerScreen> {
  late final TextEditingController _textController;

  @override
  void initState() {
    super.initState();
    _textController = TextEditingController(text: widget.controller.draftQuery);
  }

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text(
          'Send query to desktop',
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _textController,
          minLines: 3,
          maxLines: 6,
          decoration: const InputDecoration(
            hintText: 'Enter query text only',
            border: OutlineInputBorder(),
          ),
          onChanged: widget.controller.updateDraftQuery,
        ),
        const SizedBox(height: 12),
        if (widget.controller.errorMessage case final String errorMessage?)
          Text(
            errorMessage,
            style: const TextStyle(color: Colors.deepOrange),
          ),
        const Spacer(),
        FilledButton(
          onPressed: () {
            widget.controller.updateDraftQuery(_textController.text);
            widget.controller.startSearch(DateTime.now().millisecondsSinceEpoch.toString());
          },
          child: const Text('Send to desktop'),
        ),
      ],
    );
  }
}

class _ResultViewScreen extends StatelessWidget {
  const _ResultViewScreen({required this.controller});

  final RemoteSearchController controller;

  @override
  Widget build(BuildContext context) {
    final state = controller.resultState;
    final entries = state.resultsBySite.entries.toList()
      ..sort((a, b) => a.key.compareTo(b.key));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          state.query.isEmpty ? 'Streaming results' : state.query,
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 12),
        if (entries.isEmpty)
          const Text('Waiting for per-site updates...')
        else
          Expanded(
            child: ListView.separated(
              itemBuilder: (BuildContext context, int index) {
                final entry = entries[index].value;
                return ListTile(
                  title: Text(entry.siteName),
                  subtitle: Text(entry.content.isEmpty ? entry.error : entry.content),
                  trailing: Text(entry.status.name),
                );
              },
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemCount: entries.length,
            ),
          ),
        const SizedBox(height: 12),
        FilledButton.tonal(
          onPressed: controller.openComposer,
          child: const Text('New search'),
        ),
      ],
    );
  }
}

class _UnpairScreen extends StatelessWidget {
  const _UnpairScreen({
    required this.controller,
    required this.sessionStore,
  });

  final RemoteSearchController controller;
  final SecureSessionStore sessionStore;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text(
          'Unpair this phone?',
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 12),
        const Text(
          'After unpairing, the desktop must generate a new QR code before this phone can search again.',
        ),
        const Spacer(),
        Row(
          children: <Widget>[
            Expanded(
              child: OutlinedButton(
                onPressed: controller.showConnectedIdle,
                child: const Text('Cancel'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton(
                onPressed: () async {
                  await sessionStore.clear();
                  controller.clearPairing();
                },
                child: const Text('Unpair'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

extension<T> on List<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
