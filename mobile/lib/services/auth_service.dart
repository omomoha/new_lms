import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/app_user.dart';

/// Thin wrapper over FirebaseAuth + the users/{uid} profile doc.
///
/// Mirrors the web portal's auth behaviour:
///  - email/password sign-in
///  - self sign-up creates a users/{uid} doc (role: learner)
///  - email verification is required for new self-signups
class AuthService {
  AuthService({FirebaseAuth? auth, FirebaseFirestore? db})
      : _auth = auth ?? FirebaseAuth.instance,
        _db = db ?? FirebaseFirestore.instance;

  final FirebaseAuth _auth;
  final FirebaseFirestore _db;

  User? get currentUser => _auth.currentUser;
  Stream<User?> authStateChanges() => _auth.authStateChanges();

  Future<UserCredential> signIn(String email, String password) {
    return _auth.signInWithEmailAndPassword(
      email: email.trim(),
      password: password,
    );
  }

  /// Creates the auth account, the users/{uid} profile doc, and sends a
  /// verification email — matching the web portal's self-signup flow.
  Future<UserCredential> register({
    required String name,
    required String email,
    required String password,
  }) async {
    final cred = await _auth.createUserWithEmailAndPassword(
      email: email.trim(),
      password: password,
    );
    final uid = cred.user!.uid;

    await _db.collection('users').doc(uid).set({
      'email': email.trim(),
      'name': name.trim(),
      'role': 'learner',
      'cohortIds': <String>[],
      'status': 'pending',
      'createdAt': FieldValue.serverTimestamp(),
    });

    await cred.user!.updateDisplayName(name.trim());
    await cred.user!.sendEmailVerification();
    return cred;
  }

  Future<void> sendVerificationEmail() async {
    await _auth.currentUser?.sendEmailVerification();
  }

  Future<void> sendPasswordReset(String email) {
    return _auth.sendPasswordResetEmail(email: email.trim());
  }

  Future<void> signOut() => _auth.signOut();

  /// Loads the users/{uid} profile document.
  Future<AppUser?> loadProfile(String uid) async {
    final snap = await _db.collection('users').doc(uid).get();
    if (!snap.exists) return null;
    return AppUser.fromDoc(snap);
  }
}
