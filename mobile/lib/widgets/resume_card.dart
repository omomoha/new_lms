import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../logic/resume.dart';
import '../state/dashboard_controller.dart';
import '../theme/app_theme.dart';
import 'progress_bar.dart';

/// Prominent "Continue learning" CTA at the top of the dashboard. Mirrors the
/// web ResumeCard: linking to the most recently-touched in-progress course.
class ResumeCard extends StatelessWidget {
  const ResumeCard({
    super.key,
    required this.selection,
    required this.thumbUrl,
    this.onTap,
  });

  final ResumeSelection<DashboardCourse> selection;
  final String? thumbUrl;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final course = selection.course;
    final label = selection.basis == ResumeBasis.recency
        ? 'Continue learning'
        : 'Pick up where you left off';
    final pct = course.progressPctInt;

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Accent left border.
              Container(width: 4, color: AppColors.accent),
              _Thumb(url: thumbUrl, title: course.title),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        label.toUpperCase(),
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.5,
                          color: AppColors.teal,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        course.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                          color: AppColors.ink,
                        ),
                      ),
                      if ((course.description ?? '').isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          course.description!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 13, color: AppColors.muted),
                        ),
                      ],
                      const SizedBox(height: 10),
                      ProgressBar(pct: pct.toDouble()),
                    ],
                  ),
                ),
              ),
              const Padding(
                padding: EdgeInsets.only(right: 14),
                child: Icon(Icons.arrow_forward, color: AppColors.teal),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.url, required this.title});
  final String? url;
  final String title;

  @override
  Widget build(BuildContext context) {
    const double w = 96;
    Widget fallback() {
      final letter = title.isNotEmpty ? title[0].toUpperCase() : '?';
      return Container(
        width: w,
        color: AppColors.mint,
        alignment: Alignment.center,
        child: Text(
          letter,
          style: const TextStyle(
            color: AppColors.primary,
            fontWeight: FontWeight.w800,
            fontSize: 28,
          ),
        ),
      );
    }

    if (url == null) return fallback();
    return SizedBox(
      width: w,
      child: CachedNetworkImage(
        imageUrl: url!,
        fit: BoxFit.cover,
        placeholder: (_, __) => fallback(),
        errorWidget: (_, __, ___) => fallback(),
      ),
    );
  }
}
