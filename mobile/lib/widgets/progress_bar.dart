import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Mirrors the web portal's ProgressBar component.
class ProgressBar extends StatelessWidget {
  const ProgressBar({super.key, required this.pct, this.showLabel = true});

  /// 0–100
  final double pct;
  final bool showLabel;

  @override
  Widget build(BuildContext context) {
    final clamped = pct.clamp(0, 100).toDouble();
    return Row(
      children: [
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: clamped / 100,
              minHeight: 8,
              backgroundColor: AppColors.line,
              valueColor: const AlwaysStoppedAnimation(AppColors.accent),
            ),
          ),
        ),
        if (showLabel) ...[
          const SizedBox(width: 8),
          Text(
            '${clamped.round()}%',
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.muted,
            ),
          ),
        ],
      ],
    );
  }
}
