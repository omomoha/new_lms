import 'package:flutter/material.dart';

import '../../services/firestore_service.dart';
import '../../theme/app_theme.dart';

/// "Was this lesson helpful?" widget. Writes lessonFeedback/{uid}_{lessonId}
/// (rating 1-5 int, comment <=1000, updatedAt). Prefills existing feedback and
/// is fail-soft — it must never crash the lesson page. Mirrors the web
/// LessonFeedback component.
class LessonFeedback extends StatefulWidget {
  const LessonFeedback({
    super.key,
    required this.firestore,
    required this.uid,
    required this.lessonId,
    required this.courseId,
  });

  final FirestoreService firestore;
  final String uid;
  final String lessonId;
  final String courseId;

  @override
  State<LessonFeedback> createState() => _LessonFeedbackState();
}

class _LessonFeedbackState extends State<LessonFeedback> {
  static const int _maxComment = 1000;

  int _rating = 0;
  final _commentController = TextEditingController();
  bool _saving = false;
  bool _saved = false;
  bool _hasExisting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _prefill();
  }

  Future<void> _prefill() async {
    final existing =
        await widget.firestore.getLessonFeedback(widget.uid, widget.lessonId);
    if (!mounted || existing == null) return;
    setState(() {
      if (existing.rating >= 1 && existing.rating <= 5) {
        _rating = existing.rating;
      }
      _commentController.text =
          existing.comment.length > _maxComment
              ? existing.comment.substring(0, _maxComment)
              : existing.comment;
      _hasExisting = true;
      _saved = true;
    });
  }

  Future<void> _submit() async {
    if (_rating < 1 || _rating > 5 || _saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.firestore.saveLessonFeedback(
        uid: widget.uid,
        lessonId: widget.lessonId,
        courseId: widget.courseId,
        rating: _rating,
        comment: _commentController.text,
      );
      if (!mounted) return;
      setState(() {
        _saved = true;
        _hasExisting = true;
        _saving = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not save your feedback. Please try again.';
        _saving = false;
      });
    }
  }

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Was this lesson helpful?',
                style: TextStyle(
                    fontWeight: FontWeight.w700, color: AppColors.primary)),
            const SizedBox(height: 8),
            Row(
              children: List.generate(5, (i) {
                final n = i + 1;
                final filled = n <= _rating;
                return IconButton(
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  constraints: const BoxConstraints(),
                  onPressed: () => setState(() {
                    _rating = n;
                    _saved = false;
                  }),
                  icon: Icon(
                    filled ? Icons.star : Icons.star_border,
                    color: filled ? AppColors.accent : AppColors.line,
                    size: 30,
                  ),
                );
              }),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _commentController,
              maxLength: _maxComment,
              maxLines: 3,
              onChanged: (_) => setState(() => _saved = false),
              decoration: const InputDecoration(
                hintText: 'Add a comment (optional)',
              ),
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                FilledButton(
                  onPressed: _rating < 1 || _saving ? null : _submit,
                  child: Text(_saving
                      ? 'Saving…'
                      : _hasExisting
                          ? 'Update feedback'
                          : 'Submit feedback'),
                ),
                const SizedBox(width: 12),
                if (_saved && !_saving)
                  const Text('Thanks for your feedback ✓',
                      style: TextStyle(
                          color: AppColors.teal, fontWeight: FontWeight.w600)),
                if (_error != null)
                  Expanded(
                    child: Text(_error!,
                        style: const TextStyle(
                            color: Color(0xFFB91C1C), fontSize: 12)),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
