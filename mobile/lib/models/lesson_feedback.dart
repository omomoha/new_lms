import 'package:cloud_firestore/cloud_firestore.dart';

/// lessonFeedback/{uid_lessonId}. "Was this lesson helpful?" ratings.
/// The learner writes their own doc: rating int 1–5, comment string <= 1000.
class LessonFeedback {
  final String userId;
  final String lessonId;
  final int rating; // 1–5
  final String comment;
  final DateTime? updatedAt;

  const LessonFeedback({
    required this.userId,
    required this.lessonId,
    required this.rating,
    required this.comment,
    this.updatedAt,
  });

  static String docId(String userId, String lessonId) => '${userId}_$lessonId';

  factory LessonFeedback.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    final updated = data['updatedAt'];
    return LessonFeedback(
      userId: (data['userId'] ?? '') as String,
      lessonId: (data['lessonId'] ?? '') as String,
      rating: ((data['rating'] ?? 0) as num).toInt(),
      comment: (data['comment'] ?? '') as String,
      updatedAt: updated is Timestamp ? updated.toDate() : null,
    );
  }

  /// Payload matching the fields firestore.rules validates on write.
  Map<String, dynamic> toMap() => {
        'userId': userId,
        'lessonId': lessonId,
        'rating': rating,
        'comment': comment,
        'updatedAt': FieldValue.serverTimestamp(),
      };
}
