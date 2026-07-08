import 'package:cloud_firestore/cloud_firestore.dart';

import '../logic/due_dates.dart';

/// Mirrors `Cohort` in src/types.ts. Firestore path: cohorts/{id}.
/// Readable only by members (cohortIds contains id) per firestore.rules.
class Cohort {
  final String id;
  final String name;
  final String tag;
  final String color;
  final List<String> courseIds;
  final String? thumbPath;

  /// Optional per-course due dates: { courseId: Timestamp }.
  final Map<String, Timestamp> courseDueDates;

  const Cohort({
    required this.id,
    required this.name,
    required this.tag,
    required this.color,
    required this.courseIds,
    this.thumbPath,
    this.courseDueDates = const {},
  });

  factory Cohort.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    final rawDue = data['courseDueDates'];
    final due = <String, Timestamp>{};
    if (rawDue is Map) {
      rawDue.forEach((key, value) {
        if (value is Timestamp) due[key as String] = value;
      });
    }
    return Cohort(
      id: doc.id,
      name: (data['name'] ?? '') as String,
      tag: (data['tag'] ?? '') as String,
      color: (data['color'] ?? '') as String,
      courseIds:
          List<String>.from((data['courseIds'] ?? const <String>[]) as List),
      thumbPath: data['thumbPath'] as String?,
      courseDueDates: due,
    );
  }

  /// Adapter into the Firebase-free due-date logic layer.
  DueDateCohort toDueDateCohort() => DueDateCohort(
        courseDueDates: {
          for (final entry in courseDueDates.entries)
            entry.key: _TimestampDue(entry.value),
        },
      );
}

/// Wraps a Firestore [Timestamp] as the logic layer's [DueTimestampLike].
class _TimestampDue implements DueTimestampLike {
  final Timestamp _ts;
  const _TimestampDue(this._ts);
  @override
  int toMillis() => _ts.millisecondsSinceEpoch;
}
