// TutorController tests (7A) — the observable behaviours the plan's acceptance
// criteria depend on:
//   * history trimmed to the last 8 turns before each askTutor call;
//   * request shape (courseId/question/history) forwarded to the callable;
//   * conversationId is NOT sent when tutorEnhancements is OFF, and IS reused
//     (append) once ON and a conversation exists;
//   * canRate gating: only ON + a conversationId enables thumbs;
//   * rate() writes tutorFeedback with the exact uid-prefixed id + shape;
//   * a CallableException surfaces on `error` (friendly message), non-fatal.
//
// Uses a recording fake CallableService (implements, so the real ctor that
// touches FirebaseFunctions is never invoked) + a real FirestoreService backed
// by fake_cloud_firestore so feedback writes are asserted against the DB.

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:andela_lms_mobile/models/tutor.dart';
import 'package:andela_lms_mobile/services/callable_service.dart';
import 'package:andela_lms_mobile/services/firestore_service.dart';
import 'package:andela_lms_mobile/state/tutor_controller.dart';

class _NoopStorage implements FirebaseStorage {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeCallable implements CallableService {
  int calls = 0;
  List<TutorTurn> lastHistory = const [];
  String? lastConversationId;
  String? lastQuestion;
  String? lastCourseId;
  CallableException? throwOnCall;
  String answer = 'ok';
  String conversationId = 'conv1';

  @override
  Future<AskTutorResult> askTutor({
    required String courseId,
    String? moduleId,
    String? lessonId,
    required String question,
    List<TutorTurn> history = const [],
    String? conversationId,
  }) async {
    calls++;
    lastCourseId = courseId;
    lastQuestion = question;
    lastHistory = history;
    lastConversationId = conversationId;
    if (throwOnCall != null) throw throwOnCall!;
    return AskTutorResult(answer: answer, conversationId: this.conversationId);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

FirestoreService _fs(FakeFirebaseFirestore db) =>
    FirestoreService(db: db, storage: _NoopStorage());

void main() {
  late FakeFirebaseFirestore db;
  late _FakeCallable callable;

  setUp(() {
    db = FakeFirebaseFirestore();
    callable = _FakeCallable();
  });

  TutorController make({bool enhanced = false}) => TutorController(
        callable: callable,
        firestore: _fs(db),
        courseId: 'c1',
        uid: 'u1',
        lessonId: 'l1',
        enhanced: enhanced,
      );

  test('send appends user + assistant turns and forwards request shape',
      () async {
    final c = make();
    await c.send('  What is X?  ');
    expect(callable.calls, 1);
    expect(callable.lastCourseId, 'c1');
    expect(callable.lastQuestion, 'What is X?'); // trimmed
    expect(c.messages.map((m) => m.role), ['user', 'assistant']);
    expect(c.messages[1].content, 'ok');
    expect(c.error, isNull);
  });

  test('history is trimmed to the last 8 turns before each call', () async {
    final c = make();
    // 5 sends → 10 messages accumulated; the 6th send must carry only 8 of them.
    for (var i = 0; i < 5; i++) {
      await c.send('q$i');
    }
    expect(c.messages, hasLength(10));
    await c.send('q5');
    expect(callable.lastHistory.length, 8);
  });

  group('conversationId gating (tutorEnhancements)', () {
    test('flag OFF: conversationId never sent nor retained', () async {
      final c = make(enhanced: false);
      await c.send('q1');
      expect(callable.lastConversationId, isNull);
      await c.send('q2');
      expect(callable.lastConversationId, isNull);
      expect(c.conversationId, isNull);
      expect(c.canRate, isFalse);
    });

    test('flag ON: first answer sets id, follow-up reuses it', () async {
      final c = make(enhanced: true);
      await c.send('q1');
      expect(callable.lastConversationId, isNull); // none yet on first call
      expect(c.conversationId, 'conv1');
      expect(c.canRate, isTrue);
      await c.send('q2');
      expect(callable.lastConversationId, 'conv1'); // appended
    });

    test('setEnhanced(true) after load flips canRate once an id exists',
        () async {
      final c = make(enhanced: false);
      await c.send('q1');
      expect(c.canRate, isFalse); // id not retained while OFF
      c.setEnhanced(true);
      // still no id (was never captured while OFF) → still cannot rate.
      expect(c.canRate, isFalse);
    });
  });

  group('rate() writes tutorFeedback', () {
    test('ON + id: writes uid-prefixed doc and reflects the choice', () async {
      final c = make(enhanced: true);
      await c.send('q1'); // captures conversationId = conv1
      await c.rate(1, 'up'); // index 1 = the assistant turn
      expect(c.feedback[1], 'up');
      final data =
          (await db.collection('tutorFeedback').doc('u1_conv1_1').get()).data()!;
      expect(data['userId'], 'u1');
      expect(data['rating'], 'up');
      expect(data['conversationId'], 'conv1');
      expect(data['turnIndex'], 1);
      expect(data['courseId'], 'c1');
    });

    test('OFF: rate is a no-op (no write, no feedback state)', () async {
      final c = make(enhanced: false);
      await c.send('q1');
      await c.rate(1, 'up');
      expect(c.feedback, isEmpty);
      expect((await db.collection('tutorFeedback').get()).docs, isEmpty);
    });
  });

  test('a CallableException surfaces on error (non-fatal, composer stays usable)',
      () async {
    final c = make();
    callable.throwOnCall = const CallableException(
        'resource-exhausted', 'You have hit the rate limit.');
    await c.send('q1');
    expect(c.error, 'You have hit the rate limit.');
    expect(c.sending, isFalse); // ready for another attempt
  });
}
