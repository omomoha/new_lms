import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';

/// PLACEHOLDER — filled in Phase 4 (spaced-repetition flashcard review).
/// Body-only: the shell owns the AppBar.
class ReviewScreen extends StatelessWidget {
  const ReviewScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const _Placeholder(
      icon: Icons.style_outlined,
      title: 'Review',
      message: 'Spaced-repetition flashcards arrive in a later update.',
    );
  }
}

class _Placeholder extends StatelessWidget {
  const _Placeholder(
      {required this.icon, required this.title, required this.message});
  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: AppColors.muted),
            const SizedBox(height: 12),
            Text(title,
                style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink)),
            const SizedBox(height: 6),
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.muted)),
          ],
        ),
      ),
    );
  }
}
