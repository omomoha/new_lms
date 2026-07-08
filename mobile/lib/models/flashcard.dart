import 'package:cloud_firestore/cloud_firestore.dart';

import '../logic/spaced_repetition.dart';

/// flashcards/{cardId}. Created/deleted ONLY by the generateFlashcards Cloud
/// Function. The owner may read them and update ONLY the scheduling fields
/// (interval/ease/reps/due) during review — enforced by firestore.rules.
class Flashcard {
  final String id;
  final String userId;
  final String courseId;
  final String? moduleId;
  final String front;
  final String back;
  final num interval;
  final num ease;
  final int reps;
  final DateTime? due;
  final DateTime? createdAt;

  const Flashcard({
    required this.id,
    required this.userId,
    required this.courseId,
    required this.front,
    required this.back,
    required this.interval,
    required this.ease,
    required this.reps,
    this.moduleId,
    this.due,
    this.createdAt,
  });

  int get dueMillis => due?.millisecondsSinceEpoch ?? 0;

  /// The card's current scheduling state, for the SM-2 logic layer.
  CardSchedule get schedule =>
      CardSchedule(interval: interval, ease: ease, reps: reps);

  factory Flashcard.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    final due = data['due'];
    final created = data['createdAt'];
    return Flashcard(
      id: doc.id,
      userId: (data['userId'] ?? '') as String,
      courseId: (data['courseId'] ?? '') as String,
      moduleId: data['moduleId'] as String?,
      front: (data['front'] ?? '') as String,
      back: (data['back'] ?? '') as String,
      interval: (data['interval'] ?? 0) as num,
      ease: (data['ease'] ?? kDefaultEase) as num,
      reps: ((data['reps'] ?? 0) as num).toInt(),
      due: due is Timestamp ? due.toDate() : null,
      createdAt: created is Timestamp ? created.toDate() : null,
    );
  }

  /// The ONLY fields a learner may write (firestore.rules restricts to these).
  static Map<String, dynamic> scheduleUpdate(ReviewResult r) => {
        'interval': r.interval,
        'ease': r.ease,
        'reps': r.reps,
        'due': Timestamp.fromDate(r.due),
      };
}
