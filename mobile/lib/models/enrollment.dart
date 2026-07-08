import 'package:cloud_firestore/cloud_firestore.dart';

/// Mirrors `Enrollment` in src/types.ts.
/// Firestore path: enrollments/{userId}_{courseId}
class Enrollment {
  final String userId;
  final String courseId;
  final String cohortId;
  final double progressPct; // 0–100
  final String? lastLessonId;
  final DateTime? updatedAt;

  const Enrollment({
    required this.userId,
    required this.courseId,
    required this.cohortId,
    required this.progressPct,
    this.lastLessonId,
    this.updatedAt,
  });

  static String docId(String userId, String courseId) => '${userId}_$courseId';

  int? get updatedAtMillis => updatedAt?.millisecondsSinceEpoch;

  factory Enrollment.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    final updated = data['updatedAt'];
    return Enrollment(
      userId: (data['userId'] ?? '') as String,
      courseId: (data['courseId'] ?? '') as String,
      cohortId: (data['cohortId'] ?? '') as String,
      progressPct: ((data['progressPct'] ?? 0) as num).toDouble(),
      lastLessonId: data['lastLessonId'] as String?,
      updatedAt: updated is Timestamp ? updated.toDate() : null,
    );
  }
}
