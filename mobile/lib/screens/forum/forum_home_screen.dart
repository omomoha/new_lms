import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../models/forum.dart';
import '../../services/firestore_service.dart';
import '../../state/auth_controller.dart';
import '../../state/forum_controller.dart';
import '../../theme/app_theme.dart';
import '../../widgets/loading.dart';
import 'forum_gate.dart';

/// /forum — community forum landing: the categories the signed-in user may view
/// ("all", or "cohort" categories intersecting their cohortIds). Gated behind
/// the `communityForum` feature flag. Mirrors the web `/learn/forum` page.
class ForumHomeScreen extends StatefulWidget {
  const ForumHomeScreen({super.key});

  @override
  State<ForumHomeScreen> createState() => _ForumHomeScreenState();
}

class _ForumHomeScreenState extends State<ForumHomeScreen> {
  late final ForumHomeController _c;

  @override
  void initState() {
    super.initState();
    final profile = context.read<AuthController>().profile;
    _c = ForumHomeController(
      firestore: context.read<FirestoreService>(),
      role: profile?.role,
      cohortIds: profile?.cohortIds ?? const [],
    );
    _c.load();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Forum')),
      body: ForumGate(
        child: RefreshIndicator(
          onRefresh: _c.load,
          child: ListenableBuilder(
            listenable: _c,
            builder: (context, _) {
              if (_c.loading) return const Loading();
              if (_c.error != null) {
                return ListView(children: [
                  const SizedBox(height: 120),
                  ErrorRetry(message: _c.error!, onRetry: _c.load),
                ]);
              }
              final cats = _c.categories;
              return ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                children: [
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: const [
                        Text('COMMUNITY',
                            style: TextStyle(
                                color: AppColors.accent,
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 1)),
                        SizedBox(height: 6),
                        Text('Forum',
                            style: TextStyle(
                                color: Colors.white,
                                fontSize: 24,
                                fontWeight: FontWeight.w700)),
                        SizedBox(height: 4),
                        Text(
                            'Ask questions, share wins, and connect across cohorts.',
                            style: TextStyle(
                                color: AppColors.mist, fontSize: 13)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (cats.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 64),
                      child: Center(
                        child: Text('No forum categories are open to you yet.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: AppColors.muted)),
                      ),
                    )
                  else
                    ...cats.map((c) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: _CategoryCard(
                            category: c,
                            onTap: () => context.push('/forum/category/${c.id}'),
                          ),
                        )),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class _CategoryCard extends StatelessWidget {
  const _CategoryCard({required this.category, required this.onTap});

  final ForumCategory category;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(category.name,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            color: AppColors.ink)),
                    if (category.description.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(category.description,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 13, color: AppColors.muted)),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                      '${category.postCount} thread${category.postCount == 1 ? '' : 's'}',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.muted)),
                  if (category.visibility == 'cohort') ...[
                    const SizedBox(height: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.mint,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: const Text('cohort',
                          style: TextStyle(
                              fontSize: 11, color: AppColors.primary)),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
