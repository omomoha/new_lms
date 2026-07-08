import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../models/course.dart';
import '../theme/app_theme.dart';
import 'progress_bar.dart';

class CourseCard extends StatelessWidget {
  const CourseCard({
    super.key,
    required this.item,
    required this.thumbUrl,
    this.onTap,
  });

  final CourseWithProgress item;
  final String? thumbUrl;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final course = item.course;
    final locked = !item.hasAccess;

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: locked ? null : onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Thumb(url: thumbUrl, title: course.title),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            course.title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 16,
                              color: AppColors.ink,
                            ),
                          ),
                        ),
                        if (locked)
                          const Icon(Icons.lock_outline,
                              size: 18, color: AppColors.muted),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      course.description,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 13, color: AppColors.muted, height: 1.3),
                    ),
                    const SizedBox(height: 12),
                    if (locked)
                      const Text(
                        'Not assigned to your cohort',
                        style: TextStyle(fontSize: 12, color: AppColors.muted),
                      )
                    else
                      ProgressBar(pct: item.progressPct),
                  ],
                ),
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
    const double size = 64;
    if (url != null) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: CachedNetworkImage(
          imageUrl: url!,
          width: size,
          height: size,
          fit: BoxFit.cover,
          placeholder: (_, __) => _fallback(title),
          errorWidget: (_, __, ___) => _fallback(title),
        ),
      );
    }
    return _fallback(title);
  }

  Widget _fallback(String title) {
    final letter = title.isNotEmpty ? title[0].toUpperCase() : '?';
    return Container(
      width: 64,
      height: 64,
      decoration: BoxDecoration(
        color: AppColors.mint,
        borderRadius: BorderRadius.circular(12),
      ),
      alignment: Alignment.center,
      child: Text(
        letter,
        style: const TextStyle(
          color: AppColors.primary,
          fontWeight: FontWeight.w800,
          fontSize: 24,
        ),
      ),
    );
  }
}
