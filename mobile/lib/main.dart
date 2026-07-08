import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:provider/provider.dart';

import 'firebase_options.dart';
import 'router/app_router.dart';
import 'services/firestore_service.dart';
import 'state/auth_controller.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
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
