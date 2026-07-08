import 'package:flutter/material.dart';

import '../logic/streaks.dart';
import '../theme/app_theme.dart';

/// Compact daily-streak + weekly-goal card. Mirrors the web StreakCard.
/// Renders nothing when [stats] is null (matches the web's quiet failure).
class StreakCard extends StatelessWidget {
  const StreakCard({super.key, required this.stats});

  final StreakStats? stats;

  @override
  Widget build(BuildContext context) {
    final s = stats;
    if (s == null) return const SizedBox.shrink();

    final weekPct = s.weeklyGoal == 0
        ? 0.0
        : (s.thisWeekCount / s.weeklyGoal).clamp(0.0, 1.0);
    final active = s.currentStreak > 0;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            // Flame inside a diamond motif.
            SizedBox(
              width: 48,
              height: 48,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Transform.rotate(
                    angle: 0.785398, // 45°
                    child: Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(
                        color: AppColors.mint,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: active ? AppColors.accent : AppColors.line,
                        ),
                      ),
                    ),
                  ),
                  Icon(
                    Icons.local_fire_department,
                    size: 24,
                    color: active ? AppColors.accent : AppColors.muted,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text.rich(
                    TextSpan(
                      children: active
                          ? [
                              TextSpan(
                                text: '${s.currentStreak}-day streak',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.primary,
                                ),
                              ),
                              if (!s.activeToday)
                                const TextSpan(
                                  text:
                                      ' — finish a lesson today to keep it going',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: AppColors.muted,
                                  ),
                                ),
                            ]
                          : const [
                              TextSpan(
                                text: 'Start a streak today',
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.primary,
                                ),
                              ),
                              TextSpan(
                                text: ' — one lesson is all it takes',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: AppColors.muted,
                                ),
                              ),
                            ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(999),
                          child: LinearProgressIndicator(
                            value: weekPct.toDouble(),
                            minHeight: 6,
                            backgroundColor: AppColors.mint,
                            valueColor: const AlwaysStoppedAnimation(
                                AppColors.accent),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        '${s.thisWeekCount}/${s.weeklyGoal} lessons this week',
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.muted),
                      ),
                    ],
                  ),
                  if (s.longestStreak > s.currentStreak) ...[
                    const SizedBox(height: 4),
                    Text(
                      'Best: ${s.longestStreak} day${s.longestStreak == 1 ? '' : 's'}',
                      style:
                          const TextStyle(fontSize: 12, color: AppColors.muted),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
