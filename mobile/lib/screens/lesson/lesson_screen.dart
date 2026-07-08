import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../models/course_module.dart';
import '../../models/lesson.dart';
import '../../services/callable_service.dart';
import '../../services/file_service.dart';
import '../../services/firestore_service.dart';
import '../../services/video_service.dart';
import '../../state/auth_controller.dart';
import '../../state/lesson_controller.dart';
import '../../theme/app_theme.dart';
import '../../widgets/loading.dart';
import '../../widgets/progress_bar.dart';
import '../../widgets/quiz_form.dart';
import '../../widgets/lesson/document_viewer.dart';
import '../../widgets/lesson/external_video.dart';
import '../../widgets/lesson/lesson_feedback.dart';
import '../../widgets/lesson/storage_video.dart';
import '../../widgets/lesson/text_lesson.dart';

/// Lesson viewer — mirrors
/// `src/app/learn/course/[courseId]/lesson/[lessonId]/page.tsx`.
/// Renders the correct widget per lesson type with a module-tree drawer.
class LessonScreen extends StatefulWidget {
  const LessonScreen({
    super.key,
    required this.courseId,
    required this.lessonId,
  });

  final String courseId;
  final String lessonId;

  @override
  State<LessonScreen> createState() => _LessonScreenState();
}

class _LessonScreenState extends State<LessonScreen> {
  late final LessonController _c;

