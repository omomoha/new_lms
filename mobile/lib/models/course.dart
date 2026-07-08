import 'package:cloud_firestore/cloud_firestore.dart';

/// Mirrors `Course` in the web portal's src/types.ts.
/// Firestore path: courses/{courseId}
class Course {
  final String id;
  final String title;
  final String description;
  final String status; // "draft" | "published" | "archived"
  final List<String> moduleOrder;
  final List<String> assignedCohortIds;
  final String availability; // "cohorts" (default) | "all"
  final String? thumbPath;

  // Certificate template fields (Phase 3 on web) — used by certificate cards.
  final String? certTemplatePath;
  final String? certTemplateTextColor; // "dark" | "light"
  final String? certSignaturePath;
  final String? certSignatoryName;
  final String? certSignatoryTitle;

  const Course({
    required this.id,
    required this.title,
    required this.description,
    required this.status,
    required this.moduleOrder,
    required this.assignedCohortIds,
    required this.availability,
    this.thumbPath,
    this.certTemplatePath,
    this.certTemplateTextColor,
    this.certSignaturePath,
    this.certSignatoryName,
    this.certSignatoryTitle,
  });

  factory Course.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    return Course(
      id: doc.id,
      title: (data['title'] ?? '') as String,
      description: (data['description'] ?? '') as String,
      status: (data['status'] ?? 'draft') as String,
      moduleOrder:
          List<String>.from((data['moduleOrder'] ?? const <String>[]) as List),
      assignedCohortIds: List<String>.from(
          (data['assignedCohortIds'] ?? const <String>[]) as List),
      availability: (data['availability'] ?? 'cohorts') as String,
      thumbPath: data['thumbPath'] as String?,
      certTemplatePath: data['certTemplatePath'] as String?,
      certTemplateTextColor: data['certTemplateTextColor'] as String?,
      certSignaturePath: data['certSignaturePath'] as String?,
      certSignatoryName: data['certSignatoryName'] as String?,
      certSignatoryTitle: data['certSignatoryTitle'] as String?,
    );
  }

  /// Access rule mirrored from src/app/learn/page.tsx:
  /// availability == "all" OR the learner is in an assigned cohort.
  bool hasAccessFor(List<String> userCohortIds) {
    if (availability == 'all') return true;
    return assignedCohortIds.any(userCohortIds.contains);
  }
}

/// View-model that pairs a course with the learner's progress + access.
class CourseWithProgress {
  final Course course;
  final bool hasAccess;
  final double progressPct; // 0–100
  final String? lastLessonId;

  const CourseWithProgress({
    required this.course,
    required this.hasAccess,
    required this.progressPct,
    this.lastLessonId,
  });
}
