import 'package:cloud_firestore/cloud_firestore.dart';

enum LessonType { video, text, slides, doc, lab, quiz, unknown }

LessonType lessonTypeFrom(String? raw) {
  switch (raw) {
    case 'video':
      return LessonType.video;
    case 'text':
      return LessonType.text;
    case 'slides':
      return LessonType.slides;
    case 'doc':
      return LessonType.doc;
    case 'lab':
      return LessonType.lab;
    case 'quiz':
      return LessonType.quiz;
    default:
      return LessonType.unknown;
  }
}

/// Mirrors `Lesson` in src/types.ts.
/// Firestore path: courses/{courseId}/modules/{moduleId}/lessons/{lessonId}
class Lesson {
  final String id;
  final String title;
  final LessonType type;
  final int order;
  final String? videoUrl; // external (YouTube / Drive)
  final String? videoPath; // Storage path (needs signed URL) — not resolved here
  final String? textContent; // HTML/Markdown for text lessons
  final String? fileUrl; // slides/doc/lab download URL
  final String? filePath; // Storage path for resources
  final String? captionsPath; // Storage path to a WebVTT (.vtt) captions file
  final String? transcript;

  const Lesson({
    required this.id,
    required this.title,
    required this.type,
    required this.order,
    this.videoUrl,
    this.videoPath,
    this.textContent,
    this.fileUrl,
    this.filePath,
    this.captionsPath,
    this.transcript,
  });

  factory Lesson.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    return Lesson(
      id: doc.id,
      title: (data['title'] ?? '') as String,
      type: lessonTypeFrom(data['type'] as String?),
      order: (data['order'] ?? 0) as int,
      videoUrl: data['videoUrl'] as String?,
      videoPath: data['videoPath'] as String?,
      textContent: data['textContent'] as String?,
      fileUrl: data['fileUrl'] as String?,
      filePath: data['filePath'] as String?,
      captionsPath: data['captionsPath'] as String?,
      transcript: data['transcript'] as String?,
    );
  }
}
