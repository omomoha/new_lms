// FlashcardReview — grading a card persists ONLY {interval, ease, reps, due}
// (the fields firestore.rules allows on a learner flashcard update).
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:andela_lms_mobile/models/flashcard.dart';
import 'package:andela_lms_mobile/widgets/flashcard_review.dart';

void main() {
  testWidgets('grade → save writes only the four scheduling fields',
      (tester) async {
    Map<String, dynamic>? saved;
    String? savedId;

    final card = Flashcard(
      id: 'card1',
      userId: 'u1',
      courseId: 'c1',
      front: 'Front side',
      back: 'Back side',
      interval: 0,
      ease: 2.5,
      reps: 0,
      due: DateTime.now(),
    );

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: FlashcardReview(
            cards: [card],
            onSave: (id, update) async {
              savedId = id;
              saved = update;
            },
          ),
        ),
      ),
    ));

    // Reveal then grade Good.
    await tester.tap(find.text('Show answer'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Good'));
    await tester.pumpAndSettle();

    expect(savedId, 'card1');
    expect(saved, isNotNull);
    expect(saved!.keys.toSet(), {'interval', 'ease', 'reps', 'due'});
    expect(saved!['due'], isA<Timestamp>());
    // First "good" on a fresh card graduates to a 1-day interval.
    expect(saved!['interval'], 1);
    expect(saved!['reps'], 1);

    // Session completes after the only card.
    expect(find.text('Session complete'), findsOneWidget);
  });
}
