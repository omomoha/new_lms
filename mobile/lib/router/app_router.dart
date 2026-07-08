import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../state/auth_controller.dart';
import '../screens/splash_screen.dart';
import '../screens/auth/login_screen.dart';
import '../screens/auth/register_screen.dart';
import '../screens/auth/verify_email_screen.dart';
import '../screens/dashboard/home_screen.dart';
import '../screens/course/course_detail_screen.dart';
import '../screens/lesson/lesson_screen.dart';

GoRouter buildRouter(AuthController auth) {
  return GoRouter(
    initialLocation: '/',
    refreshListenable: auth,
    redirect: (context, state) {
      final status = auth.status;
      final loc = state.matchedLocation;

      final atSplash = loc == '/';
      final atAuth = loc == '/login' || loc == '/register';
      final atVerify = loc == '/verify';

      switch (status) {
        case AuthStatus.unknown:
          return atSplash ? null : '/';
        case AuthStatus.signedOut:
          return atAuth ? null : '/login';
        case AuthStatus.needsVerification:
          return atVerify ? null : '/verify';
        case AuthStatus.signedIn:
          if (atSplash || atAuth || atVerify) return '/home';
          return null;
      }
    },
    routes: [
      GoRoute(path: '/', builder: (_, __) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/register', builder: (_, __) => const RegisterScreen()),
      GoRoute(path: '/verify', builder: (_, __) => const VerifyEmailScreen()),
      GoRoute(path: '/home', builder: (_, __) => const HomeScreen()),
      GoRoute(
        path: '/course/:courseId',
        builder: (_, s) =>
            CourseDetailScreen(courseId: s.pathParameters['courseId']!),
      ),
      GoRoute(
        path: '/course/:courseId/lesson',
        builder: (_, s) {
          final extra = s.extra as LessonRouteArgs;
          return LessonScreen(args: extra);
        },
      ),
    ],
  );
}

/// Convenience: read the router off the current AuthController.
GoRouter routerOf(BuildContext context) =>
    buildRouter(context.read<AuthController>());
