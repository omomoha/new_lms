import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:provider/provider.dart';

import 'firebase_options.dart';
import 'router/app_router.dart';
import 'services/app_check.dart';
import 'services/firestore_service.dart';
import 'state/auth_controller.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  // Activate App Check BEFORE any other Firebase service call so early requests
  // carry an attestation token (best-effort — see services/app_check.dart).
  await activateAppCheck();

  // Enable Firestore offline persistence + cache-first reads (matches the
  // plan's offline/caching posture). Wrapped defensively: settings can only be
  // applied before the first Firestore use and must never crash startup.
  try {
    FirebaseFirestore.instance.settings = const Settings(
      persistenceEnabled: true,
      cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
    );
  } catch (_) {
    // Already configured / unsupported platform — ignore.
  }

  runApp(const AndelaLmsApp());
}

class AndelaLmsApp extends StatelessWidget {
  const AndelaLmsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthController()),
        Provider(create: (_) => FirestoreService()),
      ],
      child: Builder(
        builder: (context) {
          final auth = context.watch<AuthController>();
          final router = buildRouter(auth);
          return MaterialApp.router(
            title: 'Andela Learn',
            debugShowCheckedModeBanner: false,
            theme: AppTheme.light,
            routerConfig: router,
          );
        },
      ),
    );
  }
}
