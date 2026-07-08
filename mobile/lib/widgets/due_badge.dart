import 'package:flutter/material.dart';

import '../logic/due_dates.dart';
import '../theme/app_theme.dart';

/// Small pill showing a course's due-date status. Colour tone mirrors the web's
/// DUE_TONE_CLASSES (muted → mint, warn → amber, overdue → red).
class DueBadge extends StatelessWidget {
  const DueBadge({super.key, required this.info});

  final DueBadgeInfo info;

  @override
  Widget build(BuildContext context) {
    late final Color bg;
    late final Color fg;
    switch (info.tone) {
      case DueTone.muted:
        bg = AppColors.mint;
        fg = AppColors.primary;
        break;
      case DueTone.warn:
        bg = const Color(0xFFFEF3C7); // amber-100
        fg = const Color(0xFF92400E); // amber-800
        break;
      case DueTone.overdue:
        bg = const Color(0xFFFEE2E2); // red-100
        fg = const Color(0xFFB91C1C); // red-700
        break;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        info.label,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: fg),
      ),
    );
  }
}
