/// Video embed URL conversion.
///
/// Pure Dart port of `src/lib/videoEmbed.ts`. Converts a user-supplied YouTube
/// or Google Drive share URL to a safe embed URL. Returns null for anything
/// that doesn't match — never embed arbitrary URLs.

enum VideoProvider { youtube, drive }

class EmbedResult {
  final String embedUrl;
  final VideoProvider provider;
  const EmbedResult({required this.embedUrl, required this.provider});
}

final RegExp _shortsRe = RegExp(r'^/shorts/([A-Za-z0-9_-]{6,16})$');
final RegExp _driveRe = RegExp(r'^/file/d/([A-Za-z0-9_-]{10,128})(?:/|$)');
final RegExp _youTubeIdRe = RegExp(r'^[A-Za-z0-9_-]{11}$');
final RegExp _wwwRe = RegExp(r'^www\.');

bool _isYouTubeId(String id) => _youTubeIdRe.hasMatch(id);

/// Parse a YouTube / Google Drive URL and return a safe embed URL + provider.
/// Returns null if the URL does not match any supported pattern.
EmbedResult? toEmbedUrl(String? url) {
  if (url == null || url.isEmpty) return null;

  final Uri parsed;
  try {
    parsed = Uri.parse(url.trim());
  } catch (_) {
    return null;
  }
  // JS `new URL()` requires an absolute URL with a host — mirror that.
  if (!parsed.hasScheme || parsed.host.isEmpty) return null;

  final host = parsed.host.replaceFirst(_wwwRe, '');

  // ── YouTube ────────────────────────────────────────────────────────────
  if (host == 'youtube.com') {
    // /watch?v=<id>
    final watchId = parsed.queryParameters['v'];
    if (parsed.path == '/watch' &&
        watchId != null &&
        _isYouTubeId(watchId)) {
      return EmbedResult(
        embedUrl: 'https://www.youtube.com/embed/$watchId',
        provider: VideoProvider.youtube,
      );
    }
    // /shorts/<id>
    final shortsMatch = _shortsRe.firstMatch(parsed.path);
    if (shortsMatch != null) {
      return EmbedResult(
        embedUrl: 'https://www.youtube.com/embed/${shortsMatch.group(1)}',
        provider: VideoProvider.youtube,
      );
    }
  }

  if (host == 'youtu.be') {
    final id = parsed.path.replaceFirst('/', '');
    if (_isYouTubeId(id)) {
      return EmbedResult(
        embedUrl: 'https://www.youtube.com/embed/$id',
        provider: VideoProvider.youtube,
      );
    }
  }

  // ── Google Drive ─────────────────────────────────────────────────────────
  if (host == 'drive.google.com') {
    final driveMatch = _driveRe.firstMatch(parsed.path);
    if (driveMatch != null) {
      return EmbedResult(
        embedUrl:
            'https://drive.google.com/file/d/${driveMatch.group(1)}/preview',
        provider: VideoProvider.drive,
      );
    }
  }

  return null;
}
