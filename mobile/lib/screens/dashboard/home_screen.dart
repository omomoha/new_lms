import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../logic/due_dates.dart';
import '../../services/firestore_service.dart';
import '../../state/auth_controller.dart';
import '../../state/dashboard_controller.dart';
import '../../theme/app_theme.dart';
import '../../widgets/course_card.dart';
import '../../widgets/course_search.dart';
import '../../widgets/loading.dart';
import '../../widgets/resume_card.dart';
import '../../widgets/streak_card.dart';

/// The learner home — mirrors `src/app/learn/page.tsx`. Body-only: the bottom
/// navigation shell owns the AppBar (brand + notifications + sign-out).
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final DashboardController _controller;

  @override
  void initState() {
    super.initState();
    _controller =
        DashboardController(firestore: context.read<FirestoreService>());
    _reload();
  }

  void _reload() {
    final user = context.read<AuthController>().profile;
    if (user != null) _controller.load(user);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final name = context.watch<AuthController>().profile?.name ?? '';
    final firstName = name.isNotEmpty ? name.split(' ').first : '';

    return RefreshIndicator(
      onRefresh: () async => _reload(),
      child: ListenableBuilder(
        listenable: _controller,
        builder: (context, _) {
          if (_controller.loading) return const Loading();
          if (_controller.error != null) {
            return ListView(
              children: [
                const SizedBox(height: 120),
                ErrorRetry(message: _controller.error!, onRetry: _reload),
              ],
            );
          }

          final all = _controller.courses;
          final visible = _controller.visibleCourses;
          final resume = _controller.resume;

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              // Hero greeting band.
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: AppColors.primary,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('MY LEARNING',
                        style: TextStyle(
                            color: AppColors.accent,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1)),
                    const SizedBox(height: 6),
                    Text(
                      firstName.isEmpty
                          ? 'Welcome back'
                          : 'Welcome back, $firstName',
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 24,
                          fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 4),
                    const Text('Continue your learning journey',
                        style:
                            TextStyle(color: AppColors.mist, fontSize: 13)),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              if (all.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 80),
                  child: Center(
                    child: Text(
                      'No published courses available yet.\nCheck back soon.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.muted),
                    ),
                  ),
                )
              else ...[
                StreakCard(stats: _controller.streaks),
                const SizedBox(height: 12),
                if (resume != null) ...[
                  ResumeCard(
                    selection: resume,
                    thumbUrl: _controller.thumbUrl(resume.course.id),
                    onTap: () =>
                        context.push('/course/${resume.course.id}'),
                  ),
                  const SizedBox(height: 12),
                ],
                CourseSearch(onQueryChange: _controller.setQuery),
                if (_controller.isSearching)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      '${visible.length} course${visible.length != 1 ? 's' : ''} matching "${_controller.query.trim()}"',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.muted),
                    ),
                  ),
                const SizedBox(height: 12),
                if (visible.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 48),
                    child: Center(
                      child: Text(
                        'No courses match your search.\nTry a different term.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: AppColors.muted),
                      ),
                    ),
                  )
                else
                  ...visible.map((c) {
                    final badge = c.hasAccess
                        ? dueBadge(
                            c.dueMillis,
                            DateTime.now().millisecondsSinceEpoch,
                            c.progressPct)
                        : null;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: CourseCard(
                        item: c,
                        thumbUrl: _controller.thumbUrl(c.id),
                        badge: badge,
                        onTap: () => context.push('/course/${c.id}'),
                      ),
                    );
                  }),
              ],
            ],
          );
        },
      ),
    );
  }
}
