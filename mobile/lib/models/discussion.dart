import 'package:cloud_firestore/cloud_firestore.dart';

import '../logic/threading.dart';

/// A `discussions/{id}` document (per-lesson Q&A), flattened for client use.
/// Implements [ThreadNode] so it can feed the shared single-level threading
/// helpers. Fields mirror the web `DiscussionDoc` + firestore.rules write shape:
/// `{ courseId, lessonId, userId, userName, body, parentId, createdAt }`.
class Discussion implements ThreadNode {
  @override
  final String id;
  final String courseId;
  final String lessonId;
  final String userId;
  final String userName;
  final String body;
  @override
  final String? parentId; // null = question, else the top-level doc id
  @override
  final int? createdAtMillis; // serverTimestamp().millis, or null while pending

  const Discussion({
    required this.id,
    required this.courseId,
    required this.lessonId,
    required this.userId,
    required this.userName,
    required this.body,
    required this.parentId,
    required this.createdAtMillis,
  });

  factory Discussion.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    final created = data['createdAt'];
    return Discussion(
      id: doc.id,
      courseId: data['courseId'] is String ? data['courseId'] as String : '',
      lessonId: data['lessonId'] is String ? data['lessonId'] as String : '',
      userId: data['userId'] is String ? data['userId'] as String : '',
      userName:
          data['userName'] is String ? data['userName'] as String : 'Learner',
      body: data['body'] is String ? data['body'] as String : '',
      parentId: data['parentId'] is String ? data['parentId'] as String : null,
      createdAtMillis:
          created is Timestamp ? created.millisecondsSinceEpoch : null,
    );
  }
}
