import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../state/auth_controller.dart';
import '../../theme/app_theme.dart';

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
          // Notifications bell — placeholder until Phase 5 wires the live
          // notifications stream + unread badge.
          IconButton(
            tooltip: 'Notifications',
            icon: const Icon(Icons.notifications_none),
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                    content: Text('Notifications arrive in a later update.')),
              );
            },
          ),
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
