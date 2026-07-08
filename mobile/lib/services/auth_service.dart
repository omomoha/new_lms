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

  /// Self-service signup — matches src/contexts/AuthContext.tsx `register()`
  /// EXACTLY:
  ///   1. create the Auth user
  ///   2. updateProfile(displayName)
  ///   3. create users/{uid} with role:'learner', status:'active', cohortIds:[]
  ///   4. send the verification email (best-effort)
  ///   5. sign out — no session until the address is verified
  ///
  /// Returns whether the verification email was sent (mirrors the web's
  /// `{ verificationSent }`). Throws [FirebaseAuthException] on account-creation
  /// failures (weak password, email in use, ...).
  Future<bool> register({
    required String name,
    required String email,
    required String password,
  }) async {
    final cleanName = name.trim();
    final cleanEmail = email.trim();
    final cred = await _auth.createUserWithEmailAndPassword(
      email: cleanEmail,
      password: password,
    );
    final user = cred.user!;
    final uid = user.uid;

    await user.updateDisplayName(cleanName);

    // Field shape must match the web exactly for cross-platform account parity
    // (firestore.rules requires uid == the doc id and role == 'learner').
    await _db.collection('users').doc(uid).set({
      'uid': uid,
      'email': cleanEmail,
      'name': cleanName,
      'role': 'learner',
      'cohortIds': <String>[],
      'status': 'active',
      'createdAt': FieldValue.serverTimestamp(),
    });

    bool verificationSent = true;
    try {
      await user.sendEmailVerification();
    } catch (_) {
      verificationSent = false;
    }

    // No session until verified: sign straight out (mirrors the web flow).
    await _auth.signOut();
    return verificationSent;
  }

  Future<void> sendVerificationEmail() async {
    await _auth.currentUser?.sendEmailVerification();
  }

  Future<void> sendPasswordReset(String email) {
    return _auth.sendPasswordResetEmail(email: email.trim());
  }

  /// Change the signed-in user's password: reauthenticate with the current
  /// password (Firebase requires recent auth) then update.
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    final user = _auth.currentUser;
    if (user == null || user.email == null) {
      throw FirebaseAuthException(
        code: 'no-current-user',
        message: 'You must be signed in to change your password.',
      );
    }
    final credential = EmailAuthProvider.credential(
      email: user.email!,
      password: currentPassword,
    );
    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(newPassword);
  }

  /// Update the display name on both the Auth profile and users/{uid}.name.
  /// firestore.rules permits a learner to update ONLY the `name` field.
  Future<void> updateDisplayName(String name) async {
    final user = _auth.currentUser;
    if (user == null) return;
    final cleanName = name.trim();
    await user.updateDisplayName(cleanName);
    await _db.collection('users').doc(user.uid).update({'name': cleanName});
  }

  Future<void> signOut() => _auth.signOut();

  /// Loads the users/{uid} profile document.
  Future<AppUser?> loadProfile(String uid) async {
    final snap = await _db.collection('users').doc(uid).get();
    if (!snap.exists) return null;
    return AppUser.fromDoc(snap);
  }
}
