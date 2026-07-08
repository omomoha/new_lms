import 'package:flutter/foundation.dart';

import '../models/app_user.dart';
import '../models/course.dart';
import '../models/flashcard.dart';
import '../services/callable_service.dart';
import '../services/firestore_service.dart';

/// Loads and holds the spaced-repetition review state — the mobile equivalent
/// of the loaders in `src/app/learn/review/page.tsx`.
///
/// Cards are loaded with a single `where(userId==uid)` query (no composite
/// index); due vs future is split client-side by `due`. The generate selector
/// lists the learner's accessible published courses.
class ReviewController extends ChangeNotifier {
  ReviewController({
    required FirestoreService firestore,
    required CallableService callable,
  })  : _fs = firestore,
        _callable = callable;

  final FirestoreService _fs;
  final CallableService _callable;

  bool _disposed = false;
  String? _uid;
  AppUser? _user;

  // Cards --------------------------------------------------------------------
  bool _loading = true;
  String? _loadError;
  List<Flashcard> _cards = const [];
  List<Flashcard> _dueCards = const [];
  DateTime? _nextDue;

  /// Bumped each reload so the review widget rebuilds a fresh session.
  int _sessionKey = 0;

  bool get loading => _loading;
  String? get loadError => _loadError;
  List<Flashcard> get cards => _cards;
  List<Flashcard> get dueCards => _dueCards;
  DateTime? get nextDue => _nextDue;
  int get sessionKey => _sessionKey;

  // Generate -----------------------------------------------------------------
  List<Course> _courses = const [];
  String? _selectedCourseId;
  bool _generating = false;
  String? _genError;
  String? _genSuccess;

  List<Course> get courses => _courses;
  String? get selectedCourseId => _selectedCourseId;
  bool get generating => _generating;
  String? get genError => _genError;
  String? get genSuccess => _genSuccess;

  void selectCourse(String id) {
    _selectedCourseId = id;
    _safeNotify();
  }

  Future<void> load(AppUser user) async {
    _uid = user.uid;
    _user = user;
    await Future.wait([_loadCards(), _loadCourses()]);
  }

  Future<void> _loadCards() async {
    final uid = _uid;
    if (uid == null) return;
    _loading = true;
    _loadError = null;
    _safeNotify();
    try {
      final all = await _fs.getUserFlashcards(uid);
      _cards = all;
      _recomputeDue();
      _sessionKey++;
    } catch (err) {
      if (kDebugMode) {
        debugPrint('ReviewController: failed to load flashcards: $err');
      }
      _loadError =
          "Couldn't load your flashcards. Please refresh and try again.";
    } finally {
      _loading = false;
      _safeNotify();
    }
  }

  void _recomputeDue() {
    final now = DateTime.now().millisecondsSinceEpoch;
    final withDue = _cards.toList();
    final due = withDue.where((c) => c.dueMillis <= now).toList()
      ..sort((a, b) => a.dueMillis.compareTo(b.dueMillis));
    final future = withDue.where((c) => c.dueMillis > now).toList()
      ..sort((a, b) => a.dueMillis.compareTo(b.dueMillis));
    _dueCards = due;
    _nextDue = future.isNotEmpty ? future.first.due : null;
  }

  Future<void> _loadCourses() async {
    final user = _user;
    if (user == null) return;
    try {
      final published = await _fs.getPublishedCourses();
      final myCohorts = user.cohortIds;
      final accessible = published.where((c) {
        if (user.isAdmin) return true;
        if (c.availability == 'all') return true;
        return c.assignedCohortIds.any(myCohorts.contains);
      }).toList();
      _courses = accessible;
      if (accessible.isNotEmpty) {
        _selectedCourseId ??= accessible.first.id;
      }
      _safeNotify();
    } catch (err) {
      if (kDebugMode) {
        debugPrint('ReviewController: failed to load courses: $err');
      }
      // Non-fatal: the generate selector simply stays empty.
    }
  }

  Future<void> generate() async {
    final courseId = _selectedCourseId;
    if (courseId == null || courseId.isEmpty) return;
    _generating = true;
    _genError = null;
    _genSuccess = null;
    _safeNotify();
    try {
      final res = await _callable.generateFlashcards(courseId);
      String title = 'this course';
      for (final c in _courses) {
        if (c.id == courseId) {
          title = c.title;
          break;
        }
      }
      _genSuccess =
          "Created ${res.count} cards for $title. They're due now — start reviewing!";
      await _loadCards();
    } on CallableException catch (e) {
      _genError = _mapGenError(e);
    } catch (_) {
      _genError = 'Something went wrong. Please try again.';
    } finally {
      _generating = false;
      _safeNotify();
    }
  }

  String _mapGenError(CallableException e) {
    switch (e.code) {
      case 'resource-exhausted':
        return "You've hit the hourly limit for flashcard generation — try again later.";
      case 'failed-precondition':
        // Server messages are user-meaningful (e.g. "not enough content").
        return e.message.isNotEmpty
            ? e.message
            : 'This action is not available yet.';
      case 'permission-denied':
        return "You don't have access to that course.";
      default:
        return 'Something went wrong. Please try again.';
    }
  }

  /// Persist a graded card's new scheduling state — writes ONLY the
  /// {interval,ease,reps,due} fields allowed by firestore.rules.
  Future<void> saveSchedule(
      String cardId, Map<String, dynamic> scheduleUpdate) {
    return _fs.updateFlashcardSchedule(cardId, scheduleUpdate);
  }

  Future<void> reload() => _loadCards();

  void _safeNotify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
