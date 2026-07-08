import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../models/course.dart';
import '../../models/course_module.dart';
import '../../models/lesson.dart';
import '../../models/lesson_progress.dart';
import '../../services/firestore_service.dart';
import '../../state/auth_controller.dart';
import '../../theme/app_theme.dart';
import '../../widgets/loading.dart';
import '../../widgets/progress_bar.dart';
import '../lesson/lesson_screen.dart';

class _CourseBundle {
  final Course course;
  final List<CourseModule> modules;
  final Map<String, List<Lesson>> lessonsByModule;
  final Map<String, LessonProgress> progress;

  _CourseBundle({
    required this.course,
    required this.modules,
    required this.lessonsByModule,
    required this.progress,
  });

  int get totalLessons =>
      lessonsByModule.values.fold(0, (sum, l) => sum + l.length);
  int get completedLessons =>
      progress.values.where((p) => p.isCompleted).length;
  double get pct =>
      totalLessons == 0 ? 0 : (completedLessons / totalLessons) * 100;
}

class CourseDetailScreen extends StatefulWidget {
  const CourseDetailScreen({super.key, required this.courseId});
  final String courseId;

  @override
  State<CourseDetailScreen> createState() => _CourseDetailScreenState();
}

class _CourseDetailScreenState extends State<CourseDetailScreen> {
  late Future<_CourseBundle?> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_CourseBundle?> _load() async {
    final fs = context.read<FirestoreService>();
    final uid = context.read<AuthController>().profile?.uid ?? '';
    final course = await fs.getCourse(widget.courseId);
    if (course == null) return null;

    final modules = await fs.getModules(widget.courseId);
    final lessonsByModule = <String, List<Lesson>>{};
    for (final m in modules) {
      lessonsByModule[m.id] = await fs.getLessons(widget.courseId, m.id);
    }
    final progress = await fs.getCourseProgress(uid, widget.courseId);

    return _CourseBundle(
      course: course,
      modules: modules,
      lessonsByModule: lessonsByModule,
      progress: progress,
    );
  }

  IconData _iconFor(LessonType t) {
    switch (t) {
      case LessonType.video:
        return Icons.play_circle_outline;
      case LessonType.text:
        return Icons.article_outlined;
      case LessonType.slides:
        return Icons.slideshow_outlined;
      case LessonType.doc:
        return Icons.description_outlined;
      case LessonType.lab:
        return Icons.science_outlined;
      case LessonType.quiz:
        return Icons.quiz_outlined;
      case LessonType.unknown:
        return Icons.circle_outlined;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Course')),
      body: FutureBuilder<_CourseBundle?>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Loading();
          }
          if (snap.hasError) {
            return ErrorRetry(
              message: 'Could not load this course.\n${snap.error}',
              onRetry: () => setState(() => _future = _load()),
            );
          }
          final b = snap.data;
          if (b == null) {
            return const ErrorRetry(message: 'Course not found.');
          }

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              Text(b.course.title,
                  style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: AppColors.ink)),
              const SizedBox(height: 6),
              Text(b.course.description,
                  style: const TextStyle(color: AppColors.muted, height: 1.4)),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(child: ProgressBar(pct: b.pct)),
                  const SizedBox(width: 10),
                  Text('${b.completedLessons}/${b.totalLessons}',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.muted)),
                ],
              ),
              const SizedBox(height: 20),
              ...b.modules.map((m) {
                final lessons = b.lessonsByModule[m.id] ?? const [];
                return Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: Theme(
                    data: Theme.of(context)
                        .copyWith(dividerColor: Colors.transparent),
                    child: ExpansionTile(
                      initiallyExpanded: true,
                      tilePadding:
                          const EdgeInsets.symmetric(horizontal: 16),
                      title: Text(m.title,
                          style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              color: AppColors.ink)),
                      childrenPadding: const EdgeInsets.only(bottom: 8),
                      children: lessons.map((l) {
                        final done =
                            b.progress[l.id]?.isCompleted ?? false;
                        return ListTile(
                          leading: Icon(_iconFor(l.type),
                              color: AppColors.teal),
                          title: Text(l.title),
                          trailing: done
                              ? const Icon(Icons.check_circle,
                                  color: AppColors.accent, size: 20)
                              : const Icon(Icons.chevron_right,
                                  color: AppColors.muted),
                          onTap: () => context.push(
                            '/course/${b.course.id}/lesson',
                            extra: LessonRouteArgs(
                              courseId: b.course.id,
                              moduleId: m.id,
                              lesson: l,
                              cohortId: '',
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                );
              }),
            ],
          );
        },
      ),
    );
  }
}
