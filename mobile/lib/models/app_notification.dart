import 'package:cloud_firestore/cloud_firestore.dart';

/// notifications/{id}. Created ONLY by Cloud Functions. The owner may read
/// their own and mark them read (write ONLY the readAt field).
/// Doc shape: { userId, title, body, link, readAt: null | Timestamp, createdAt }
class AppNotification {
  final String id;
  final String userId;
  final String title;
  final String body;
  final String link;
  final DateTime? readAt;
  final DateTime? createdAt;

  const AppNotification({
    required this.id,
    required this.userId,
    required this.title,
    required this.body,
    required this.link,
    this.readAt,
    this.createdAt,
  });

  bool get isRead => readAt != null;

  factory AppNotification.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    final readAt = data['readAt'];
    final createdAt = data['createdAt'];
    return AppNotification(
      id: doc.id,
      userId: (data['userId'] ?? '') as String,
      title: (data['title'] ?? '') as String,
      body: (data['body'] ?? '') as String,
      link: (data['link'] ?? '') as String,
      readAt: readAt is Timestamp ? readAt.toDate() : null,
      createdAt: createdAt is Timestamp ? createdAt.toDate() : null,
    );
  }
}
