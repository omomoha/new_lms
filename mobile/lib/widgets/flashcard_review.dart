import 'package:flutter/material.dart';

import '../logic/spaced_repetition.dart';
import '../models/flashcard.dart';
import '../theme/app_theme.dart';

/// Spaced-repetition review session. Receives the due cards (already
/// filtered/sorted by the controller), shows one at a time with a tap-to-flip
/// interaction, then four grade buttons (Again/Hard/Good/Easy). Each grade
/// applies `spacedRepetition.review()` and persists the new scheduling state
/// via [onSave] — which writes ONLY {interval,ease,reps,due} (rules-allowed).
///
/// Mirrors `src/components/flashcards/FlashcardReview.tsx`.
class FlashcardReview extends StatefulWidget {
  const FlashcardReview({
    super.key,
    required this.cards,
    required this.onSave,
    this.onFinished,
  });

  /// Due cards, in the order they should be reviewed.
  final List<Flashcard> cards;

  /// Persists a graded card's scheduling map to flashcards/{id}.
  final Future<void> Function(String cardId, Map<String, dynamic> update)
      onSave;

  /// Called once after the final card has been graded.
  final VoidCallback? onFinished;

  @override
  State<FlashcardReview> createState() => _FlashcardReviewState();
}

class _Grade {
  final ReviewGrade grade;
  final String label;
  final Color bg;
  final Color fg;
  const _Grade(this.grade, this.label, this.bg, this.fg);
}

class _FlashcardReviewState extends State<FlashcardReview> {
  static const _grades = [
    _Grade(ReviewGrade.again, 'Again', Color(0xFFB91C1C), Colors.white),
    _Grade(ReviewGrade.hard, 'Hard', Color(0xFFF59E0B), Colors.white),
    _Grade(ReviewGrade.good, 'Good', AppColors.teal, Colors.white),
    _Grade(ReviewGrade.easy, 'Easy', AppColors.accent, AppColors.primary),
  ];

  int _index = 0;
  bool _revealed = false;
  bool _saving = false;
  String? _error;
  bool _done = false;

  int get _total => widget.cards.length;
  Flashcard? get _card =>
      !_done && _index < _total ? widget.cards[_index] : null;

  void _advance() {
    setState(() {
      _revealed = false;
      _error = null;
      if (_index + 1 >= _total) {
        _done = true;
        widget.onFinished?.call();
      } else {
        _index++;
      }
    });
  }

  Future<void> _grade(ReviewGrade grade) async {
    final card = _card;
    if (card == null || _saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final next = review(card.schedule, grade, DateTime.now());
      await widget.onSave(card.id, Flashcard.scheduleUpdate(next));
      _advance();
    } catch (_) {
      setState(() {
        _error =
            "Couldn't save that review — check your connection and try again.";
      });
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_total == 0) return const SizedBox.shrink();

    final card = _card;
    if (_done || card == null) {
      return _SessionComplete(total: _total);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Progress row.
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('$_index / $_total reviewed',
                  style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.muted)),
              const Text('Tap the card to flip',
                  style: TextStyle(fontSize: 12, color: AppColors.muted)),
            ],
          ),
        ),

        // Card (tap to flip).
        InkWell(
          onTap: () => setState(() => _revealed = !_revealed),
          borderRadius: BorderRadius.circular(16),
          child: Card(
            child: Container(
              constraints: const BoxConstraints(minHeight: 220),
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_revealed ? 'ANSWER' : 'QUESTION',
                      style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.5,
                          color: AppColors.accent)),
                  const SizedBox(height: 10),
                  Expanded(
                    child: SingleChildScrollView(
                      child: Text(_revealed ? card.back : card.front,
                          style: const TextStyle(
                              fontSize: 18, color: AppColors.ink, height: 1.4)),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    _revealed
                        ? 'Tap to see the question again'
                        : 'Tap to reveal the answer',
                    style: const TextStyle(fontSize: 12, color: AppColors.muted),
                  ),
                ],
              ),
            ),
          ),
        ),

        if (_error != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFFEF2F2),
              border: Border.all(color: const Color(0xFFFECACA)),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(_error!,
                style:
                    const TextStyle(fontSize: 13, color: Color(0xFFB91C1C))),
          ),
        ],

        const SizedBox(height: 12),

        // Grade buttons (only once revealed).
        if (_revealed)
          Row(
            children: [
              for (var i = 0; i < _grades.length; i++) ...[
                if (i > 0) const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    onPressed:
                        _saving ? null : () => _grade(_grades[i].grade),
                    style: FilledButton.styleFrom(
                      backgroundColor: _grades[i].bg,
                      foregroundColor: _grades[i].fg,
                      minimumSize: const Size.fromHeight(46),
                      padding: EdgeInsets.zero,
                    ),
                    child: Text(_grades[i].label,
                        style: const TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w700)),
                  ),
                ),
              ],
            ],
          )
        else
          OutlinedButton(
            onPressed: () => setState(() => _revealed = true),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
            ),
            child: const Text('Show answer'),
          ),
      ],
    );
  }
}

class _SessionComplete extends StatelessWidget {
  const _SessionComplete({required this.total});
  final int total;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 16),
        child: Column(
          children: [
            Transform.rotate(
              angle: 0.785398,
              child: Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: AppColors.accent,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
            const SizedBox(height: 16),
            const Text('Session complete',
                style: TextStyle(
                    fontWeight: FontWeight.w700, color: AppColors.primary)),
            const SizedBox(height: 4),
            Text(
              'You reviewed $total card${total == 1 ? '' : 's'}. Nice work — come back when the next ones are due.',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          ],
        ),
      ),
    );
  }
}
