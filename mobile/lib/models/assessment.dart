import 'package:cloud_firestore/cloud_firestore.dart';

/// Assessment kind. Mirrors `AssessmentKind` in src/types.ts.
enum AssessmentKind { pre, post, quiz, unknown }

AssessmentKind assessmentKindFrom(String? raw) {
  switch (raw) {
    case 'pre':
      return AssessmentKind.pre;
    case 'post':
      return AssessmentKind.post;
    case 'quiz':
      return AssessmentKind.quiz;
    default:
      return AssessmentKind.unknown;
  }
}

String assessmentKindToString(AssessmentKind kind) {
  switch (kind) {
    case AssessmentKind.pre:
      return 'pre';
    case AssessmentKind.post:
      return 'post';
    case AssessmentKind.quiz:
      return 'quiz';
    case AssessmentKind.unknown:
      return 'unknown';
  }
}

/// A single assessment question. NOTE: correct answers live in the
/// server-only `assessmentKeys` collection and are NEVER present here.
class AssessmentQuestion {
  final String id;
  final String prompt;
  final String type; // "mcq" | "tf"
  final List<String> options;

  const AssessmentQuestion({
    required this.id,
    required this.prompt,
    required this.type,
    required this.options,
  });

  factory AssessmentQuestion.fromMap(Map<String, dynamic> data) {
    return AssessmentQuestion(
      id: (data['id'] ?? '') as String,
      prompt: (data['prompt'] ?? '') as String,
      type: (data['type'] ?? 'mcq') as String,
      options:
          List<String>.from((data['options'] ?? const <String>[]) as List),
    );
  }
}

/// assessments/{id}. Questions only — no correct answers (rules deny
/// assessmentKeys reads to clients).
class Assessment {
  final String id;
  final String courseId;
  final AssessmentKind kind;
  final String? lessonId; // set when kind == quiz
  final String title;
  final int passMark; // 0–100
  final List<AssessmentQuestion> questions;

  const Assessment({
    required this.id,
    required this.courseId,
    required this.kind,
    required this.title,
    required this.passMark,
    required this.questions,
    this.lessonId,
  });

  factory Assessment.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    final rawQuestions = (data['questions'] ?? const <dynamic>[]) as List;
    return Assessment(
      id: doc.id,
      courseId: (data['courseId'] ?? '') as String,
      kind: assessmentKindFrom(data['kind'] as String?),
      lessonId: data['lessonId'] as String?,
      title: (data['title'] ?? '') as String,
      passMark: ((data['passMark'] ?? 0) as num).toInt(),
      questions: rawQuestions
          .map((q) => AssessmentQuestion.fromMap(Map<String, dynamic>.from(q)))
          .toList(),
    );
  }
}
