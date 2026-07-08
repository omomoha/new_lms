import 'package:flutter/foundation.dart';

import '../logic/discussions.dart';
import '../logic/threading.dart';
import '../models/discussion.dart';
import '../services/firestore_service.dart';
import '../util/offline.dart';

/// Loads and holds per-lesson discussion state (7C). Mirrors the web
/// `DiscussionPanel`: eager load via the two-equality query, single-level
/// threads, offline-aware create/delete, no edits (rules forbid updates).
class DiscussionController extends ChangeNotifier {
  DiscussionController({
    required FirestoreService firestore,
    required this.courseId,
    required this.lessonId,
    required this.uid,
    required this.role,
    required this.displayName,
  }) : _fs = firestore;

  final FirestoreService _fs;
  final String courseId;
  final String lessonId;
  final String uid;
  final String? role;

  /// ≤100 chars display name (caller resolves name || email prefix).
  final String displayName;

  bool _loading = true;
  String? _loadError;
  String? _actionError;
  bool _disposed = false;
  List<Discussion> _docs = const [];

  // getters -------------------------------------------------------------------
  bool get loading => _loading;
  String? get loadError => _loadError;
  String? get actionError => _actionError;

  /// Total post count (questions + replies) — shown in the collapsed header.
  int get count => _docs.length;

  List<Thread<Discussion>> get threads => buildThreads(_docs);

  bool get isSignedIn => uid.isNotEmpty;

  bool canDeletePost(Discussion post) =>
      canDelete(viewerUid: uid, viewerRole: role, post: post);

  Future<void> load() async {
    _loading = true;
    _loadError = null;
    _safeNotify();
    try {
      _docs = await _fs.fetchDiscussions(courseId, lessonId);
      _loading = false;
      _safeNotify();
    } catch (err) {
      if (kDebugMode) debugPrint('DiscussionController: load failed: $err');
      _loadError = 'Could not load the discussion. Please try again.';
      _loading = false;
      _safeNotify();
    }
  }

  /// Post a question ([parentId] null) or a reply. Offline-aware: a queued
  /// write is treated as success (the local cache already has it). Returns the
  /// outcome so the UI can show a "saved offline" affordance.
  Future<WriteOutcome> post(String body, {String? parentId}) async {
    final trimmed = body.trim();
    if (trimmed.isEmpty || !isSignedIn) return WriteOutcome.failed;
    _actionError = null;
    final outcome = await runOfflineAwareWrite(
      () => _fs.createDiscussion(
        courseId: courseId,
        lessonId: lessonId,
        uid: uid,
        userName: displayName,
        body: trimmed,
        parentId: parentId,
      ),
    );
    if (outcome == WriteOutcome.failed) {
      _actionError = parentId == null
          ? 'Could not post your question. Please try again.'
          : 'Could not post your reply. Please try again.';
      _safeNotify();
    } else {
      // Reload from cache (includes queued writes when offline).
      await load();
    }
    return outcome;
  }

  Future<WriteOutcome> delete(String id) async {
    _actionError = null;
    final outcome =
        await runOfflineAwareWrite(() => _fs.deleteDiscussion(id));
    if (outcome == WriteOutcome.failed) {
      _actionError = 'Could not delete the post. Please try again.';
      _safeNotify();
    } else {
      await load();
    }
    return outcome;
  }

  void clearActionError() {
    if (_actionError == null) return;
    _actionError = null;
    _safeNotify();
  }

  void _safeNotify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
