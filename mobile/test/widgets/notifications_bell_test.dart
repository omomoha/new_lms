// NotificationsBell — unread badge count derived from the fake notifications
// stream, and "Mark all read" invoking the service with ONLY the unread ids
// (the service itself writes only readAt — proven in firestore_service_test).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:andela_lms_mobile/models/app_notification.dart';
import 'package:andela_lms_mobile/services/firestore_service.dart';
import 'package:andela_lms_mobile/widgets/notifications_bell.dart';

import '../support/fakes.dart';

AppNotification _note(String id, {required bool read}) => AppNotification(
      id: id,
      userId: 'u1',
      title: 'Note $id',
      body: '',
      link: '',
      readAt: read ? DateTime(2026, 1, 1) : null,
      createdAt: DateTime(2026, 1, 1, int.parse(id.replaceAll(RegExp('[^0-9]'), ''))),
    );

Future<void> _pump(WidgetTester tester, FakeFirestoreService fs) async {
  await tester.pumpWidget(
    Provider<FirestoreService>.value(
      value: fs,
      child: const MaterialApp(
        home: Scaffold(
          appBar: null,
          body: Center(child: NotificationsBell(uid: 'u1')),
        ),
      ),
    ),
  );
}

void main() {
  late FakeFirestoreService fs;

  setUp(() => fs = FakeFirestoreService());
  tearDown(() => fs.dispose());

  testWidgets('badge shows the unread count from the stream', (tester) async {
    await _pump(tester, fs);
    fs.emitNotifications([
      _note('1', read: false),
      _note('2', read: false),
      _note('3', read: true),
    ]);
    await tester.pump();

    expect(find.text('2'), findsOneWidget); // 2 unread
  });

  testWidgets('badge caps at 9+', (tester) async {
    await _pump(tester, fs);
    fs.emitNotifications([
      for (var i = 1; i <= 11; i++) _note('$i', read: false),
    ]);
    await tester.pump();

    expect(find.text('9+'), findsOneWidget);
  });

  testWidgets('no badge when everything is read', (tester) async {
    await _pump(tester, fs);
    fs.emitNotifications([_note('1', read: true)]);
    await tester.pump();

    // The only digit that could render is a badge; none should be present.
    expect(find.text('1'), findsNothing);
  });

  testWidgets('Mark all read invokes the service with only the unread ids',
      (tester) async {
    await _pump(tester, fs);
    fs.emitNotifications([
      _note('1', read: false),
      _note('2', read: false),
      _note('3', read: true),
    ]);
    await tester.pump();

    // Open the panel.
    await tester.tap(find.byType(IconButton));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Mark all read'));
    await tester.pumpAndSettle();

    expect(fs.markAllReadCalls, hasLength(1));
    expect(fs.markAllReadCalls.first.toSet(), {'1', '2'}); // read id excluded
  });
}
