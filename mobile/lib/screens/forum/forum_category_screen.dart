import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../logic/forum_rules.dart';
import '../../logic/relative_time.dart';
import '../../models/forum.dart';
import '../../services/firestore_service.dart';
import '../../state/auth_controller.dart';
import '../../state/forum_controller.dart';
import '../../theme/app_theme.dart';
import '../../widgets/loading.dart';
import 'forum_gate.dart';

/// /forum/category/:categoryId — realtime thread list for one category, with a
/// "new thread" composer and a title/body/tag search box. Threads sort
/// pinned-first then by last activity; pending-moderation threads are hidden for
/// non-admins. Mirrors the web category page.
class ForumCategoryScreen extends StatefulWidget {
  const ForumCategoryScreen({super.key, required this.categoryId});

  final String categoryId;

  @override
  State<ForumCategoryScreen> createState() => _ForumCategoryScreenState();
}

class _ForumCategoryScreenState extends State<ForumCategoryScreen> {
  /// Client render cap; a "Show more" reveals the rest. The realtime stream
  /// still holds every thread — this only bounds what we paint at once.
  static const int _renderCap = 30;

  late final ForumCategoryController _c;
  final _titleCtl = TextEditingController();
  final _bodyCtl = TextEditingController();
  final _searchCtl = TextEditingController();

  bool _composerOpen = false;
  bool _posting = false;
  int _shown = _renderCap;

  @override
  void initState() {
    super.initState();
    final profile = context.read<AuthController>().profile;
    _c = ForumCategoryController(
      firestore: context.read<FirestoreService>(),
      categoryId: widget.categoryId,
      uid: profile?.uid ?? '',
      role: profile?.role,
      cohortIds: profile?.cohortIds ?? const [],
      displayName: resolveForumName(profile?.name, profile?.email),
    );
    _c.start();
  }

  @override
  void dispose() {
    _c.dispose();
    _titleCtl.dispose();
    _bodyCtl.dispose();
    _searchCtl.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    if (_posting) return;
    if (_titleCtl.text.trim().isEmpty || _bodyCtl.text.trim().isEmpty) return;
    setState(() => _posting = true);
    final id = _c.createThread(title: _titleCtl.text, body: _bodyCtl.text);
    if (!mounted) return;
    setState(() => _posting = false);
    if (id != null) {
      _titleCtl.clear();
      _bodyCtl.clear();
      setState(() => _composerOpen = false);
      context.push('/forum/thread/$id');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Category')),
      body: ForumGate(
        child: ListenableBuilder(
          listenable: _c,
          builder: (context, _) {
            if (_c.denied) {
              return const Center(
                child: Padding(
                  padding: EdgeInsets.all(32),
                  child: Text("You don't have access to this category.",
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.muted)),
                ),
              );
            }
            if (_c.loading) return const Loading();
            if (_c.error != null) {
              return ListView(children: [
                const SizedBox(height: 120),
                ErrorRetry(message: _c.error!, onRetry: _c.start),
              ]);
            }

            final threads = _c.threads;
            final capped = threads.take(_shown).toList();
            final now = DateTime.now().millisecondsSinceEpoch;

            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_c.category?.name ?? 'Category',
                              style: const TextStyle(
                                  fontSize: 20,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.ink)),
                          if ((_c.category?.description ?? '').isNotEmpty)
                            Text(_c.category!.description,
                                style: const TextStyle(
                                    fontSize: 13, color: AppColors.muted)),
                        ],
                      ),
                    ),
                    if (_c.isSignedIn)
                      TextButton(
                        onPressed: () =>
                            setState(() => _composerOpen = !_composerOpen),
                        child: Text(_composerOpen ? 'Cancel' : 'New thread'),
                      ),
                  ],
                ),
                if (_composerOpen && _c.isSignedIn) _composer(),
                const SizedBox(height: 12),
                TextField(
                  controller: _searchCtl,
                  onChanged: _c.setSearch,
                  decoration: const InputDecoration(
                    hintText: 'Search threads…',
                    isDense: true,
                    prefixIcon: Icon(Icons.search, size: 18),
                  ),
                ),
                const SizedBox(height: 12),
                if (threads.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 40),
                    child: Center(
                      child: Text(
                          _c.search.trim().isNotEmpty
                              ? 'No threads match your search.'
                              : 'No threads yet — start the first one.',
                          style: const TextStyle(color: AppColors.muted)),
                    ),
                  )
                else ...[
                  ...capped.map((t) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: _ThreadTile(
                          thread: t,
                          nowMillis: now,
                          onTap: () => context.push('/forum/thread/${t.id}'),
                        ),
                      )),
                  if (_shown < threads.length)
                    Center(
                      child: TextButton(
                        onPressed: () =>
                            setState(() => _shown += _renderCap),
                        child: Text(
                            'Show more (${threads.length - _shown} more)'),
                      ),
                    ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _composer() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _titleCtl,
              maxLength: maxTitleLength,
              decoration: const InputDecoration(
                hintText: 'Thread title',
                counterText: '',
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _bodyCtl,
              maxLength: maxBodyLength,
              maxLines: 4,
              minLines: 3,
              decoration: const InputDecoration(
                hintText:
                    "What's on your mind? Use @name to mention someone.",
                counterText: '',
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton(
                onPressed: _posting ? null : _create,
                child: Text(_posting ? 'Posting…' : 'Post thread'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ThreadTile extends StatelessWidget {
  const _ThreadTile({
    required this.thread,
    required this.nowMillis,
    required this.onTap,
  });

  final ForumThread thread;
  final int nowMillis;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final activity = thread.lastReplyAtMillis ?? thread.createdAtMillis;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (thread.pinned)
                    const Padding(
                      padding: EdgeInsets.only(right: 4),
                      child: Icon(Icons.push_pin,
                          size: 14, color: AppColors.teal),
                    ),
                  if (thread.locked)
                    const Padding(
                      padding: EdgeInsets.only(right: 4),
                      child: Icon(Icons.lock_outline,
                          size: 14, color: AppColors.muted),
                    ),
                  Expanded(
                    child: Text(thread.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            color: AppColors.ink)),
                  ),
                  Text(
                      '${thread.replyCount} repl${thread.replyCount == 1 ? 'y' : 'ies'}',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.muted)),
                ],
              ),
              const SizedBox(height: 2),
              Text(
                  '${thread.authorName} · ${formatRelativeTime(activity, nowMillis: nowMillis)}',
                  style:
                      const TextStyle(fontSize: 12, color: AppColors.muted)),
            ],
          ),
        ),
      ),
    );
  }
}
