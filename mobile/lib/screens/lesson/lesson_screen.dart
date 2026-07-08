import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../models/lesson.dart';
import '../../services/firestore_service.dart';
import '../../state/auth_controller.dart';
import '../../theme/app_theme.dart';

/// Arguments passed to the lesson viewer via GoRouter `extra`.
class LessonRouteArgs {
  final String courseId;
  final String moduleId;
  final Lesson lesson;
  final String cohortId;

  const LessonRouteArgs({
    required this.courseId,
    required this.moduleId,
    required this.lesson,
    required this.cohortId,
  });
}

class LessonScreen extends StatefulWidget {
  const LessonScreen({super.key, required this.args});
  final LessonRouteArgs args;

  @override
  State<LessonScreen> createState() => _LessonScreenState();
}

class _LessonScreenState extends State<LessonScreen> {
  bool _saving = false;

  Lesson get lesson => widget.args.lesson;

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open: $url')),
      );
    }
  }

  Future<void> _markComplete() async {
    setState(() => _saving = true);
    final fs = context.read<FirestoreService>();
    final uid = context.read<AuthController>().profile?.uid ?? '';
    try {
      // NOTE: course-level progressPct is recomputed on the course screen from
      // per-lesson progress; here we set 100 for this lesson and let the
      // enrollment doc's lastLessonId update. A precise course % can be passed
      // in via args if desired.
      await fs.markLessonComplete(
        uid: uid,
        courseId: widget.args.courseId,
        lessonId: lesson.id,
        cohortId: widget.args.cohortId,
        courseProgressPct: 0,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Marked complete')),
      );
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not save: $e')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(lesson.title)),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: _body(),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: FilledButton.icon(
                onPressed: _saving ? null : _markComplete,
                icon: const Icon(Icons.check),
                label: Text(_saving ? 'Saving…' : 'Mark complete'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    switch (lesson.type) {
      case LessonType.video:
        final url = lesson.videoUrl;
        return _MediaBlock(
          icon: Icons.play_circle_outline,
          title: 'Video lesson',
          description: url != null
              ? 'Opens in your browser / player.'
              : 'This video is hosted in Firebase Storage and needs a signed '
                  'URL (Cloud Function) to stream — wire up VideoService next.',
          actionLabel: url != null ? 'Play video' : null,
          onAction: url != null ? () => _open(url) : null,
          transcript: lesson.transcript,
        );
      case LessonType.text:
        final text = lesson.textContent ?? '';
        return Text(
          _stripHtml(text),
          style: const TextStyle(fontSize: 16, height: 1.5, color: AppColors.ink),
        );
      case LessonType.slides:
      case LessonType.doc:
        final url = lesson.fileUrl;
        return _MediaBlock(
          icon: Icons.description_outlined,
          title: lesson.type == LessonType.slides ? 'Slides' : 'Document',
          description: url != null
              ? 'Opens the resource in your browser.'
              : 'Stored in Firebase Storage — resolve the download URL to open.',
          actionLabel: url != null ? 'Open resource' : null,
          onAction: url != null ? () => _open(url) : null,
        );
      case LessonType.lab:
        return const _MediaBlock(
          icon: Icons.science_outlined,
          title: 'Lab',
          description:
              'Interactive lab. The mobile lab experience is planned for a '
              'later milestone.',
        );
      case LessonType.quiz:
        return const _MediaBlock(
          icon: Icons.quiz_outlined,
          title: 'Quiz',
          description:
              'Quizzes are graded by the gradeAttempt Cloud Function. The '
              'mobile quiz UI is the next screen to build.',
        );
      case LessonType.unknown:
        return const Text('Unsupported lesson type.');
    }
  }

  /// Minimal HTML → text fallback (full rich rendering can use flutter_html).
  String _stripHtml(String html) => html
      .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'</p>', caseSensitive: false), '\n\n')
      .replaceAll(RegExp(r'<[^>]+>'), '')
      .replaceAll('&nbsp;', ' ')
      .trim();
}

class _MediaBlock extends StatelessWidget {
  const _MediaBlock({
    required this.icon,
    required this.title,
    required this.description,
    this.actionLabel,
    this.onAction,
    this.transcript,
  });

  final IconData icon;
  final String title;
  final String description;
  final String? actionLabel;
  final VoidCallback? onAction;
  final String? transcript;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 40),
          decoration: BoxDecoration(
            color: AppColors.mint,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Icon(icon, size: 56, color: AppColors.primary),
        ),
        const SizedBox(height: 16),
        Text(title,
            style: const TextStyle(
                fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.ink)),
        const SizedBox(height: 6),
        Text(description,
            style: const TextStyle(color: AppColors.muted, height: 1.4)),
        if (actionLabel != null) ...[
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: onAction,
            icon: const Icon(Icons.open_in_new),
            label: Text(actionLabel!),
          ),
        ],
        if (transcript != null && transcript!.isNotEmpty) ...[
          const SizedBox(height: 24),
          const Text('Transcript',
              style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text(transcript!,
              style: const TextStyle(height: 1.5, color: AppColors.ink)),
        ],
      ],
    );
  }
}
