import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../logic/gamification.dart';
import '../../models/gamification_stats.dart';
import '../../services/callable_service.dart';
import '../../services/firestore_service.dart';
import '../../state/achievements_controller.dart';
import '../../state/auth_controller.dart';
import '../../theme/app_theme.dart';
import '../../widgets/loading.dart';

/// Achievements — XP + level, badge grid (earned & locked-with-progress) and
/// the cohort leaderboard. Mirrors `src/app/learn/achievements/page.tsx`.
/// Body-only: the shell owns the AppBar.
class AchievementsScreen extends StatefulWidget {
  const AchievementsScreen({super.key});

  @override
  State<AchievementsScreen> createState() => _AchievementsScreenState();
}

class _AchievementsScreenState extends State<AchievementsScreen> {
  static const _medals = ['🥇', '🥈', '🥉'];
  static final _num = NumberFormat.decimalPattern();

  late final AchievementsController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AchievementsController(
      firestore: context.read<FirestoreService>(),
      callable: context.read<CallableService>(),
    );
    _reload();
  }

  void _reload() {
    final user = context.read<AuthController>().profile;
    if (user != null) _controller.load(user.uid, user.cohortIds);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => _reload(),
      child: ListenableBuilder(
        listenable: _controller,
        builder: (context, _) {
          final summary = _controller.summary;
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              _hero(),
              const SizedBox(height: 16),
              if (_controller.statsError != null) ...[
                _errorBanner(_controller.statsError!),
                const SizedBox(height: 16),
              ],
              if (summary == null)
                const Padding(
                  padding: EdgeInsets.only(top: 80),
                  child: Loading(),
                )
              else ...[
                _levelCard(summary),
                const SizedBox(height: 24),
                const Text('Badges',
                    style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary)),
                const SizedBox(height: 12),
                _badgeGrid(summary),
                const SizedBox(height: 24),
                _leaderboardHeader(),
                const SizedBox(height: 12),
                _leaderboardCard(),
              ],
            ],
          );
        },
      ),
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
          Text('MY LEARNING · GAMIFICATION',
              style: TextStyle(
                  color: AppColors.accent,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1)),
          SizedBox(height: 6),
          Text('Achievements',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 24,
                  fontWeight: FontWeight.w700)),
          SizedBox(height: 4),
          Text(
              'Earn XP for every lesson, assessment and certificate. Keep the streak alive.',
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

  Widget _levelCard(GamificationSummary summary) {
    final LevelInfo level = summary.level;
    final int xp = summary.xp;
    final stats = summary.stats;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Row(
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(
                        color: AppColors.primary,
                        shape: BoxShape.circle,
                      ),
                      child: Text('${level.level}',
                          style: const TextStyle(
                              color: AppColors.mint,
                              fontSize: 20,
                              fontWeight: FontWeight.w700)),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Level ${level.level}',
                            style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                color: AppColors.ink)),
                        Text('${_num.format(xp)} XP total',
                            style: const TextStyle(
                                fontSize: 12, color: AppColors.muted)),
                      ],
                    ),
                  ],
                ),
                Flexible(
                  child: Wrap(
                    spacing: 14,
                    alignment: WrapAlignment.end,
                    children: [
                      _stat('${stats.lessonsCompleted}', 'lessons'),
                      _stat('${stats.quizzesPassed}', 'passed'),
                      _stat('${stats.certificates}', 'certs'),
                      _stat('${stats.streakDays}', 'day streak'),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: LinearProgressIndicator(
                value: level.pct / 100,
                minHeight: 8,
                backgroundColor: AppColors.mint,
                valueColor: const AlwaysStoppedAnimation(AppColors.accent),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              level.needed > 0
                  ? '${_num.format(level.needed)} XP to level ${level.level + 1}'
                  : 'Max level reached — you’ve outgrown the chart 🎉',
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _stat(String value, String label) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(value,
            style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.ink)),
        Text(label,
            style: const TextStyle(fontSize: 11, color: AppColors.muted)),
      ],
    );
  }

  Widget _badgeGrid(GamificationSummary summary) {
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 3,
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 0.78,
      children: kBadges.map((b) {
        final earned = summary.isEarned(b);
        final progress = summary.progressOf(b);
        return Opacity(
          opacity: earned ? 1 : 0.6,
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(b.emoji, style: const TextStyle(fontSize: 30)),
                  const SizedBox(height: 4),
                  Text(b.title,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink)),
                  const SizedBox(height: 2),
                  Text(b.description,
                      textAlign: TextAlign.center,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 10, color: AppColors.muted, height: 1.1)),
                  if (!earned) ...[
                    const SizedBox(height: 8),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(999),
                      child: LinearProgressIndicator(
                        value: progress / 100,
                        minHeight: 4,
                        backgroundColor: AppColors.mint,
                        valueColor:
                            const AlwaysStoppedAnimation(AppColors.accent),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _leaderboardHeader() {
    final cohortIds = _controller.cohortIds;
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        const Text('Cohort leaderboard',
            style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: AppColors.primary)),
        if (cohortIds.length > 1)
          DropdownButton<String>(
            value: _controller.boardCohort,
            underline: const SizedBox.shrink(),
            style: const TextStyle(fontSize: 13, color: AppColors.ink),
            items: cohortIds
                .map((id) => DropdownMenuItem(
                      value: id,
                      child: Text(
                        _controller.boardCohort == id &&
                                _controller.board != null
                            ? _controller.board!.cohortName
                            : id,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ))
                .toList(),
            onChanged: (id) {
              if (id != null) _controller.loadBoard(id);
            },
          ),
      ],
    );
  }

  Widget _leaderboardCard() {
    final board = _controller.board;
    final hasCohort = _controller.cohortIds.isNotEmpty;
    Widget body;
    if (_controller.boardLoading) {
      body = const Padding(padding: EdgeInsets.all(24), child: Loading());
    } else if (_controller.boardError != null) {
      body = Padding(
        padding: const EdgeInsets.all(16),
        child: Text(_controller.boardError!,
            style: const TextStyle(fontSize: 13, color: AppColors.muted)),
      );
    } else if (board == null || board.rows.isEmpty) {
      body = Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          hasCohort
              ? 'No activity in this cohort yet — be the first on the board.'
              : 'Join a cohort to see its leaderboard.',
          style: const TextStyle(fontSize: 13, color: AppColors.muted),
        ),
      );
    } else {
      body = _leaderboardTable(board);
    }

    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          body,
          if (board?.truncated ?? false)
            const Padding(
              padding: EdgeInsets.all(12),
              child: Text('Showing the first 50 members.',
                  style: TextStyle(fontSize: 11, color: AppColors.muted)),
            ),
        ],
      ),
    );
  }

  Widget _leaderboardTable(LeaderboardResult board) {
    return Column(
      children: [
        // Header row.
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: AppColors.line)),
          ),
          child: Row(
            children: const [
              SizedBox(
                  width: 32,
                  child: Text('#',
                      style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: AppColors.muted))),
              Expanded(
                  child: Text('LEARNER',
                      style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: AppColors.muted))),
              SizedBox(
                  width: 56,
                  child: Text('LESSONS',
                      textAlign: TextAlign.right,
                      style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: AppColors.muted))),
              SizedBox(
                  width: 44,
                  child: Text('CERTS',
                      textAlign: TextAlign.right,
                      style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: AppColors.muted))),
              SizedBox(
                  width: 56,
                  child: Text('XP',
                      textAlign: TextAlign.right,
                      style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: AppColors.muted))),
            ],
          ),
        ),
        ...board.rows.asMap().entries.map((entry) {
          final i = entry.key;
          final r = entry.value;
          final rank = i < _medals.length ? _medals[i] : '${i + 1}';
          return Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            color: r.isYou ? AppColors.mint : null,
            child: Row(
              children: [
                SizedBox(
                    width: 32,
                    child: Text(rank,
                        style: const TextStyle(fontSize: 13))),
                Expanded(
                  child: Text.rich(
                    TextSpan(children: [
                      TextSpan(
                          text: r.name,
                          style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: AppColors.ink)),
                      if (r.isYou)
                        const TextSpan(
                            text: ' (you)',
                            style: TextStyle(
                                fontSize: 11, color: AppColors.teal)),
                    ]),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                SizedBox(
                    width: 56,
                    child: Text('${r.lessonsCompleted}',
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                            fontSize: 13, color: AppColors.muted))),
                SizedBox(
                    width: 44,
                    child: Text('${r.certificates}',
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                            fontSize: 13, color: AppColors.muted))),
                SizedBox(
                    width: 56,
                    child: Text(_num.format(r.xp),
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: AppColors.teal))),
              ],
            ),
          );
        }),
      ],
    );
  }
}
