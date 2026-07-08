import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../models/course_module.dart';
import '../../models/lesson.dart';
import '../../services/callable_service.dart';
import '../../services/firestore_service.dart';
import '../../state/auth_controller.dart';
import '../../state/course_controller.dart';
import '../../theme/app_theme.dart';
import '../../widgets/certificate_card.dart';
import '../../widgets/loading.dart';
import '../../widgets/progress_bar.dart';
import '../../widgets/quiz_form.dart';

/// Course detail — mirrors `src/app/learn/course/[courseId]/page.tsx`.
class CourseDetailScreen extends StatefulWidget {
  const CourseDetailScreen({super.key, required this.courseId});
  final String courseId;

  @override
  State<CourseDetailScreen> createState() => _CourseDetailScreenState();
}

class _CourseDetailScreenState extends State<CourseDetailScreen> {
  late final CourseController _c;

  /// Which inline assessment panel is expanded ("pre" | "post" | null).
  String? _showing;

  @override
  void initState() {
    super.initState();
    final uid = context.read<AuthController>().profile?.uid ?? '';
    _c = CourseController(
      firestore: context.read<FirestoreService>(),
      callable: context.read<CallableService>(),
      courseId: widget.courseId,
      uid: uid,
    );
    _c.load();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
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
      body: ListenableBuilder(
        listenable: _c,
        builder: (context, _) {
          if (_c.loading) return const Loading();
          if (_c.notFound) {
            return const ErrorRetry(message: 'Course not found.');
          }
          if (_c.permissionDenied) {
            return _LockedState(title: _c.course?.title ?? 'This course');
          }
          if (_c.error != null) {
            return ErrorRetry(message: _c.error!, onRetry: _c.load);
          }
          final course = _c.course!;

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              Text(course.title,
                  style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: AppColors.ink)),
              if (course.description.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(course.description,
                    style: const TextStyle(
                        color: AppColors.muted, height: 1.4)),
              ],
              if (_c.enrollment != null) ...[
                const SizedBox(height: 14),
                Row(
                  children: [
                    const Text('Your progress',
                        style:
                            TextStyle(fontSize: 12, color: AppColors.muted)),
                    const Spacer(),
                    Text('${_c.progressPct}%',
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.muted)),
                  ],
                ),
                const SizedBox(height: 6),
                ProgressBar(
                    pct: _c.progressPct.toDouble(), showLabel: false),
              ],
              const SizedBox(height: 20),

              // Pre-assessment.
              if (_c.preAssessment != null) _buildPre(),

              // Start / Continue.
              if (_c.firstLesson != null) ...[
                FilledButton(
                  onPressed: () => context.push(
                      '/course/${widget.courseId}/lesson/${_c.continueLessonId}'),
                  child: Text(_c.hasStarted ? 'Continue Learning' : 'Start Course'),
                ),
                const SizedBox(height: 20),
              ],

              // Pre-before-post gate.
              if (_c.postLockedByPre)
                _Banner(
                  color: const Color(0xFFB45309),
                  background: const Color(0xFFFFFBEB),
                  kicker: 'POST-COURSE ASSESSMENT — LOCKED',
                  child: const Text(
                    'Take the pre-course assessment above first — it is required '
                    'before the final assessment so we can measure your improvement.',
                    style: TextStyle(fontSize: 13, color: AppColors.ink),
                  ),
                ),

              // Post-assessment.
              if (_c.postAssessment != null) _buildPost(),

              // Certificate.
              if (_c.certEligible || _c.certificate != null) ...[
                CertificateCard(controller: _c),
                const SizedBox(height: 16),
              ],

              // Module → lesson tree.
              ..._c.modules.map(_buildModule),
            ],
          );
        },
      ),
    );
  }

  Widget _buildPre() {
    final pre = _c.preAssessment!;
    final attempt = _c.preAttempt;
    final expanded = _showing == 'pre';
    return _Banner(
      color: AppColors.accent,
      kicker: 'PRE-COURSE ASSESSMENT',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(pre.title,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            color: AppColors.primary)),
                    const SizedBox(height: 2),
                    if (attempt == null)
                      Text(
                        '${pre.questions.length} question${pre.questions.length != 1 ? 's' : ''} · pass mark: ${pre.passMark}%',
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.muted),
                      )
                    else
                      _scoreLine(attempt.score, attempt.total, attempt.passed),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _toggleButton('pre', attempt == null),
            ],
          ),
          if (expanded) ...[
            const Divider(height: 24),
            QuizForm(
              assessment: pre,
              callable: context.read<CallableService>(),
              onPassed: _refreshAfterAssessment,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPost() {
    final post = _c.postAssessment!;
    final attempt = _c.postAttempt;
    final expanded = _showing == 'post';

    // Only render the banner/score when relevant (mirror web conditions).
    final showBanner = _c.showPostBanner;
    if (attempt == null && !showBanner) return const SizedBox.shrink();

    return _Banner(
      color: AppColors.primary,
      kicker: 'POST-COURSE ASSESSMENT',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(post.title,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            color: AppColors.primary)),
                    const SizedBox(height: 2),
                    if (attempt == null)
                      const Text(
                        'You have completed the course — take the final assessment.',
                        style:
                            TextStyle(fontSize: 12, color: AppColors.muted),
                      )
                    else
                      _scoreLine(
                          attempt.score, attempt.total, attempt.passed),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _toggleButton('post', attempt == null),
            ],
          ),
          if (expanded) ...[
            const Divider(height: 24),
            QuizForm(
              assessment: post,
              callable: context.read<CallableService>(),
              onPassed: _refreshAfterAssessment,
            ),
          ],
        ],
      ),
    );
  }

  Widget _scoreLine(int score, int total, bool passed) {
    final pct = total > 0 ? ((score / total) * 100).round() : 0;
    return Text.rich(TextSpan(children: [
      TextSpan(
        text: 'Score: $score/$total ($pct%) · ',
        style: const TextStyle(fontSize: 12, color: AppColors.muted),
      ),
      TextSpan(
        text: passed ? 'Passed' : 'Not passed',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: passed ? AppColors.teal : const Color(0xFFB91C1C),
        ),
      ),
    ]));
  }

  Widget _toggleButton(String which, bool primary) {
    final expanded = _showing == which;
    final label = expanded
        ? 'Close'
        : primary
            ? 'Take Assessment'
            : 'Retake';
    void onTap() => setState(() => _showing = expanded ? null : which);
    return primary && !expanded
        ? FilledButton(
            onPressed: onTap,
            style: FilledButton.styleFrom(
                minimumSize: const Size(0, 40),
                padding: const EdgeInsets.symmetric(horizontal: 14)),
            child: Text(label, style: const TextStyle(fontSize: 13)))
        : OutlinedButton(onPressed: onTap, child: Text(label));
  }

  void _refreshAfterAssessment() {
    setState(() => _showing = null);
    _c.load();
  }

  Widget _buildModule(CourseModule module) {
    final lessons = _c.lessonsFor(module.id);
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: true,
          tilePadding: const EdgeInsets.symmetric(horizontal: 16),
          title: Text(module.title,
              style: const TextStyle(
                  fontWeight: FontWeight.w700, color: AppColors.primary)),
          childrenPadding: const EdgeInsets.only(bottom: 8),
          children: lessons.map<Widget>((l) {
            final done = _c.progressFor(l.id)?.isCompleted ?? false;
            final isCurrent = _c.enrollment?.lastLessonId == l.id;
            return Container(
              color: isCurrent ? AppColors.mint : null,
              child: ListTile(
                leading: _Tick(done: done, current: isCurrent),
                title: Text(l.title,
                    style: TextStyle(
                        fontWeight:
                            isCurrent ? FontWeight.w600 : FontWeight.w400)),
                subtitle: Text(_typeLabel(l.type),
                    style: const TextStyle(
                        fontSize: 11, color: AppColors.muted)),
                trailing: Icon(_iconFor(l.type), color: AppColors.teal),
                onTap: () => context
                    .push('/course/${widget.courseId}/lesson/${l.id}'),
              ),
            );
          }).toList(),
        ),
      ),
    );
  }

  String _typeLabel(LessonType t) =>
      t.name == 'unknown' ? '' : t.name.toUpperCase();
}

