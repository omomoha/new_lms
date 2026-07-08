import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../logic/video_embed.dart';
import '../../theme/app_theme.dart';

/// Plays an external (YouTube / Google Drive) video inside a WebView using the
/// safe embed URL from [toEmbedUrl]. Invalid/unsupported URLs render a message.
/// Progress for external embeds is manual "mark complete" (parity: the web has
/// no watch tracking for embeds either).
class ExternalVideo extends StatefulWidget {
  const ExternalVideo({super.key, required this.videoUrl});

  final String? videoUrl;

  @override
  State<ExternalVideo> createState() => _ExternalVideoState();
}

class _ExternalVideoState extends State<ExternalVideo> {
  WebViewController? _controller;
  EmbedResult? _embed;

  @override
  void initState() {
    super.initState();
    _embed = toEmbedUrl(widget.videoUrl);
    final embed = _embed;
    if (embed != null) {
      _controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(Colors.black)
        ..loadRequest(Uri.parse(embed.embedUrl));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_embed == null || _controller == null) {
      return AspectRatio(
        aspectRatio: 16 / 9,
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.mint,
            borderRadius: BorderRadius.circular(16),
          ),
          alignment: Alignment.center,
          child: const Text('Invalid video URL.',
              style: TextStyle(color: AppColors.muted)),
        ),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: AspectRatio(
        aspectRatio: 16 / 9,
        child: WebViewWidget(controller: _controller!),
      ),
    );
  }
}
