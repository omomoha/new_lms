import 'dart:async';

import 'package:flutter/foundation.dart';

import '../logic/forum_rules.dart';
import '../models/forum.dart';
import '../services/firestore_service.dart';
import '../util/offline.dart';

/// ForumThreadController (7B) — subscribes to a single thread doc + its posts
/// (both realtime), builds the chronological reply list, and owns all thread
/// actions: reply, edit (thread/post), delete, react, report. Mirrors the web
/// `/learn/forum/thread/[threadId]` page. Locked/pending/edit-window handling
/// is read-side; every write goes through the rules-scoped FirestoreService.
class ForumThreadController extends ChangeNotifier {
  ForumThreadController({
    required FirestoreService firestore,
    required this.threadId,
    required this.uid,
    required this.role,
    required this.displayName,
  }) : _fs = firestore;

  final FirestoreService _fs;
  final String threadId;
  final String uid;
  final String? role;

  /// <=100 char display name (caller resolves name || email prefix).
  final String displayName;

  bool _loading = true;
  String? _error;
  String? _actionError;
  bool _disposed = false;
  ForumThread? _thread;
  bool _threadLoaded = false;
  List<ForumPost> _posts = const [];

  StreamSubscription<ForumThread?>? _threadSub;
  StreamSubscription<List<ForumPost>>? _postsSub;

  bool get loading => _loading;
  String? get error => _error;
  String? get actionError => _actionError;
  ForumThread? get thread => _thread;
  bool get isSignedIn => uid.isNotEmpty;
  bool get isAdmin => canAdminister(role: role);

  /// Replies oldest-first (forum reply view is chronological). Reply-to-reply /
  /// orphans are irrelevant here because the web forum posts a flat reply list
  /// (parentId null); we still sort chronologically like the web.
  List<ForumPost> get posts => sortPostsChronological(_posts);

  bool canEditThread(int nowMillis) {
    final t = _thread;
    if (t == null) return false;
    return canEdit(
      viewerUid: uid,
      viewerRole: role,
      authorId: t.authorId,
      createdAtMillis: t.createdAtMillis,
      nowMillis: nowMillis,
    );
  }

  bool canDeleteThread() {
    final t = _thread;
    if (t == null) return false;
    return canModerate(viewerUid: uid, viewerRole: role, authorId: t.authorId);
  }

  bool canEditPost(ForumPost p, int nowMillis) => canEdit(
        viewerUid: uid,
        viewerRole: role,
        authorId: p.authorId,
        createdAtMillis: p.createdAtMillis,
        nowMillis: nowMillis,
      );

  bool canDeletePost(ForumPost p) =>
      canModerate(viewerUid: uid, viewerRole: role, authorId: p.authorId);

  bool reactedTo(ForumPost p, String emoji) =>
      isSignedIn && (p.reactions[emoji]?.contains(uid) ?? false);

  void start() {
    _loading = true;
    _error = null;
    _safeNotify();
    _threadSub = _fs.forumThreadStream(threadId).listen(
      (t) {
        _thread = t;
        _threadLoaded = true;
        if (t == null) _error = 'This thread no longer exists.';
        _maybeDoneLoading();
        _safeNotify();
      },
      onError: (Object err) {
        if (kDebugMode) debugPrint('ForumThreadController: thread err: $err');
        _error = 'Could not load this thread.';
        _loading = false;
        _safeNotify();
      },
    );
    _postsSub = _fs.forumPostsStream(threadId).listen(
      (p) {
        _posts = p;
        _maybeDoneLoading();
        _safeNotify();
      },
      onError: (Object err) {
        if (kDebugMode) debugPrint('ForumThreadController: posts err: $err');
        _error = 'Could not load replies.';
        _loading = false;
        _safeNotify();
      },
    );
  }

  void _maybeDoneLoading() {
    // First thread snapshot is enough to render; posts stream fills in.
    if (_threadLoaded) _loading = false;
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  Future<WriteOutcome> reply(String body, {String? parentId}) async {
    final trimmed = body.trim();
    if (trimmed.isEmpty || !isSignedIn) return WriteOutcome.failed;
    if (_thread?.locked == true) return WriteOutcome.failed; // read-side lockout
    _actionError = null;
    final outcome = await runOfflineAwareWrite(
      () => _fs.createForumReply(
        threadId: threadId,
        authorId: uid,
        authorName: displayName,
        body: trimmed,
        parentId: parentId,
      ),
    );
    if (outcome == WriteOutcome.failed) {
      _actionError = 'Could not post your reply. Please try again.';
      _safeNotify();
    }
    return outcome;
  }

  Future<WriteOutcome> saveThreadEdit(
      {required String title, required String body}) async {
    if (title.trim().isEmpty || body.trim().isEmpty) {
      return WriteOutcome.failed;
    }
    _actionError = null;
    final outcome = await runOfflineAwareWrite(
      () => _fs.editForumThread(id: threadId, title: title, body: body),
    );
    if (outcome == WriteOutcome.failed) {
      _actionError =
          'Could not save your edit (the edit window may have closed).';
      _safeNotify();
    }
    return outcome;
  }

  Future<WriteOutcome> savePostEdit(String postId, String body) async {
    if (body.trim().isEmpty) return WriteOutcome.failed;
    _actionError = null;
    final outcome = await runOfflineAwareWrite(
      () => _fs.editForumPost(threadId: threadId, postId: postId, body: body),
    );
    if (outcome == WriteOutcome.failed) {
      _actionError =
          'Could not save your edit (the edit window may have closed).';
      _safeNotify();
    }
    return outcome;
  }

  Future<WriteOutcome> deleteThread() async {
    _actionError = null;
    final outcome =
        await runOfflineAwareWrite(() => _fs.deleteForumThread(threadId));
    if (outcome == WriteOutcome.failed) {
      _actionError = 'Could not delete the thread.';
      _safeNotify();
    }
    return outcome;
  }

  Future<WriteOutcome> deletePost(String postId) async {
    _actionError = null;
    final outcome = await runOfflineAwareWrite(
        () => _fs.deleteForumPost(threadId, postId));
    if (outcome == WriteOutcome.failed) {
      _actionError = 'Could not delete the reply.';
      _safeNotify();
    }
    return outcome;
  }

  Future<void> react(String postId, String emoji) async {
    if (!isSignedIn) return;
    try {
      await _fs.toggleForumReaction(
        threadId: threadId,
        postId: postId,
        emoji: emoji,
        uid: uid,
      );
    } catch (err) {
      if (kDebugMode) debugPrint('ForumThreadController: react failed: $err');
    }
  }

  Future<WriteOutcome> report({String? postId, required String reason}) async {
    if (!isSignedIn || reason.trim().isEmpty) return WriteOutcome.failed;
    _actionError = null;
    final outcome = await runOfflineAwareWrite(
      () => _fs.reportForumContent(
        reporterId: uid,
        reporterName: displayName,
        threadId: threadId,
        postId: postId,
        reason: reason,
      ),
    );
    if (outcome == WriteOutcome.failed) {
      _actionError = 'Could not submit your report.';
      _safeNotify();
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
    _threadSub?.cancel();
    _postsSub?.cancel();
    super.dispose();
  }
}
