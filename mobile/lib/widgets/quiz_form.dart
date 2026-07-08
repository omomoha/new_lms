import 'package:flutter/material.dart';

import '../models/assessment.dart';
import '../models/attempt.dart';
import '../services/callable_service.dart';
import '../theme/app_theme.dart';

/// Shared learner-facing quiz renderer. Renders an [Assessment]'s questions
/// (one radio group per question), submits via `gradeAttempt`, and shows a
/// results screen with per-question correct/incorrect from the SERVER response
/// only. Mirrors the web `QuizForm`.
class QuizForm extends StatefulWidget {
  const QuizForm({
    super.key,
    required this.assessment,
    required this.callable,
    this.existingAttempt,
    this.onPassed,
  });

  final Assessment assessment;
  final CallableService callable;

  /// If provided, show read-only results from this past attempt until Retake.
  final Attempt? existingAttempt;

  /// Called when the learner passes (e.g. to mark the lesson complete).
  final VoidCallback? onPassed;

  @override
  State<QuizForm> createState() => _QuizFormState();
}

class _QuizFormState extends State<QuizForm> {
  final Map<String, int> _selected = {};
  bool _submitting = false;
  GradeAttemptResult? _result;
  String? _error;
  bool _retrying = false;
  late int _startedAtMs;

  @override
  void initState() {
    super.initState();
    _startedAtMs = DateTime.now().millisecondsSinceEpoch;
  }

  bool get _formVisible =>
      (widget.existingAttempt == null || _retrying) && _result == null;

  Future<void> _submit() async {
    for (final q in widget.assessment.questions) {
      if (!_selected.containsKey(q.id)) {
        setState(() => _error = 'Please answer all questions before submitting.');
        return;
      }
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final durationSec =
          ((DateTime.now().millisecondsSinceEpoch - _startedAtMs) / 1000)
              .round();
      final res = await widget.callable.gradeAttempt(
        assessmentId: widget.assessment.id,
        answers: _selected,
        durationSec: durationSec,
      );
      if (!mounted) return;
      setState(() {
        _result = res;
        _retrying = false;
        _submitting = false;
      });
      if (res.passed) widget.onPassed?.call();
    } on CallableException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _submitting = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Submission failed. Please try again.';
        _submitting = false;
      });
    }
  }

  void _retake() {
    setState(() {
      _result = null;
      _selected.clear();
      _error = null;
      _retrying = true;
      _startedAtMs = DateTime.now().millisecondsSinceEpoch;
    });
  }

  @override
  Widget build(BuildContext context) {
    // Read-only past attempt.
    if (widget.existingAttempt != null && _result == null && !_retrying) {
      final a = widget.existingAttempt!;
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Previous result: ${a.score}/${a.total} (${a.scorePct}%)',
                  style: const TextStyle(
                      fontWeight: FontWeight.w600, color: AppColors.primary)),
              const SizedBox(height: 8),
              _PassPill(passed: a.passed),
              const SizedBox(height: 12),
              OutlinedButton(
                  onPressed: _retake,
                  child: const Text('Retake Assessment')),
            ],
          ),
        ),
      );
    }

    // Results.
    if (_result != null) {
      final r = _result!;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${widget.assessment.title} — Results',
                      style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          color: AppColors.primary)),
                  const SizedBox(height: 6),
                  Text('Score: ${r.score}/${r.total} (${r.scorePct}%)',
                      style: const TextStyle(color: AppColors.ink)),
                  const SizedBox(height: 8),
                  _PassPill(
                    passed: r.passed,
                    label: r.passed
                        ? 'Passed (pass mark: ${widget.assessment.passMark}%)'
                        : 'Not passed — need ${widget.assessment.passMark}%',
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          // Per-question breakdown — correctness from server perQuestion ONLY.
          ...List.generate(widget.assessment.questions.length, (idx) {
            final q = widget.assessment.questions[idx];
            final correct = r.perQuestion[q.id] ?? false;
            final chosen = _selected[q.id];
            return Container(
              margin: const EdgeInsets.only(bottom: 10),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border(
                  left: BorderSide(
                    color: correct
                        ? AppColors.accent
                        : const Color(0xFFEF4444),
                    width: 3,
                  ),
                  top: const BorderSide(color: AppColors.line),
                  right: const BorderSide(color: AppColors.line),
                  bottom: const BorderSide(color: AppColors.line),
                ),
              ),
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${idx + 1}. ${q.prompt}',
                      style: const TextStyle(
                          fontWeight: FontWeight.w600, color: AppColors.ink)),
                  const SizedBox(height: 4),
                  Text.rich(TextSpan(children: [
                    const TextSpan(
                        text: 'Your answer: ',
                        style: TextStyle(
                            fontSize: 12, color: AppColors.muted)),
                    TextSpan(
                      text: chosen != null && chosen < q.options.length
                          ? q.options[chosen]
                          : '—',
                      style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink),
                    ),
                    TextSpan(
                      text: correct ? '  ·  Correct' : '  ·  Incorrect',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: correct
                            ? AppColors.teal
                            : const Color(0xFFB91C1C),
                      ),
                    ),
                  ])),
                ],
              ),
            );
          }),
          if (!r.passed)
            OutlinedButton(
                onPressed: _retake, child: const Text('Try Again')),
        ],
      );
    }

    // Form.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(widget.assessment.title,
            style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.primary)),
        const SizedBox(height: 4),
        Text(
          'Pass mark: ${widget.assessment.passMark}% — answer all questions, then submit.',
          style: const TextStyle(fontSize: 12, color: AppColors.muted),
        ),
        const SizedBox(height: 12),
        ...List.generate(widget.assessment.questions.length, (idx) {
          final q = widget.assessment.questions[idx];
          return Card(
            margin: const EdgeInsets.only(bottom: 10),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${idx + 1}. ${q.prompt}',
                      style: const TextStyle(
                          fontWeight: FontWeight.w600, color: AppColors.ink)),
                  const SizedBox(height: 6),
                  ...List.generate(q.options.length, (optIdx) {
                    return RadioListTile<int>(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      value: optIdx,
                      groupValue: _selected[q.id],
                      activeColor: AppColors.accent,
                      title: Text(q.options[optIdx],
                          style: const TextStyle(
                              fontSize: 14, color: AppColors.ink)),
                      onChanged: (v) =>
                          setState(() => _selected[q.id] = v!),
                    );
                  }),
                ],
              ),
            ),
          );
        }),
        if (_error != null) ...[
          Text(_error!,
              style:
                  const TextStyle(fontSize: 12, color: Color(0xFFB91C1C))),
          const SizedBox(height: 8),
        ],
        FilledButton(
          onPressed: _submitting ? null : _submit,
          child: Text(_submitting ? 'Submitting…' : 'Submit Answers'),
        ),
      ],
    );
  }
}

class _PassPill extends StatelessWidget {
  const _PassPill({required this.passed, this.label});
  final bool passed;
  final String? label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: BoxDecoration(
        color: passed ? AppColors.mint : const Color(0xFFFDE8E8),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label ?? (passed ? 'Passed' : 'Not passed'),
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: passed ? AppColors.teal : const Color(0xFFB91C1C),
        ),
      ),
    );
  }
}
