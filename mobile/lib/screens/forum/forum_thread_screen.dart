import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../logic/forum_rules.dart';
import '../../logic/relative_time.dart';
import '../../models/forum.dart';
import '../../services/firestore_service.dart';
import '../../state/auth_controller.dart';
import '../../state/thread_controller.dart';
import '../../theme/app_theme.dart';
import '../../util/offline.dart';
import '../../widgets/loading.dart';
import 'forum_gate.dart';

/// /forum/thread/:threadId — full thread view: original post + chronological
/// replies (realtime), reply composer (disabled when locked), time-boxed author
/// edit, emoji reactions, and report. Moderation "pending" shows a read-only
/// badge; "locked" disables replies. ALL user content is plain text. Mirrors
/// the web thread page (admin pin/lock/moderation is out of scope).
class ForumThreadScreen extends StatefulWidget {
  const ForumThreadScreen({super.key, required this.threadId});

  final String threadId;

  @override
  State<ForumThreadScreen> createState() => _ForumThreadScreenState();
}

class _ForumThreadScreenState extends State<ForumThreadScreen> {
  /// Client render cap for replies; a "Show more" reveals the rest.
  static const int _renderCap = 50;

  late final ForumThreadController _c;
  final _replyCtl = TextEditingController();

  bool _replyPosting = false;
  int _shown = _renderCap;

  // Inline OP edit
  bool _editingThread = false;
  final _editTitleCtl = TextEditingController();
  final _editBodyCtl = TextEditingController();

  // Inline post edit
  String? _editingPostId;
  final _editPostCtl = TextEditingController();

  @override
  void initState() {
    super.initState();
    final profile = context.read<AuthController>().profile;
    _c = ForumThreadController(
      firestore: context.read<FirestoreService>(),
      threadId: widget.threadId,
      uid: profile?.uid ?? '',
      role: profile?.role,
      displayName: resolveForumName(profile?.name, profile?.email),
    );
    _c.start();
  }

  @override
  void dispose() {
    _c.dispose();
    _replyCtl.dispose();
    _editTitleCtl.dispose();
    _editBodyCtl.dispose();
    _editPostCtl.dispose();
    super.dispose();
  }

  Future<void> _postReply() async {
    if (_replyPosting || _replyCtl.text.trim().isEmpty) return;
    setState(() => _replyPosting = true);
    final outcome = await _c.reply(_replyCtl.text);
    if (!mounted) return;
    if (outcome != WriteOutcome.failed) _replyCtl.clear();
    if (outcome == WriteOutcome.queuedOffline) showSavedOfflineSnackBar(context);
    setState(() => _replyPosting = false);
  }

  Future<void> _saveThreadEdit() async {
    final outcome = await _c.saveThreadEdit(
        title: _editTitleCtl.text, body: _editBodyCtl.text);
    if (!mounted) return;
    if (outcome != WriteOutcome.failed) setState(() => _editingThread = false);
    if (outcome == WriteOutcome.queuedOffline) showSavedOfflineSnackBar(context);
  }

  Future<void> _savePostEdit(String postId) async {
    final outcome = await _c.savePostEdit(postId, _editPostCtl.text);
    if (!mounted) return;
    if (outcome != WriteOutcome.failed) setState(() => _editingPostId = null);
    if (outcome == WriteOutcome.queuedOffline) showSavedOfflineSnackBar(context);
  }

  Future<void> _deleteThread() async {
    final outcome = await _c.deleteThread();
    if (!mounted) return;
    if (outcome != WriteOutcome.failed) {
      final catId = _c.thread?.categoryId;
      if (catId != null) {
        context.go('/forum/category/$catId');
      } else {
        context.go('/forum');
      }
    }
  }

  Future<void> _deletePost(String postId) async {
    final outcome = await _c.deletePost(postId);
    if (!mounted) return;
    if (outcome == WriteOutcome.queuedOffline) showSavedOfflineSnackBar(context);
  }

