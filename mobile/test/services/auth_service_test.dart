// Account-parity tests: register must write the exact users/{uid} shape the
// web writes (status:'active', role:'learner', cohortIds:[]) and then sign the
// user out; the verification grandfather date must match AuthContext.tsx.
//
// Uses firebase_auth_mocks + fake_cloud_firestore (dev-only). If your installed
// firebase_auth_mocks version does not implement MockUser.updateDisplayName,
// update the pubspec pin — the AuthService code under test is unchanged.
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:andela_lms_mobile/services/auth_service.dart';
import 'package:andela_lms_mobile/state/auth_controller.dart';

void main() {
  group('AuthService.register — web account parity', () {
    test('writes users/{uid} with status:active, role:learner, cohortIds:[]',
        () async {
      final mockUser = MockUser(
        uid: 'uid-new',
        email: 'ada@x.com',
        displayName: '',
        isEmailVerified: false,
      );
      final auth = MockFirebaseAuth(mockUser: mockUser, signedIn: false);
      final db = FakeFirebaseFirestore();
      final svc = AuthService(auth: auth, db: db);

      final sent = await svc.register(
        name: 'Ada Lovelace',
        email: 'ada@x.com',
        password: 'sup3rsecret',
      );
      expect(sent, isTrue); // verification email "sent"

      final snap = await db.collection('users').doc('uid-new').get();
      expect(snap.exists, isTrue);
      final data = snap.data()!;
      expect(data['uid'], 'uid-new');
      expect(data['email'], 'ada@x.com');
      expect(data['name'], 'Ada Lovelace');
      expect(data['role'], 'learner');
      expect(data['status'], 'active'); // NOT 'pending' — key parity fix
      expect(data['cohortIds'], isEmpty);
      expect(data.containsKey('createdAt'), isTrue);
    });

    test('signs the user out after registration (no session until verified)',
        () async {
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u2', email: 'b@x.com'),
        signedIn: true,
      );
      final svc = AuthService(auth: auth, db: FakeFirebaseFirestore());
      await svc.register(name: 'Bo', email: 'b@x.com', password: 'pw123456');
      expect(auth.currentUser, isNull);
    });
  });

  group('verification grandfather date parity', () {
    test('matches AuthContext.tsx VERIFICATION_ENFORCED_FROM (2026-06-11Z)', () {
      expect(
        AuthController.verificationEnforcedFrom,
        DateTime.utc(2026, 6, 11, 0, 0, 0),
      );
    });
  });
}
