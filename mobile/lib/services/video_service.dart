import 'callable_service.dart';

/// Abstraction over video playback URL resolution — mirrors the web
/// `VideoService` interface. Kept thin so a future Mux/HLS implementation can
/// be swapped in without touching the lesson UI.
abstract class VideoService {
  /// Convert a storage path (Lesson.videoPath) into a playable URL.
  Future<String> getPlaybackUrl(String storagePath);
}

/// Default implementation: resolves a short-lived signed URL via the
/// `getSignedVideoUrl` callable (Storage denies direct `videos/**` reads).
///
/// URLs are cached in-memory and refreshed 5 minutes before expiry — a direct
/// port of the web's `SignedUrlVideoService`.
class SignedUrlVideoService implements VideoService {
  final CallableService _callable;
  final Map<String, SignedVideoUrl> _cache = {};

  static const int refreshMarginMs = 5 * 60 * 1000;

  SignedUrlVideoService({CallableService? callable})
      : _callable = callable ?? CallableService();

  @override
  Future<String> getPlaybackUrl(String storagePath) async {
    final cached = _cache[storagePath];
    final now = DateTime.now().millisecondsSinceEpoch;
    if (cached != null && cached.expiresAt - now > refreshMarginMs) {
      return cached.url;
    }
    final signed = await _callable.getSignedVideoUrl(storagePath);
    _cache[storagePath] = signed;
    return signed.url;
  }

  /// Clear cached URLs (e.g. on sign-out).
  void clearCache() => _cache.clear();
}
