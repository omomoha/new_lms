import 'package:cloud_firestore/cloud_firestore.dart';

/// Mirrors `LessonProgress` in src/types.ts.
/// Firestore path: progress/{userId}_{lessonId}
class LessonProgress {
  final String userId;
  final String lessonId;
  final String courseId;
  final double watchedPct; // 0–100
  final int positionSec; // resume position
  final DateTime? completedAt;

  const LessonProgress({
    required this.userId,
    required this.lessonId,
    required this.courseId,
    required this.watchedPct,
    required this.positionSec,
    this.completedAt,
  });

  bool get isCompleted => completedAt != null;

  static String docId(String userId, String lessonId) => '${userId}_$lessonId';

  factory LessonProgress.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    final ts = data['completedAt'];
    return LessonProgress(
      userId: (data['userId'] ?? '') as String,
      lessonId: (data['lessonId'] ?? '') as String,
      courseId: (data['courseId'] ?? '') as String,
      watchedPct: ((data['watchedPct'] ?? 0) as num).toDouble(),
      positionSec: ((data['positionSec'] ?? 0) as num).toInt(),
      completedAt: ts is Timestamp ? ts.toDate() : null,
    );
  }
}
