import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../services/callable_service.dart';
import '../../services/firestore_service.dart';
import '../../state/auth_controller.dart';
import '../../state/review_controller.dart';
import '../../theme/app_theme.dart';
import '../../widgets/flashcard_review.dart';
import '../../widgets/loading.dart';

/// Spaced-repetition flashcard review — mirrors `src/app/learn/review/page.tsx`.
/// Body-only: the shell owns the AppBar.
class ReviewScreen extends StatefulWidget {
  const ReviewScreen({super.key});

  @override
  State<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends State<ReviewScreen> {
  late final ReviewController _controller;

  @override
  void initState() {
    super.initState();
    _controller = ReviewController(
      firestore: context.read<FirestoreService>(),
      callable: context.read<CallableService>(),
    );
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
    return RefreshIndicator(
      onRefresh: () async => _controller.reload(),
      child: ListenableBuilder(
        listenable: _controller,
        builder: (context, _) {
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              _hero(),
              const SizedBox(height: 16),
              if (_controller.loadError != null) ...[
                _errorBanner(_controller.loadError!),
                const SizedBox(height: 16),
              ],
              if (_controller.loading)
                const Padding(padding: EdgeInsets.only(top: 60), child: Loading())
              else ...[
                _sessionArea(),
                const SizedBox(height: 16),
                _generateCard(),
              ],
            ],
          );
        },
      ),
    );
  }

  Widget _sessionArea() {
    if (_controller.cards.isEmpty) return _noCards();
    if (_controller.dueCards.isEmpty) return _allCaughtUp();
    return FlashcardReview(
      key: ValueKey(_controller.sessionKey),
      cards: _controller.dueCards,
      onSave: _controller.saveSchedule,
    );
  }

  Widget _hero() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.primary,
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('MY LEARNING · FLASHCARDS',
              style: TextStyle(
                  color: AppColors.accent,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1)),
          SizedBox(height: 6),
          Text('Review',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 24,
                  fontWeight: FontWeight.w700)),
          SizedBox(height: 4),
          Text('Short, spaced reviews beat cramming — grade yourself honestly.',
              style: TextStyle(color: AppColors.mist, fontSize: 13)),
        ],
      ),
    );
  }

  Widget _errorBanner(String message) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF2F2),
        border: Border.all(color: const Color(0xFFFECACA)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(message,
          style: const TextStyle(fontSize: 13, color: Color(0xFFB91C1C))),
    );
  }

  Widget _noCards() {
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
            const Text('No flashcards yet',
                style: TextStyle(
                    fontWeight: FontWeight.w700, color: AppColors.primary)),
            const SizedBox(height: 4),
            const Text(
              'Generate a deck from one of your courses below, or open a course to study first.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _allCaughtUp() {
    final next = _controller.nextDue;
    final msg = next != null
        ? 'Your next review is due ${DateFormat('EEE, d MMM, HH:mm').format(next)}.'
        : 'Nothing scheduled — generate more cards below.';
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 16),
        child: Column(
          children: [
            const Text('🎉', style: TextStyle(fontSize: 26)),
            const SizedBox(height: 8),
            const Text('All caught up',
                style: TextStyle(
                    fontWeight: FontWeight.w700, color: AppColors.primary)),
            const SizedBox(height: 4),
            Text(msg,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 13, color: AppColors.muted)),
          ],
        ),
      ),
    );
  }

  Widget _generateCard() {
    final courses = _controller.courses;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Generate flashcards',
                style: TextStyle(
                    fontWeight: FontWeight.w700, color: AppColors.ink)),
            const SizedBox(height: 4),
            const Text(
              "AI builds a fresh deck from a course's lessons. Regenerating a course replaces its previous deck.",
              style: TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            const SizedBox(height: 12),
            if (courses.isEmpty)
              const Text(
                'No published courses available to you yet — ask your admin.',
                style: TextStyle(fontSize: 13, color: AppColors.muted),
              )
            else ...[
              DropdownButtonFormField<String>(
                value: _controller.selectedCourseId,
                isExpanded: true,
                decoration: const InputDecoration(
                  contentPadding:
                      EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                ),
                items: courses
                    .map((c) => DropdownMenuItem(
                          value: c.id,
                          child: Text(c.title, overflow: TextOverflow.ellipsis),
                        ))
                    .toList(),
                onChanged: _controller.generating
                    ? null
                    : (id) {
                        if (id != null) _controller.selectCourse(id);
                      },
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: (_controller.generating ||
                        _controller.selectedCourseId == null)
                    ? null
                    : _controller.generate,
                child: Text(_controller.generating
                    ? 'Generating…'
                    : 'Generate flashcards'),
              ),
            ],
            if (_controller.genError != null) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF2F2),
                  border: Border.all(color: const Color(0xFFFECACA)),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(_controller.genError!,
                    style: const TextStyle(
                        fontSize: 13, color: Color(0xFFB91C1C))),
              ),
            ],
            if (_controller.genSuccess != null) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.mint,
                  border: Border.all(color: AppColors.line),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(_controller.genSuccess!,
                    style: const TextStyle(fontSize: 13, color: AppColors.teal)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