// ── Small helpers ────────────────────────────────────────────────────────────

class _Tick extends StatelessWidget {
  const _Tick({required this.done, required this.current});
  final bool done;
  final bool current;

  @override
  Widget build(BuildContext context) {
    if (done) {
      return const CircleAvatar(
        radius: 12,
        backgroundColor: AppColors.accent,
        child: Icon(Icons.check, size: 14, color: Colors.white),
      );
    }
    return Container(
      width: 24,
      height: 24,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: current ? AppColors.primary : AppColors.line,
          width: 2,
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({
    required this.color,
    required this.kicker,
    required this.child,
    this.background,
  });
  final Color color;
  final String kicker;
  final Widget child;
  final Color? background;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: background ?? Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border(
          left: BorderSide(color: color, width: 4),
          top: const BorderSide(color: AppColors.line),
          right: const BorderSide(color: AppColors.line),
          bottom: const BorderSide(color: AppColors.line),
        ),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(kicker,
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.5,
                  color: color)),
          const SizedBox(height: 6),
          child,
        ],
      ),
    );
  }
}

class _LockedState extends StatelessWidget {
  const _LockedState({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.lock_outline, size: 48, color: AppColors.muted),
            const SizedBox(height: 12),
            Text("$title isn't assigned to your cohort yet.",
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontWeight: FontWeight.w700, color: AppColors.primary)),
            const SizedBox(height: 6),
            const Text('Ask your admin to add you to the right cohort.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.muted)),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => context.pop(),
              child: const Text('← Back to My Courses'),
            ),
          ],
        ),
      ),
    );
  }
}
