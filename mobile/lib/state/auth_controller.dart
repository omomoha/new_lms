import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import '../models/app_user.dart';
import '../services/auth_service.dart';

enum AuthStatus { unknown, signedOut, needsVerification, signedIn }

/// App-wide auth state. Exposed via provider and consumed by the router's
/// redirect logic and the UI.
class AuthController extends ChangeNotifier {
  AuthController({AuthService? service}) : _service = service ?? AuthService() {
    _sub = _service.authStateChanges().listen(_onAuthChanged);
  }

  final AuthService _service;
  late final StreamSubscription<User?> _sub;

  AuthStatus _status = AuthStatus.unknown;
  AppUser? _profile;
  User? _firebaseUser;
  String? _error;

  AuthStatus get status => _status;
  AppUser? get profile => _profile;
  User? get firebaseUser => _firebaseUser;
  String? get error => _error;

  Future<void> _onAuthChanged(User? user) async {
    _firebaseUser = user;
    if (user == null) {
      _profile = null;
      _status = AuthStatus.signedOut;
      notifyListeners();
      return;
    }

    // Email verification gate (matches web self-signup requirement).
    if (!user.emailVerified) {
      _status = AuthStatus.needsVerification;
      notifyListeners();
      return;
    }

    _profile = await _service.loadProfile(user.uid);
    _status = AuthStatus.signedIn;
    notifyListeners();
  }

  Future<bool> signIn(String email, String password) async {
    _error = null;
    try {
      await _service.signIn(email, password);
      return true;
    } on FirebaseAuthException catch (e) {
      _error = _friendly(e);
      notifyListeners();
      return false;
    }
  }

  Future<bool> register({
    required String name,
    required String email,
    required String password,
  }) async {
    _error = null;
    try {
      await _service.register(name: name, email: email, password: password);
      return true;
    } on FirebaseAuthException catch (e) {
      _error = _friendly(e);
      notifyListeners();
      return false;
    }
  }

  Future<void> resendVerification() => _service.sendVerificationEmail();

  Future<bool> sendPasswordReset(String email) async {
    _error = null;
    try {
      await _service.sendPasswordReset(email);
      return true;
    } on FirebaseAuthException catch (e) {
      _error = _friendly(e);
      notifyListeners();
      return false;
    }
  }

  /// Re-checks emailVerified after the user confirms via email.
  Future<void> refreshVerification() async {
    await _firebaseUser?.reload();
    await _onAuthChanged(FirebaseAuth.instance.currentUser);
  }

  Future<void> signOut() => _service.signOut();

  String _friendly(FirebaseAuthException e) {
    switch (e.code) {
      case 'invalid-email':
        return 'That email address looks invalid.';
      case 'user-disabled':
        return 'This account has been disabled.';
      case 'user-not-found':
      case 'wrong-password':
      case 'invalid-credential':
        return 'Incorrect email or password.';
      case 'email-already-in-use':
        return 'An account already exists for that email.';
      case 'weak-password':
        return 'Please choose a stronger password (min 6 characters).';
      case 'too-many-requests':
        return 'Too many attempts. Please try again later.';
      default:
        return e.message ?? 'Something went wrong. Please try again.';
    }
  }

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}
