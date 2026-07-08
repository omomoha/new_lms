import 'package:cloud_firestore/cloud_firestore.dart';

/// FeatureFlagsService — reads the single admin-managed `settings/features`
/// Firestore doc ONCE, caches the booleans in memory, and exposes typed
/// getters. Mirrors the web `getFeatureFlag` (src/lib/featureFlags.ts):
/// a missing doc, missing key, or any read error resolves to `false`, so
/// half-built features never reach learners unless explicitly enabled.
///
/// Rules already allow any authed user to read `settings/features` (the
/// `settingId == "features"` exception), so this needs no special access.
/// Provided app-wide via a `Provider` in main.dart and read once so the tutor
/// panel / forum entry points don't each re-fetch (web re-reads per component;
/// mobile reads once and shares).
class FeatureFlagsService {
  FeatureFlagsService({FirebaseFirestore? db})
      : _db = db ?? FirebaseFirestore.instance;

  final FirebaseFirestore _db;

  /// Null until the first (successful or failed) load completes.
  Map<String, dynamic>? _cache;
  Future<void>? _loading;

  /// True once the flags have been loaded (or a load has failed → defaults).
  bool get isLoaded => _cache != null;

  /// Load the flags once. Concurrent callers share the same in-flight future,
  /// and repeat calls after a successful load are cheap no-ops.
  Future<void> ensureLoaded() => _loading ??= _load();

  Future<void> _load() async {
    try {
      final snap = await _db.collection('settings').doc('features').get();
      _cache = snap.exists ? (snap.data() ?? <String, dynamic>{}) : {};
    } catch (_) {
      // Default-off on any error — matches web getFeatureFlag's catch.
      _cache = {};
    }
  }

  bool _flag(String key) => _cache != null && _cache![key] == true;

  /// Tutor conversation persistence + answer feedback UI (Workstream A).
  bool get isTutorEnhancements => _flag('tutorEnhancements');

  /// Community forum: categories, threads, replies, moderation (Workstream B).
  bool get isCommunityForum => _flag('communityForum');

  /// Deeper analytics & reporting dashboard (Workstream D).
  bool get isAnalyticsDashboard => _flag('analyticsDashboard');

  /// Adaptive video via Mux/HLS (Workstream C).
  bool get isMuxVideo => _flag('muxVideo');
}
