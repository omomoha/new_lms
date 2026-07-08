import 'package:flutter/foundation.dart';

import '../logic/gamification.dart';
import '../logic/streaks.dart';
import '../models/attempt.dart';
import '../models/certificate.dart';
import '../models/gamification_stats.dart';
import '../models/lesson_progress.dart';
import '../services/callable_service.dart';
import '../services/firestore_service.dart';

/// Loads and holds the achievements state — the mobile equivalent of the two
/// `useEffect` loaders in `src/app/learn/achievements/page.tsx`.
///
/// Personal stats are DERIVED client-side from data the learner can already
/// read (progress, passed attempts, certificates) via parallel single-field
/// `where(userId==uid)` queries — the `passed` filter is applied in Dart so no
/// composite index is needed. The leaderboard is server-aggregated because
/// learners cannot read each other's records directly.
class AchievementsController extends ChangeNotifier {
  AchievementsController({
    required FirestoreService firestore,
    required CallableService callable,
  })  : _fs = firestore,
        _callable = callable;

  final FirestoreService _fs;
  final CallableService _callable;

  bool _disposed = false;

  // Personal stats -----------------------------------------------------------
  GamificationSummary? _summary;
  String? _statsError;

  GamificationSummary? get summary => _summary;
  String? get statsError => _statsError;

  // Leaderboard --------------------------------------------------------------
  LeaderboardResult? _board;
  String? _boardCohort;
  bool _boardLoading = false;
  String? _boardError;
  List<String> _cohortIds = const [];

  LeaderboardResult? get board => _board;
  String? get boardCohort => _boardCohort;
  bool get boardLoading => _boardLoading;
  String? get boardError => _boardError;
  List<String> get cohortIds => _cohortIds;

  /// Load personal gamification stats + kick off the primary-cohort board.
  Future<void> load(String uid, List<String> cohortIds) async {
    _cohortIds = cohortIds;
    await _loadStats(uid);
    final first = cohortIds.isNotEmpty ? cohortIds.first : null;
    if (first != null) {
      _boardCohort = first;
      await loadBoard(first);
    }
  }

  Future<void> _loadStats(String uid) async {
    _statsError = null;
    _safeNotify();
    try {
      // Three parallel single-field queries (like the web's Promise.all).
      final progressF = _fs.getUserProgress(uid);
      final attemptsF = _fs.getUserAttempts(uid);
      final certsF = _fs.getUserCertificates(uid);
      final List<LessonProgress> progress = await progressF;
      final List<Attempt> attempts = await attemptsF;
      final List<Certificate> certs = await certsF;

      final completionDates = progress
          .map((p) => p.completedAt)
          .whereType<DateTime>()
          .toList();
      // passed==true filtered client-side (no composite index).
      final quizzesPassed = attempts.where((a) => a.passed).length;

      final streak = computeStreaks(completionDates, DateTime.now());
      final stats = GamificationStats(
        lessonsCompleted: completionDates.length,
        quizzesPassed: quizzesPassed,
        certificates: certs.length,
        streakDays: streak.currentStreak,
      );
      _summary = GamificationSummary.from(stats);
      _safeNotify();
    } catch (err) {
      if (kDebugMode) {
        debugPrint('AchievementsController: stats load failed: $err');
      }
      _statsError = 'Failed to load achievements.';
      _safeNotify();
    }
  }

  /// (Re)load the leaderboard for [cohortId]. Maps resource-exhausted to the
  /// web's rate-limit copy.
  Future<void> loadBoard(String cohortId) async {
    _boardCohort = cohortId;
    _boardLoading = true;
    _boardError = null;
    _safeNotify();
    try {
      _board = await _callable.getCohortLeaderboard(cohortId);
    } on CallableException catch (e) {
      _boardError = e.code == 'resource-exhausted'
          ? 'Leaderboard refreshed too often — try again in a little while.'
          : 'Could not load the leaderboard. Please try again.';
    } catch (_) {
      _boardError = 'Could not load the leaderboard. Please try again.';
    } finally {
      _boardLoading = false;
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