  Future<void> _report({String? postId}) async {
    final reason = await _showReportSheet(postId != null);
    if (reason == null || reason.trim().isEmpty) return;
    final outcome = await _c.report(postId: postId, reason: reason);
    if (!mounted) return;
    if (outcome != WriteOutcome.failed) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(
            content: Text('Report submitted. Thanks for flagging this.')));
    }
  }

  Future<String?> _showReportSheet(bool isReply) {
    final ctl = TextEditingController();
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 16,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Why are you reporting this ${isReply ? 'reply' : 'thread'}?',
                style: const TextStyle(
                    fontWeight: FontWeight.w700, color: AppColors.ink)),
            const SizedBox(height: 8),
            TextField(
              controller: ctl,
              maxLength: 1000,
              maxLines: 3,
              minLines: 2,
              decoration: const InputDecoration(
                  hintText: 'Reason', counterText: '', isDense: true),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(ctl.text),
              child: const Text('Submit report'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Thread')),
      body: ForumGate(
        child: ListenableBuilder(
          listenable: _c,
          builder: (context, _) {
            if (_c.loading) return const Loading();
            final thread = _c.thread;
            if (_c.error != null || thread == null) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Text(_c.error ?? 'Thread not found.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.red)),
                ),
              );
            }

            final now = DateTime.now().millisecondsSinceEpoch;
            final posts = _c.posts;
            final capped = posts.take(_shown).toList();

            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              children: [
                if (_c.actionError != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(_c.actionError!,
                        style:
                            const TextStyle(color: Colors.red, fontSize: 13)),
                  ),
                _originalPost(thread, now),
                const SizedBox(height: 16),
                Text(
                    '${thread.replyCount} repl${thread.replyCount == 1 ? 'y' : 'ies'}',
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, color: AppColors.ink)),
                const SizedBox(height: 8),
                ...capped.map((p) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _postTile(p, now),
                    )),
                if (_shown < posts.length)
                  Center(
                    child: TextButton(
                      onPressed: () => setState(() => _shown += _renderCap),
                      child:
                          Text('Show more (${posts.length - _shown} more)'),
                    ),
                  ),
                const SizedBox(height: 8),
                _replyComposer(thread),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _originalPost(ForumThread thread, int now) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: _editingThread
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _editTitleCtl,
                    maxLength: maxTitleLength,
                    decoration: const InputDecoration(
                        hintText: 'Title', counterText: '', isDense: true),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _editBodyCtl,
                    maxLength: maxBodyLength,
                    maxLines: 6,
                    minLines: 4,
                    decoration: const InputDecoration(
                        hintText: 'Body', counterText: '', isDense: true),
                  ),
                  const SizedBox(height: 8),
                  Row(children: [
                    FilledButton(
                        onPressed: _saveThreadEdit, child: const Text('Save')),
                    const SizedBox(width: 8),
                    TextButton(
                        onPressed: () =>
                            setState(() => _editingThread = false),
                        child: const Text('Cancel')),
                  ]),
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    if (thread.pinned)
                      const Padding(
                        padding: EdgeInsets.only(right: 4),
                        child: Icon(Icons.push_pin,
                            size: 16, color: AppColors.teal),
                      ),
                    if (thread.locked)
                      const Padding(
                        padding: EdgeInsets.only(right: 4),
                        child: Icon(Icons.lock_outline,
                            size: 16, color: AppColors.muted),
                      ),
                    Expanded(
                      child: Text(thread.title,
                          style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w700,
                              color: AppColors.ink)),
                    ),
                  ]),
                  if (thread.isPending) ...[
                    const SizedBox(height: 6),
                    _badge('Pending review'),
                  ],
                  const SizedBox(height: 4),
                  Text(
                      '${thread.authorName} · ${formatRelativeTime(thread.createdAtMillis, nowMillis: now)}${thread.editedAtMillis != null ? ' · edited' : ''}',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.muted)),
                  const SizedBox(height: 8),
                  SelectableText(thread.body,
                      style:
                          const TextStyle(fontSize: 14, color: AppColors.ink)),
                  const SizedBox(height: 8),
                  Wrap(spacing: 12, runSpacing: 4, children: [
                    if (_c.canEditThread(now))
                      _actionText('Edit', () {
                        _editTitleCtl.text = thread.title;
                        _editBodyCtl.text = thread.body;
                        setState(() => _editingThread = true);
                      }),
                    if (_c.canDeleteThread())
                      _actionText('Delete thread', _deleteThread,
                          color: Colors.red),
                    if (_c.isSignedIn)
                      _actionText('Report', () => _report(),
                          color: AppColors.muted),
                  ]),
                ],
              ),
      ),
    );
  }

  Widget _postTile(ForumPost post, int now) {
    final editing = _editingPostId == post.id;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.line),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
              '${post.authorName} · ${formatRelativeTime(post.createdAtMillis, nowMillis: now)}${post.editedAtMillis != null ? ' · edited' : ''}',
              style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          const SizedBox(height: 4),
          if (editing)
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _editPostCtl,
                  maxLength: maxBodyLength,
                  maxLines: 4,
                  minLines: 2,
                  decoration: const InputDecoration(
                      counterText: '', isDense: true),
                ),
                const SizedBox(height: 6),
                Row(children: [
                  FilledButton(
                      onPressed: () => _savePostEdit(post.id),
                      child: const Text('Save')),
                  const SizedBox(width: 8),
                  TextButton(
                      onPressed: () => setState(() => _editingPostId = null),
                      child: const Text('Cancel')),
                ]),
              ],
            )
          else
            SelectableText(post.body,
                style: const TextStyle(fontSize: 14, color: AppColors.ink)),
          const SizedBox(height: 8),
          _reactionRow(post),
          const SizedBox(height: 4),
          Wrap(spacing: 12, runSpacing: 4, children: [
            if (!editing && _c.canEditPost(post, now))
              _actionText('Edit', () {
                _editPostCtl.text = post.body;
                setState(() => _editingPostId = post.id);
              }),
            if (_c.canDeletePost(post))
              _actionText('Delete', () => _deletePost(post.id),
                  color: Colors.red),
            if (_c.isSignedIn)
              _actionText('Report', () => _report(postId: post.id),
                  color: AppColors.muted),
          ]),
        ],
      ),
    );
  }

  Widget _reactionRow(ForumPost post) {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: reactionEmoji.map((emoji) {
        final count = post.reactions[emoji]?.length ?? 0;
        final reacted = _c.reactedTo(post, emoji);
        return InkWell(
          onTap: _c.isSignedIn ? () => _c.react(post.id, emoji) : null,
          borderRadius: BorderRadius.circular(999),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: reacted ? AppColors.mint : Colors.transparent,
              border: Border.all(
                  color: reacted ? AppColors.teal : AppColors.line),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(count > 0 ? '$emoji $count' : emoji,
                style: TextStyle(
                    fontSize: 12,
                    color: reacted ? AppColors.primary : AppColors.muted)),
          ),
        );
      }).toList(),
    );
  }

  Widget _replyComposer(ForumThread thread) {
    if (!_c.isSignedIn) return const SizedBox.shrink();
    if (thread.locked) {
      return Card(
        child: const Padding(
          padding: EdgeInsets.all(16),
          child: Text('This thread is locked. New replies are disabled.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.muted)),
        ),
      );
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Add a reply',
                style: TextStyle(fontSize: 12, color: AppColors.muted)),
            const SizedBox(height: 4),
            TextField(
              controller: _replyCtl,
              maxLength: maxBodyLength,
              maxLines: 4,
              minLines: 2,
              decoration: const InputDecoration(
                hintText: 'Write a reply… Use @name to mention someone.',
                counterText: '',
                isDense: true,
              ),
            ),
            const SizedBox(height: 6),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton(
                onPressed: _replyPosting ? null : _postReply,
                child: Text(_replyPosting ? 'Posting…' : 'Post reply'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _badge(String text) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: AppColors.mint,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(text,
            style: const TextStyle(fontSize: 11, color: AppColors.primary)),
      );

  Widget _actionText(String label, VoidCallback onTap, {Color? color}) =>
      InkWell(
        onTap: onTap,
        child: Text(label,
            style: TextStyle(
                fontSize: 13,
                color: color ?? AppColors.teal,
                fontWeight: FontWeight.w600)),
      );
}
