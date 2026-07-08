// ForumGate widget test — the feature-flag gate that fronts every forum screen
// AND mirrors the AppBar/Home entry-point gating: with `communityForum` OFF the
// forum is hidden behind a "not available yet" message; with it ON the child
// (the real forum content) renders. Also covers resolveForumName's fallbacks.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';

import 'package:andela_lms_mobile/services/feature_flags_service.dart';
import 'package:andela_lms_mobile/screens/forum/forum_gate.dart';

Future<void> _pump(WidgetTester tester, FeatureFlagsService flags) async {
  await tester.pumpWidget(
    Provider<FeatureFlagsService>.value(
      value: flags,
      child: const MaterialApp(
        home: Scaffold(
          body: ForumGate(child: Text('FORUM CONTENT')),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('flag OFF → shows "not available" and hides the child',
      (tester) async {
    final flags = FeatureFlagsService(db: FakeFirebaseFirestore());
    await _pump(tester, flags);
    expect(find.text('FORUM CONTENT'), findsNothing);
    expect(find.textContaining("isn't available yet"), findsOneWidget);
  });

  testWidgets('flag ON → renders the child', (tester) async {
    final db = FakeFirebaseFirestore();
    await db.collection('settings').doc('features').set({'communityForum': true});
    final flags = FeatureFlagsService(db: db);
    await _pump(tester, flags);
    expect(find.text('FORUM CONTENT'), findsOneWidget);
    expect(find.textContaining("isn't available yet"), findsNothing);
  });

  group('resolveForumName', () {
    test('prefers the name, then the email local-part, then Member', () {
      expect(resolveForumName('Ada Lovelace', 'ada@x.com'), 'Ada Lovelace');
      expect(resolveForumName('', 'ada@x.com'), 'ada');
      expect(resolveForumName(null, null), 'Member');
    });
    test('clamps to 100 chars', () {
      expect(resolveForumName('n' * 200, null).length, 100);
    });
  });
}
