import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:flutter/foundation.dart';

/// App Check activation — mirrors the web portal's `initAppCheck()`.
///
/// Web uses reCAPTCHA v3 (browser attestation). On mobile the platform-native
/// equivalents are Play Integrity (Android) and DeviceCheck (iOS). Under
/// [kDebugMode] we use the debug providers so the emulator/simulator can obtain
/// tokens (register the printed debug token in the Firebase console →
/// App Check → Manage debug tokens).
///
/// Callables only *enforce* App Check when `ENFORCE_APPCHECK=true` server-side
/// (currently false), so activation is best-effort: any failure is swallowed so
/// the app still launches and Firebase calls continue to work in monitoring
/// mode. Must be called AFTER `Firebase.initializeApp` and BEFORE other Firebase
/// service calls so early requests carry a token.
Future<void> activateAppCheck() async {
  try {
    await FirebaseAppCheck.instance.activate(
      androidProvider:
          kDebugMode ? AndroidProvider.debug : AndroidProvider.playIntegrity,
      appleProvider:
          kDebugMode ? AppleProvider.debug : AppleProvider.deviceCheck,
    );
  } catch (e) {
    // No-op safe: App Check must never block app startup. In monitoring mode a
    // missing token is tolerated by the backend.
    if (kDebugMode) {
      debugPrint('App Check activation failed (continuing without it): $e');
    }
  }
}
