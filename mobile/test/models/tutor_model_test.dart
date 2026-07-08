// Tutor model tests (7A): AskTutorResult field holding, TutorTurn.toHistoryMap
// (the minimal {role,content} shape sent as history), and
// TutorConversation.fromDoc's normalizeTurns coercion (only user/assistant roles
// with string content survive) — mirrors the web normalizeTurns.

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/models/tutor.dart';

void main() {
  test('AskTutorResult holds answer + conversationId', () {
    const r = AskTutorResult(answer: 'hi', conversationId: 'c1');
    expect(r.answer, 'hi');
    expect(r.conversationId, 'c1');
  });

  test('TutorTurn.toHistoryMap emits only {role, content}', () {
    const t = TutorTurn(role: 'user', content: 'q', at: 123);
    expect(t.toHistoryMap(), {'role': 'user', 'content': 'q'});
    expect(t.isUser, isTrue);
    expect(t.isAssistant, isFalse);
  });

  group('TutorConversation.fromDoc normalizeTurns', () {
    test('keeps only valid user/assistant string turns; drops junk', () async {
      final db = FakeFirebaseFirestore();
      await db
          .collection('users')
          .doc('u1')
          .collection('tutorConversations')
          .doc('k')
          .set({
        'title': 'T',
        'courseId': 'c1',
        'turns': [
          {'role': 'user', 'content': 'a', 'at': 1},
          {'role': 'assistant', 'content': 'b'},
          {'role': 'system', 'content': 'nope'}, // bad role → dropped
          {'role': 'user', 'content': 42}, // non-string → dropped
          'not a map', // → dropped
        ],
      });
      final doc = await db
          .collection('users')
          .doc('u1')
          .collection('tutorConversations')
          .doc('k')
          .get();
      final conv = TutorConversation.fromDoc(doc);
      expect(conv.title, 'T');
      expect(conv.courseId, 'c1');
      expect(conv.turns.map((t) => t.role), ['user', 'assistant']);
      expect(conv.turns.map((t) => t.content), ['a', 'b']);
    });

    test('missing turns → empty list', () async {
      final db = FakeFirebaseFirestore();
      await db
          .collection('users')
          .doc('u1')
          .collection('tutorConversations')
          .doc('k')
          .set({'title': 'T'});
      final doc = await db
          .collection('users')
          .doc('u1')
          .collection('tutorConversations')
          .doc('k')
          .get();
      expect(TutorConversation.fromDoc(doc).turns, isEmpty);
    });
  });
}
