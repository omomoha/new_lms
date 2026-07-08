import 'package:cloud_functions/cloud_functions.dart';

/// A friendly, code-tagged error surfaced from a callable Cloud Function.
/// Mirrors how the web maps `FirebaseFunctionsException.code` to messages.
class CallableException implements Exception {
  /// The raw functions error code, e.g. "resource-exhausted".
  final String code;

  /// A learner-friendly message.
  final String message;

  const CallableException(this.code, this.message);

  @override
  String toString() => message;
}

// ── Typed responses ──────────────────────────────────────────────────────────

class GradeAttemptResult {
  final int score;
  final int total;
  final bool passed;

  /// { questionId: wasCorrect }. The ONLY correctness signal a learner ever
  /// sees — computed server-side.
  final Map<String, bool> perQuestion;

  const GradeAttemptResult({
    required this.score,
    required this.total,
    required this.passed,
    required this.perQuestion,
  });

  int get scorePct => total > 0 ? ((score / total) * 100).round() : 0;
}

class SignedVideoUrl {
  final String url;
  final int expiresAt; // epoch millis
  const SignedVideoUrl({required this.url, required this.expiresAt});
}

class IssueCertificateResult {
  final String certId;
  final String downloadUrl;
  const IssueCertificateResult({
    required this.certId,
    required this.downloadUrl,
  });
}

class LeaderboardRow {
  final String name;
  final int xp;
  final int lessonsCompleted;
  final int certificates;
  final bool isYou;

  const LeaderboardRow({
    required this.name,
    required this.xp,
    required this.lessonsCompleted,
    required this.certificates,
    required this.isYou,
  });
}

class LeaderboardResult {
  final String cohortName;
  final List<LeaderboardRow> rows;
  final bool truncated;

  const LeaderboardResult({
    required this.cohortName,
    required this.rows,
    required this.truncated,
  });
}

class GenerateFlashcardsResult {
  final int count;
  const GenerateFlashcardsResult({required this.count});
}

/// Thin, typed wrapper over the learner-facing callable Cloud Functions.
///
/// Region is fixed to `us-central1` (matches the web). Each call maps
/// [FirebaseFunctionsException] into a [CallableException] with a friendly
/// message. Client timeouts mirror the web (leaderboard 120s, flashcards 180s).
class CallableService {
  final FirebaseFunctions _functions;

  CallableService({FirebaseFunctions? functions})
      : _functions =
            functions ?? FirebaseFunctions.instanceFor(region: 'us-central1');

  // ── gradeAttempt ───────────────────────────────────────────────────────────
  Future<GradeAttemptResult> gradeAttempt({
    required String assessmentId,
    required Map<String, int> answers,
    int? durationSec,
  }) async {
    final data = await _call('gradeAttempt', {
      'assessmentId': assessmentId,
      'answers': answers,
      if (durationSec != null) 'durationSec': durationSec,
    });
    final rawPerQ = (data['perQuestion'] ?? const <String, dynamic>{}) as Map;
    return GradeAttemptResult(
      score: ((data['score'] ?? 0) as num).toInt(),
      total: ((data['total'] ?? 0) as num).toInt(),
      passed: (data['passed'] ?? false) as bool,
      perQuestion: {
        for (final entry in rawPerQ.entries)
          entry.key as String: entry.value == true,
      },
    );
  }

  // ── getSignedVideoUrl ────────────────────────────────────────────────────────
  Future<SignedVideoUrl> getSignedVideoUrl(String storagePath) async {
    final data = await _call('getSignedVideoUrl', {'storagePath': storagePath});
    return SignedVideoUrl(
      url: (data['url'] ?? '') as String,
      expiresAt: ((data['expiresAt'] ?? 0) as num).toInt(),
    );
  }

  // ── issueCertificate ─────────────────────────────────────────────────────────
  Future<IssueCertificateResult> issueCertificate(String courseId) async {
    final data = await _call('issueCertificate', {'courseId': courseId});
    return IssueCertificateResult(
      certId: (data['certId'] ?? '') as String,
      downloadUrl: (data['downloadUrl'] ?? '') as String,
    );
  }

  // ── getCohortLeaderboard ─────────────────────────────────────────────────────
  Future<LeaderboardResult> getCohortLeaderboard(String cohortId) async {
    final data = await _call(
      'getCohortLeaderboard',
      {'cohortId': cohortId},
      timeout: const Duration(milliseconds: 120000),
    );
    final rawRows = (data['rows'] ?? const <dynamic>[]) as List;
    return LeaderboardResult(
      cohortName: (data['cohortName'] ?? '') as String,
      truncated: (data['truncated'] ?? false) as bool,
      rows: rawRows.map((r) {
        final m = Map<String, dynamic>.from(r as Map);
        return LeaderboardRow(
          name: (m['name'] ?? '') as String,
          xp: ((m['xp'] ?? 0) as num).toInt(),
          lessonsCompleted: ((m['lessonsCompleted'] ?? 0) as num).toInt(),
          certificates: ((m['certificates'] ?? 0) as num).toInt(),
          isYou: (m['isYou'] ?? false) as bool,
        );
      }).toList(),
    );
  }

  // ── generateFlashcards ───────────────────────────────────────────────────────
  Future<GenerateFlashcardsResult> generateFlashcards(String courseId) async {
    final data = await _call(
      'generateFlashcards',
      {'courseId': courseId},
      // AI/conversion calls need longer than the default (web uses 180s).
      timeout: const Duration(milliseconds: 180000),
    );
    return GenerateFlashcardsResult(
      count: ((data['count'] ?? 0) as num).toInt(),
    );
  }

  // ── internals ────────────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> _call(
    String name,
    Map<String, dynamic> payload, {
    Duration? timeout,
  }) async {
    try {
      final callable = _functions.httpsCallable(
        name,
        options: timeout != null
            ? HttpsCallableOptions(timeout: timeout)
            : HttpsCallableOptions(),
      );
      final result = await callable.call<dynamic>(payload);
      final data = result.data;
      if (data is Map) return Map<String, dynamic>.from(data);
      return <String, dynamic>{};
    } on FirebaseFunctionsException catch (e) {
      throw CallableException(e.code, _friendly(e));
    }
  }

  String _friendly(FirebaseFunctionsException e) {
    switch (e.code) {
      case 'resource-exhausted':
        return e.message?.isNotEmpty == true
            ? e.message!
            : 'You have hit the rate limit — please try again in a little while.';
      case 'failed-precondition':
        // Server messages here are user-meaningful (e.g. "course not complete",
        // "not enough content") — surface them verbatim like the web does.
        return e.message?.isNotEmpty == true
            ? e.message!
            : 'This action is not available yet.';
      case 'permission-denied':
        return "You don't have access to that.";
      case 'unauthenticated':
        return 'Please sign in and try again.';
      case 'invalid-argument':
        return e.message?.isNotEmpty == true
            ? e.message!
            : 'That request was invalid.';
      case 'deadline-exceeded':
        return 'The request timed out. Please try again.';
      default:
        return e.message?.isNotEmpty == true
            ? e.message!
            : 'Something went wrong. Please try again.';
    }
  }
}
