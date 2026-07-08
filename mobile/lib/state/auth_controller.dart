import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import '../models/app_user.dart';
import '../services/auth_service.dart';

enum AuthStatus { unknown, signedOut, needsVerification, signedIn }

/// App-wide auth state. Exposed via provider and consumed by the router's
/// redirect logic and the UI.
///
/// Ports the web's src/contexts/AuthContext.tsx account logic:
///  - role resolved from the JWT custom claim `role`, falling back to the
///    Firestore users/{uid}.role field;
///  - email-verification gate enforced ONLY for accounts created on/after
///    [verificationEnforcedFrom] (older accounts are grandfathered);
///  - force sign-out when users/{uid}.status == 'inactive'.
class AuthController extends ChangeNotifier {
  AuthController({AuthService? service}) : _service = service ?? AuthService() {
    _sub = _service.authStateChanges().listen(_onAuthChanged);
  }

  final AuthService _service;
  late final StreamSubscription<User?> _sub;

  /// Email verification is enforced only for accounts created ON/AFTER this
  /// instant (when the feature shipped on web). Older accounts are grandfathered.
  /// MUST stay identical to AuthContext.tsx's VERIFICATION_ENFORCED_FROM.
  static final DateTime verificationEnforcedFrom =
      DateTime.utc(2026, 6, 11, 0, 0, 0);

  AuthStatus _status = AuthStatus.unknown;
  AppUser? _profile;
  User? _firebaseUser;
  String? _error;

  AuthStatus get status => _status;
  AppUser? get profile => _profile;
  User? get firebaseUser => _firebaseUser;
  String? get error => _error;

  /// True when the current Firebase user must verify their email before a
  /// session is granted (created on/after the enforcement date, not verified).
  bool _mustVerify(User user) {
    if (user.emailVerified) return false;
    final created = user.metadata.creationTime;
    if (created == null) return false;
    final createdUtc = created.toUtc();
    // created >= verificationEnforcedFrom
    return !createdUtc.isBefore(verificationEnforcedFrom);
  }

  Future<void> _onAuthChanged(User? user) async {
    _firebaseUser = user;
    if (user == null) {
      _profile = null;
      _status = AuthStatus.signedOut;
      notifyListeners();
      return;
    }

    // Verification gate (grandfather rule). New unverified accounts land on the
    // verify screen with no session; grandfathered ones proceed.
    if (_mustVerify(user)) {
      _profile = null;
      _status = AuthStatus.needsVerification;
      notifyListeners();
      return;
    }

    try {
      // JWT custom claim is the authoritative role source (force=false uses the
      // cached token to avoid an unnecessary round-trip).
      final tokenResult = await user.getIdTokenResult();
      final claimRole = tokenResult.claims?['role'] as String?;

      final profile = await _service.loadProfile(user.uid);

      if (profile != null) {
        // Paused accounts: force the session out as soon as status is visible.
        if (profile.status == 'inactive') {
          await _service.signOut();
          _profile = null;
          // authStateChanges will fire null → signedOut.
          return;
        }
        // Claim role wins; fall back to the Firestore doc role.
        _profile =
            claimRole != null ? profile.copyWith(role: claimRole) : profile;
      } else if (claimRole != null) {
        // Doc not readable yet (race during onboarding) — surface the claim role.
        _profile = AppUser(
          uid: user.uid,
          email: user.email ?? '',
          name: user.displayName ?? '',
          role: claimRole,
          cohortIds: const [],
          status: 'pending',
        );
      } else {
        _profile = null;
      }
      _status = AuthStatus.signedIn;
      notifyListeners();
    } catch (err) {
      if (kDebugMode) {
        debugPrint('AuthController: failed to load user profile: $err');
      }
      _profile = null;
      // Still consider the user signed in (matches web: user set, appUser null),
      // so the router doesn't bounce them to login on a transient read failure.
      _status = AuthStatus.signedIn;
      notifyListeners();
    }
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

  /// Registers a new learner. On success the account is created and a
  /// verification email is sent, then the user is signed OUT (matching web) —
  /// they must verify then sign in. Returns true on success.
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

  Future<bool> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    _error = null;
    try {
      await _service.changePassword(
        currentPassword: currentPassword,
        newPassword: newPassword,
      );
      return true;
    } on FirebaseAuthException catch (e) {
      _error = _friendly(e);
      notifyListeners();
      return false;
    }
  }

  Future<bool> updateDisplayName(String name) async {
    _error = null;
    try {
      await _service.updateDisplayName(name);
      // Reflect the new name locally without a full reload.
      if (_profile != null) {
        _profile = _profile!.copyWith(name: name.trim());
      }
      notifyListeners();
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
      case 'requires-recent-login':
        return 'Please sign in again to complete this change.';
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
