import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';

/// PLACEHOLDER — filled in Phase 4 (XP/level/badges + cohort leaderboard).
/// Body-only: the shell owns the AppBar.
class AchievementsScreen extends StatelessWidget {
  const AchievementsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: const [
            Icon(Icons.emoji_events_outlined, size: 48, color: AppColors.muted),
            SizedBox(height: 12),
            Text('Achievements',
                style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink)),
            SizedBox(height: 6),
            Text('XP, badges and the cohort leaderboard arrive in a later update.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.muted)),
          ],
        ),
      ),
    );
  }
}