  @override
  void initState() {
    super.initState();
    final profile = context.read<AuthController>().profile;
    _c = LessonController(
      firestore: context.read<FirestoreService>(),
      courseId: widget.courseId,
      lessonId: widget.lessonId,
      uid: profile?.uid ?? '',
      cohortId: (profile?.cohortIds.isNotEmpty ?? false)
          ? profile!.cohortIds.first
          : '',
    );
    _c.load();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Future<void> _complete({bool advance = false}) async {
    await _c.markComplete();
    if (!mounted) return;
    if (_c.markError != null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(_c.markError!)));
      return;
    }
    if (advance) {
      final next = _c.nextLessonId;
      if (next != null) {
        context.pushReplacement(
            '/course/${widget.courseId}/lesson/$next');
      }
    }
  }

  void _goToLesson(String id) {
    Navigator.of(context).pop(); // close drawer
    context.pushReplacement('/course/${widget.courseId}/lesson/$id');
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _c,
      builder: (context, _) {
        final title = _c.lesson?.title ?? 'Lesson';
        return Scaffold(
          appBar: AppBar(title: Text(title, overflow: TextOverflow.ellipsis)),
          drawer: _c.loading ? null : _buildDrawer(),
          body: _buildBody(),
        );
      },
    );
  }

  Widget _buildBody() {
    if (_c.loading) return const Loading();
    if (_c.notFound) return const ErrorRetry(message: 'Lesson not found.');
    if (_c.error != null) {
      return ErrorRetry(message: _c.error!, onRetry: _c.load);
    }
    final lesson = _c.lesson;
    if (lesson == null) {
      return const ErrorRetry(message: 'Lesson not found.');
    }

    final uid = _c.uid;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Text(lesson.title,
            style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: AppColors.primary)),
        const SizedBox(height: 16),
        ..._lessonBody(lesson),
        const SizedBox(height: 32),
        LessonFeedback(
          firestore: context.read<FirestoreService>(),
          uid: uid,
          lessonId: widget.lessonId,
          courseId: widget.courseId,
        ),
      ],
    );
  }

  List<Widget> _lessonBody(Lesson lesson) {
    switch (lesson.type) {
      case LessonType.video:
        if (lesson.videoUrl != null && lesson.videoUrl!.isNotEmpty) {
          return [
            ExternalVideo(videoUrl: lesson.videoUrl),
            if ((lesson.transcript ?? '').isNotEmpty)
              _Transcript(text: lesson.transcript!),
            const SizedBox(height: 16),
            _completeButton(advance: true),
          ];
        }
        if (lesson.videoPath != null && lesson.videoPath!.isNotEmpty) {
          return [
            StorageVideo(
              uid: _c.uid,
              courseId: widget.courseId,
              lessonId: widget.lessonId,
              videoPath: lesson.videoPath!,
              videoService: context.read<VideoService>(),
              firestore: context.read<FirestoreService>(),
              initiallyCompleted: _c.currentCompleted,
              resumePositionSec: _c.resumePositionSec,
              onCompleted: () => _complete(advance: false),
            ),
            if ((lesson.transcript ?? '').isNotEmpty)
              _Transcript(text: lesson.transcript!),
          ];
        }
        return [_message('Video not yet uploaded.')];

      case LessonType.text:
        if ((lesson.textContent ?? '').isEmpty) {
          return [_message('This lesson has no content yet.')];
        }
        return [
          TextLesson(content: lesson.textContent!),
          const SizedBox(height: 20),
          _completeButton(advance: true),
        ];

      case LessonType.slides:
      case LessonType.doc:
      case LessonType.lab:
        return [
          DocumentViewer(
            fileService: context.read<FileService>(),
            filePath: lesson.filePath,
            fileUrl: lesson.fileUrl,
            title: lesson.title,
          ),
          const SizedBox(height: 16),
          _completeButton(advance: true),
        ];

      case LessonType.quiz:
        if (_c.quizAssessment == null) {
          return [
            _message(
                'This quiz has not been set up yet. Please check back later.'),
          ];
        }
        return [
          if (_c.currentCompleted)
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: Row(children: [
                Icon(Icons.check_circle, color: AppColors.accent, size: 18),
                SizedBox(width: 6),
                Text('Quiz completed',
                    style: TextStyle(
                        color: AppColors.accent,
                        fontWeight: FontWeight.w600)),
              ]),
            ),
          QuizForm(
            assessment: _c.quizAssessment!,
            callable: context.read<CallableService>(),
            existingAttempt: _c.quizAttempt,
            // Passing marks the lesson complete (no auto-advance so the
            // learner can review their results).
            onPassed: () => _complete(advance: false),
          ),
        ];

      case LessonType.unknown:
        return [_message('This content type is not yet supported.')];
    }
  }

  Widget _completeButton({required bool advance}) {
    if (_c.currentCompleted) {
      return const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.check_circle, color: AppColors.accent, size: 20),
          SizedBox(width: 6),
          Text('Completed',
              style: TextStyle(
                  color: AppColors.accent, fontWeight: FontWeight.w600)),
        ],
      );
    }
    return FilledButton.icon(
      onPressed: _c.marking ? null : () => _complete(advance: advance),
      icon: const Icon(Icons.check),
      label: Text(_c.marking ? 'Saving…' : 'Mark as Complete'),
    );
  }

  Widget _message(String text) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: AppColors.mint,
          borderRadius: BorderRadius.circular(16),
        ),
        alignment: Alignment.center,
        child: Text(text,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted)),
      );

  Widget _buildDrawer() {
    return Drawer(
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            InkWell(
              onTap: () {
                Navigator.of(context).pop();
                context.pushReplacement('/course/${widget.courseId}');
              },
              child: Text('← ${_c.course?.title ?? 'Course'}',
                  style: const TextStyle(
                      color: AppColors.teal, fontWeight: FontWeight.w600)),
            ),
            const SizedBox(height: 12),
            if (_c.enrollment != null) ...[
              Row(children: [
                const Text('Progress',
                    style: TextStyle(fontSize: 12, color: AppColors.muted)),
                const Spacer(),
                Text('${_c.enrollmentPct}%',
                    style:
                        const TextStyle(fontSize: 12, color: AppColors.muted)),
              ]),
              const SizedBox(height: 6),
              ProgressBar(pct: _c.enrollmentPct.toDouble(), showLabel: false),
              const SizedBox(height: 16),
            ],
            ..._c.modules.map(_drawerModule),
          ],
        ),
      ),
    );
  }

  Widget _drawerModule(CourseModule module) {
    final lessons = _c.lessonsFor(module.id);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 4),
          child: Text(module.title.toUpperCase(),
              style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.5,
                  color: AppColors.muted)),
        ),
        ...lessons.map((l) {
          final done = _c.isCompleted(l.id);
          final current = l.id == widget.lessonId;
          return Container(
            color: current ? AppColors.mint : null,
            child: ListTile(
              dense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
              leading: done
                  ? const Icon(Icons.check_circle,
                      color: AppColors.accent, size: 18)
                  : Icon(Icons.circle_outlined,
                      color: current ? AppColors.primary : AppColors.line,
                      size: 18),
              title: Text(l.title,
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight:
                          current ? FontWeight.w600 : FontWeight.w400)),
              onTap: current ? null : () => _goToLesson(l.id),
            ),
          );
        }),
      ],
    );
  }
}

class _Transcript extends StatelessWidget {
  const _Transcript({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Card(
        child: Theme(
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            tilePadding: const EdgeInsets.symmetric(horizontal: 16),
            title: const Text('Transcript',
                style: TextStyle(
                    fontWeight: FontWeight.w700, color: AppColors.primary)),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: Text(text,
                    style: const TextStyle(height: 1.5, color: AppColors.ink)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
