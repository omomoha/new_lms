import 'package:cloud_firestore/cloud_firestore.dart';

/// certificates/{certId}. Written ONLY by the certificate Cloud Functions.
/// Single-doc `get` is public (the /verify/{certId} page); list is own-only.
class Certificate {
  final String certId;
  final String userId;
  final String learnerName;
  final String courseId;
  final String courseTitle;
  final DateTime? issuedAt;

  const Certificate({
    required this.certId,
    required this.userId,
    required this.learnerName,
    required this.courseId,
    required this.courseTitle,
    this.issuedAt,
  });

  factory Certificate.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    final issued = data['issuedAt'];
    return Certificate(
      // Prefer an explicit certId field; fall back to the doc id.
      certId: (data['certId'] ?? doc.id) as String,
      userId: (data['userId'] ?? '') as String,
      learnerName: (data['learnerName'] ?? '') as String,
      courseId: (data['courseId'] ?? '') as String,
      courseTitle: (data['courseTitle'] ?? '') as String,
      issuedAt: issued is Timestamp ? issued.toDate() : null,
    );
  }
}
