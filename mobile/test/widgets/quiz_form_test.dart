// QuizForm — all-answered validation, pass/fail/retake via a fake callable,
// and per-question correctness sourced ONLY from the server response.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:andela_lms_mobile/models/assessment.dart';
import 'package:andela_lms_mobile/services/callable_service.dart';
import 'package:andela_lms_mobile/widgets/quiz_form.dart';

import '../support/fakes.dart';

final _assessment = Assessment(
  id: 'as1',
  courseId: 'c1',
  kind: AssessmentKind.quiz,
  lessonId: 'L1',
  title: 'Sample Quiz',
  passMark: 70,
  questions: const [
    AssessmentQuestion(
        id: 'q1', prompt: 'Prompt one', type: 'mcq', options: ['Alpha', 'Beta']),
    AssessmentQuestion(
        id: 'q2', prompt: 'Prompt two', type: 'mcq', options: ['Gamma', 'Delta']),
  ],
);

Future<void> _pump(WidgetTester tester, CallableService cs,
    {VoidCallback? onPassed}) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: SingleChildScrollView(
        child: QuizForm(
          assessment: _assessment,
          callable: cs,
          onPassed: onPassed,
        ),
      ),
    ),
  ));
}

void main() {
  testWidgets('blocks submit until every question is answered', (tester) async {
    final cs = FakeCallableService();
    await _pump(tester, cs);

    await tester.tap(find.text('Submit Answers'));
    await tester.pump();

    expect(find.text('Please answer all questions before submitting.'),
        findsOneWidget);
    expect(cs.gradeCalls, 0);
  });

  testWidgets('passing shows results, per-question from server, calls onPassed',
      (tester) async {
    final cs = FakeCallableService()
      ..gradeResult = const GradeAttemptResult(
        score: 1,
        total: 2,
        passed: true,
        perQuestion: {'q1': true, 'q2': false},
      );
    var passed = false;
    await _pump(tester, cs, onPassed: () => passed = true);

    await tester.tap(find.text('Alpha')); // q1
    await tester.pump();
    await tester.tap(find.text('Gamma')); // q2
    await tester.pump();
    await tester.tap(find.text('Submit Answers'));
    await tester.pumpAndSettle();

    expect(cs.gradeCalls, 1);
    expect(cs.lastAssessmentId, 'as1');
    expect(cs.lastDurationSec, isNotNull);
    expect(find.textContaining('Results'), findsOneWidget);
    // Server perQuestion drives the labels (q1 correct, q2 incorrect).
    expect(find.text('  ·  Correct'), findsOneWidget);
    expect(find.text('  ·  Incorrect'), findsOneWidget);
    expect(passed, isTrue);
  });

  testWidgets('failing offers Try Again (retake)', (tester) async {
    final cs = FakeCallableService()
      ..gradeResult = const GradeAttemptResult(
        score: 0,
        total: 2,
        passed: false,
        perQuestion: {'q1': false, 'q2': false},
      );
    await _pump(tester, cs);

    await tester.tap(find.text('Alpha'));
    await tester.pump();
    await tester.tap(find.text('Gamma'));
    await tester.pump();
    await tester.tap(find.text('Submit Answers'));
    await tester.pumpAndSettle();

    expect(find.text('Try Again'), findsOneWidget);

    await tester.tap(find.text('Try Again'));
    await tester.pumpAndSettle();
    // Back to the form.
    expect(find.text('Submit Answers'), findsOneWidget);
  });
}
