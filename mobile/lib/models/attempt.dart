import 'package:cloud_firestore/cloud_firestore.dart';

import 'assessment.dart';

/// attempts/{uid_assessmentId_uuid}. Written ONLY by the gradeAttempt Cloud
/// Function (admin SDK). Learners may read their own. Never written client-side.
class Attempt {
  final String id;
  final String userId;
  final String assessmentId;
  final String courseId;
  final AssessmentKind kind;
  final int score; // number of correct answers
  final int total; // total number of questions
  final bool passed;
  final DateTime? submittedAt;
  final int? durationSec;

  const Attempt({
    required this.id,
    required this.userId,
    required this.assessmentId,
    required this.courseId,
    required this.kind,
    required this.score,
    required this.total,
    required this.passed,
    this.submittedAt,
    this.durationSec,
  });

  int get scorePct => total > 0 ? ((score / total) * 100).round() : 0;

  factory Attempt.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    final submitted = data['submittedAt'];
    final duration = data['durationSec'];
    return Attempt(
      id: doc.id,
      userId: (data['userId'] ?? '') as String,
      assessmentId: (data['assessmentId'] ?? '') as String,
      courseId: (data['courseId'] ?? '') as String,
      kind: assessmentKindFrom(data['kind'] as String?),
      score: ((data['score'] ?? 0) as num).toInt(),
      total: ((data['total'] ?? 0) as num).toInt(),
      passed: (data['passed'] ?? false) as bool,
      submittedAt: submitted is Timestamp ? submitted.toDate() : null,
      durationSec: duration is num ? duration.toInt() : null,
    );
  }
}
