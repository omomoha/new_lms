import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../services/feature_flags_service.dart';
import '../../state/auth_controller.dart';
import '../../theme/app_theme.dart';
import '../../widgets/notifications_bell.dart';

/// Bottom-navigation shell hosting the four learner tabs (Home, Review,
/// Achievements, Profile). Course/lesson/verify screens are pushed full-screen
/// on top of this shell. The AppBar carries the brand, a notifications bell
/// (placeholder until Phase 5) and sign-out.
///
/// Built on go_router's [StatefulNavigationShell] so each tab keeps its own
/// navigation state and later phases (Review/Achievements/Profile) slot in.
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  static const _titles = ['Home', 'Review', 'Achievements', 'Profile'];

  @override
  Widget build(BuildContext context) {
    final index = navigationShell.currentIndex;
    final uid = context.select<AuthController, String?>(
        (a) => a.profile?.uid ?? a.firebaseUser?.uid);
    return Scaffold(
      appBar: AppBar(
        title: const Text.rich(
          TextSpan(children: [
            TextSpan(
                text: 'Andela ',
                style: TextStyle(
                    color: AppColors.accent, fontWeight: FontWeight.w800)),
            TextSpan(
                text: 'LMS',
                style: TextStyle(
                    color: Colors.white, fontWeight: FontWeight.w300)),
          ]),
        ),
        actions: [
          // Community forum entry point (Phase 7B) — only shown when the
          // `communityForum` feature flag is ON (matches the web gating). The
          // shared FeatureFlagsService caches settings/features after one read.
          const _ForumAppBarAction(),
          // Live notifications bell (stream + unread badge + mark-read).
          if (uid != null) NotificationsBell(uid: uid),
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => context.read<AuthController>().signOut(),
          ),
        ],
      ),
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => navigationShell.goBranch(
          i,
          initialLocation: i == navigationShell.currentIndex,
        ),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.school_outlined),
            selectedIcon: Icon(Icons.school),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.style_outlined),
            selectedIcon: Icon(Icons.style),
            label: 'Review',
          ),
          NavigationDestination(
            icon: Icon(Icons.emoji_events_outlined),
            selectedIcon: Icon(Icons.emoji_events),
            label: 'Achievements',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Profile',
          ),
        ],
      ),
    );
  }

  static String titleFor(int index) => _titles[index];
}

/// AppBar action linking to the community forum. Renders nothing until the
/// feature-flag service has loaded, and stays empty when `communityForum` is
/// OFF — so the entry point never appears for a disabled feature.
class _ForumAppBarAction extends StatelessWidget {
  const _ForumAppBarAction();

  @override
  Widget build(BuildContext context) {
    final flags = context.read<FeatureFlagsService>();
    return FutureBuilder<void>(
      future: flags.ensureLoaded(),
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done ||
            !flags.isCommunityForum) {
          return const SizedBox.shrink();
        }
        return IconButton(
          tooltip: 'Community forum',
          icon: const Icon(Icons.forum_outlined),
          onPressed: () => context.push('/forum'),
        );
      },
    );
  }
}
