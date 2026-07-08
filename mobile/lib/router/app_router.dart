import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../state/auth_controller.dart';
import '../screens/splash_screen.dart';
import '../screens/auth/login_screen.dart';
import '../screens/auth/register_screen.dart';
import '../screens/auth/verify_email_screen.dart';
import '../screens/shell/app_shell.dart';
import '../screens/dashboard/home_screen.dart';
import '../screens/review/review_screen.dart';
import '../screens/achievements/achievements_screen.dart';
import '../screens/profile/profile_screen.dart';
import '../screens/course/course_detail_screen.dart';
import '../screens/lesson/lesson_screen.dart';
import '../screens/verify/verify_certificate_screen.dart';

final _rootNavigatorKey = GlobalKey<NavigatorState>();

GoRouter buildRouter(AuthController auth) {
  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: '/',
    refreshListenable: auth,
    redirect: (context, state) {
      final status = auth.status;
      final loc = state.matchedLocation;

      final atSplash = loc == '/';
      final atAuth = loc == '/login' || loc == '/register';
      final atVerifyEmail = loc == '/verify';
      // Public certificate verification (/verify/{certId}) is always reachable.
      final atPublicCert = loc.startsWith('/verify/');

      if (atPublicCert) return null;

      switch (status) {
        case AuthStatus.unknown:
          return atSplash ? null : '/';
        case AuthStatus.signedOut:
          return atAuth ? null : '/login';
        case AuthStatus.needsVerification:
          return atVerifyEmail ? null : '/verify';
        case AuthStatus.signedIn:
          if (atSplash || atAuth || atVerifyEmail) return '/home';
          return null;
      }
    },
    routes: [
      GoRoute(path: '/', builder: (_, __) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/register', builder: (_, __) => const RegisterScreen()),
      GoRoute(path: '/verify', builder: (_, __) => const VerifyEmailScreen()),

      // Public certificate verification — no auth required.
      GoRoute(
        path: '/verify/:certId',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (_, s) =>
            VerifyCertificateScreen(certId: s.pathParameters['certId']!),
      ),

      // Bottom-navigation shell (Home / Review / Achievements / Profile).
      StatefulShellRoute.indexedStack(
        builder: (_, __, navigationShell) =>
            AppShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: '/home', builder: (_, __) => const HomeScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/review', builder: (_, __) => const ReviewScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
                path: '/achievements',
                builder: (_, __) => const AchievementsScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
                path: '/profile', builder: (_, __) => const ProfileScreen()),
          ]),
        ],
      ),

      // Full-screen course + lesson (pushed on the root navigator).
      GoRoute(
        path: '/course/:courseId',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (_, s) =>
            CourseDetailScreen(courseId: s.pathParameters['courseId']!),
      ),
      GoRoute(
        path: '/course/:courseId/lesson/:lessonId',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (_, s) => LessonScreen(
          courseId: s.pathParameters['courseId']!,
          lessonId: s.pathParameters['lessonId']!,
        ),
      ),
    ],
  );
}

/// Convenience: read the router off the current AuthController.
GoRouter routerOf(BuildContext context) =>
    buildRouter(context.read<AuthController>());
