import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../logic/due_dates.dart';
import '../state/dashboard_controller.dart';
import '../theme/app_theme.dart';
import 'due_badge.dart';
import 'progress_bar.dart';

/// Dashboard course card. Two variants driven by [DashboardCourse.hasAccess]:
///  - accessible → tappable, thumbnail + optional due badge + progress bar;
///  - locked → dimmed, padlock, "Not in your cohort yet — ask your admin.",
///    non-tappable.
/// Mirrors the web learn/page.tsx grid card.
class CourseCard extends StatelessWidget {
  const CourseCard({
    super.key,
    required this.item,
    required this.thumbUrl,
    this.badge,
    this.onTap,
  });

  final DashboardCourse item;
  final String? thumbUrl;
  final DueBadgeInfo? badge;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final course = item.course;
    final locked = !item.hasAccess;

    final card = Card(
      clipBehavior: Clip.antiAlias,
      child: Opacity(
        opacity: locked ? 0.7 : 1,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _Thumb(url: thumbUrl, title: course.title, locked: locked),
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    course.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                      color: locked ? AppColors.muted : AppColors.ink,
                    ),
                  ),
                  if (course.description.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      course.description,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 13, color: AppColors.muted, height: 1.3),
                    ),
                  ],
                  const SizedBox(height: 10),
                  if (locked)
                    const Text(
                      'Not in your cohort yet — ask your admin.',
                      style: TextStyle(fontSize: 12, color: AppColors.muted),
                    )
                  else ...[
                    if (badge != null) ...[
                      DueBadge(info: badge!),
                      const SizedBox(height: 8),
                    ],
                    Row(
                      children: [
                        const Text('Progress',
                            style: TextStyle(
                                fontSize: 12, color: AppColors.muted)),
                        const Spacer(),
                        Text('${item.progressPctInt}%',
                            style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: AppColors.teal)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    ProgressBar(
                        pct: item.progressPctInt.toDouble(), showLabel: false),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );

    if (locked) return card;
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: card,
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.url, required this.title, required this.locked});
  final String? url;
  final String title;
  final bool locked;

  @override
  Widget build(BuildContext context) {
    const double h = 112;
    Widget base;
    if (url != null) {
      base = CachedNetworkImage(
        imageUrl: url!,
        height: h,
        width: double.infinity,
        fit: BoxFit.cover,
        placeholder: (_, __) => _fallback(),
        errorWidget: (_, __, ___) => _fallback(),
      );
    } else {
      base = _fallback();
    }

    if (!locked) return base;
    // Locked: grayscale + dimmed with a padlock badge.
    return Stack(
      children: [
        ColorFiltered(
          colorFilter: const ColorFilter.matrix(<double>[
            0.2126, 0.7152, 0.0722, 0, 0, //
            0.2126, 0.7152, 0.0722, 0, 0, //
            0.2126, 0.7152, 0.0722, 0, 0, //
            0, 0, 0, 0.55, 0, //
          ]),
          child: base,
        ),
        const Positioned(
          top: 8,
          right: 8,
          child: CircleAvatar(
            radius: 14,
            backgroundColor: Colors.black45,
            child: Icon(Icons.lock, size: 16, color: Colors.white),
          ),
        ),
      ],
    );
  }

  Widget _fallback() {
    final letter = title.isNotEmpty ? title[0].toUpperCase() : '?';
    return Container(
      height: 112,
      width: double.infinity,
      color: AppColors.mint,
      alignment: Alignment.center,
      child: Text(
        letter,
        style: const TextStyle(
          color: AppColors.primary,
          fontWeight: FontWeight.w800,
          fontSize: 40,
        ),
      ),
    );
  }
}
