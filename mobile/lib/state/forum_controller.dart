import 'dart:async';

import 'package:flutter/foundation.dart';

import '../logic/forum_rules.dart';
import '../models/forum.dart';
import '../services/firestore_service.dart';

/// ForumHomeController (7B) — loads forum categories once and exposes the list
/// the viewer may see (visibility "all" + cohort-intersect), sorted by `order`.
/// Mirrors the web `/learn/forum` page.
class ForumHomeController extends ChangeNotifier {
  ForumHomeController({
    required FirestoreService firestore,
    required this.role,
    required this.cohortIds,
  }) : _fs = firestore;

  final FirestoreService _fs;
  final String? role;
  final List<String> cohortIds;

  bool _loading = true;
  String? _error;
  bool _disposed = false;
  List<ForumCategory> _all = const [];

  bool get loading => _loading;
  String? get error => _error;

  /// Visible + ordered categories for this viewer.
  List<ForumCategory> get categories =>
      visibleCategories(role: role, cohortIds: cohortIds, categories: _all);

  Future<void> load() async {
    _loading = true;
    _error = null;
    _safeNotify();
    try {
      _all = await _fs.fetchForumCategories();
      _loading = false;
      _safeNotify();
    } catch (err) {
      if (kDebugMode) debugPrint('ForumHomeController: load failed: $err');
      _error = 'Could not load the forum. Please try again.';
      _loading = false;
      _safeNotify();
    }
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

/// ForumCategoryController (7B) — subscribes to the threads in one category
/// (realtime, single equality filter), gates category access, hides pending
/// moderation for non-admins, and owns thread search + creation. Mirrors the
/// web `/learn/forum/category/[categoryId]` page.
class ForumCategoryController extends ChangeNotifier {
  ForumCategoryController({
    required FirestoreService firestore,
    required this.categoryId,
    required this.uid,
    required this.role,
    required this.cohortIds,
    required this.displayName,
  }) : _fs = firestore;

  final FirestoreService _fs;
  final String categoryId;
  final String uid;
  final String? role;
  final List<String> cohortIds;

  /// <=100 char display name (caller resolves name || email prefix).
  final String displayName;

  bool _loading = true;
  String? _error;
  bool _denied = false;
  bool _disposed = false;
  ForumCategory? _category;
  List<ForumThread> _rawThreads = const [];
  String _search = '';
  StreamSubscription<List<ForumThread>>? _sub;

  bool get loading => _loading;
  String? get error => _error;
  bool get denied => _denied;
  ForumCategory? get category => _category;
  String get search => _search;
  bool get isSignedIn => uid.isNotEmpty;

  /// Threads after: hide-pending (non-admin) → search → sort (pinned first,
  /// then last activity newest-first).
  List<ForumThread> get threads {
    final shown = visibleThreads(role: role, threads: _rawThreads);
    return sortThreads(searchThreads(shown, _search));
  }

  Future<void> start() async {
    _loading = true;
    _error = null;
    _denied = false;
    _safeNotify();
    try {
      final cat = await _fs.fetchForumCategory(categoryId);
      if (cat == null) {
        _error = 'This category no longer exists.';
        _loading = false;
        _safeNotify();
        return;
      }
      if (!canViewCategory(role: role, cohortIds: cohortIds, category: cat)) {
        _denied = true;
        _loading = false;
        _safeNotify();
        return;
      }
      _category = cat;
      _sub = _fs.forumThreadsStream(categoryId).listen(
        (t) {
          _rawThreads = t;
          _loading = false;
          _safeNotify();
        },
        onError: (Object err) {
          if (kDebugMode) {
            debugPrint('ForumCategoryController: subscribe failed: $err');
          }
          _error = 'Could not load threads. Please try again.';
          _loading = false;
          _safeNotify();
        },
      );
    } catch (err) {
      if (kDebugMode) debugPrint('ForumCategoryController: start failed: $err');
      _error = 'Could not load this category.';
      _loading = false;
      _safeNotify();
    }
  }

  void setSearch(String value) {
    _search = value;
    _safeNotify();
  }

  /// Create a thread; returns the new thread id (available even when queued
  /// offline) or null when not signed in / empty input.
  String? createThread({required String title, required String body}) {
    if (!isSignedIn) return null;
    if (title.trim().isEmpty || body.trim().isEmpty) return null;
    return _fs.createForumThread(
      categoryId: categoryId,
      authorId: uid,
      authorName: displayName,
      title: title,
      body: body,
    );
  }

  void _safeNotify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _sub?.cancel();
    super.dispose();
  }
}
