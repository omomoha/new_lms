// GENERATED-STYLE PLACEHOLDER — REGENERATE BEFORE RUNNING.
//
// This file is normally produced by the FlutterFire CLI:
//
//   dart pub global activate flutterfire_cli
//   flutterfire configure --project=andela-lms-dae5f
//
// That command registers the Android/iOS apps in the Firebase project and
// writes the real API keys + app IDs here (and the native google-services.json
// / GoogleService-Info.plist files). The values below are placeholders so the
// project analyzes/structures correctly; the app will NOT connect to Firebase
// until you run `flutterfire configure`.
//
// The project id is fixed to the same backend the web portal uses.
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static const String projectId = 'andela-lms-dae5f';

  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError(
          'FirebaseOptions are not configured for this platform. '
          'Run `flutterfire configure` to generate them.',
        );
    }
  }

  // ---- PLACEHOLDERS — replaced by `flutterfire configure` ----
  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'REPLACE_ME_ANDROID_API_KEY',
    appId: 'REPLACE_ME_ANDROID_APP_ID',
    messagingSenderId: 'REPLACE_ME_SENDER_ID',
    projectId: projectId,
    storageBucket: '$projectId.appspot.com',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'REPLACE_ME_IOS_API_KEY',
    appId: 'REPLACE_ME_IOS_APP_ID',
    messagingSenderId: 'REPLACE_ME_SENDER_ID',
    projectId: projectId,
    storageBucket: '$projectId.appspot.com',
    iosBundleId: 'com.andela.lms.mobile',
  );

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'REPLACE_ME_WEB_API_KEY',
    appId: 'REPLACE_ME_WEB_APP_ID',
    messagingSenderId: 'REPLACE_ME_SENDER_ID',
    projectId: projectId,
    storageBucket: '$projectId.appspot.com',
    authDomain: '$projectId.firebaseapp.com',
  );
}
