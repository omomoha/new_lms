import 'package:cloud_firestore/cloud_firestore.dart';

/// Mirrors `CourseModule` in src/types.ts.
/// Firestore path: courses/{courseId}/modules/{moduleId}
class CourseModule {
  final String id;
  final String title;
  final int order;
  final List<String> lessonOrder;

  const CourseModule({
    required this.id,
    required this.title,
    required this.order,
    required this.lessonOrder,
  });

  factory CourseModule.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    return CourseModule(
      id: doc.id,
      title: (data['title'] ?? '') as String,
      order: (data['order'] ?? 0) as int,
      lessonOrder:
          List<String>.from((data['lessonOrder'] ?? const <String>[]) as List),
    );
  }
}
