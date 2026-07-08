import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../logic/relative_time.dart';
import '../../models/discussion.dart';
import '../../services/firestore_service.dart';
import '../../state/auth_controller.dart';
import '../../state/discussion_controller.dart';
import '../../theme/app_theme.dart';
import '../../util/offline.dart';

/// Collapsible "Discussion (N)" per-lesson Q&A panel (7C). Mirrors the web
/// `DiscussionPanel`: eager count load, single-level threads (newest questions,
/// oldest replies), plain-text rendering, author/admin delete, no edits.
class DiscussionPanel extends StatefulWidget {
  const DiscussionPanel({
    super.key,
    required this.courseId,
    required this.lessonId,
  });

  final String courseId;
  final String lessonId;

  @override
  State<DiscussionPanel> createState() => _DiscussionPanelState();
}

class _DiscussionPanelState extends State<DiscussionPanel> {
  static const int _maxBody = 2000;

  late final DiscussionController _c;
  final TextEditingController _newBody = TextEditingController();
  final TextEditingController _replyBody = TextEditingController();

  bool _open = false;
  bool _posting = false;
  String? _replyFor; // thread id the reply composer is open for
  String? _confirmDeleteId;

  @override
  void initState() {
    super.initState();
    final profile = context.read<AuthController>().profile;
    _c = DiscussionController(
      firestore: context.read<FirestoreService>(),
      courseId: widget.courseId,
      lessonId: widget.lessonId,
      uid: profile?.uid ?? '',
      role: profile?.role,
      displayName: _resolveName(profile?.name, profile?.email),
    );
    _c.load();
  }

  static String _resolveName(String? name, String? email) {
    final n = (name ?? '').trim();
    final prefix = (email ?? '').split('@').first;
    final resolved = n.isNotEmpty ? n : (prefix.isNotEmpty ? prefix : 'Learner');
    return resolved.length > 100 ? resolved.substring(0, 100) : resolved;
  }

  @override
  void dispose() {
    _c.dispose();
    _newBody.dispose();
    _replyBody.dispose();
    super.dispose();
  }

  Future<void> _postQuestion() async {
    if (_posting || _newBody.text.trim().isEmpty) return;
    setState(() => _posting = true);
    final outcome = await _c.post(_newBody.text, parentId: null);
    if (!mounted) return;
    if (outcome != WriteOutcome.failed) _newBody.clear();
    if (outcome == WriteOutcome.queuedOffline) showSavedOfflineSnackBar(context);
    setState(() => _posting = false);
  }

  Future<void> _postReply(String parentId) async {
    if (_posting || _replyBody.text.trim().isEmpty) return;
    setState(() => _posting = true);
    final outcome = await _c.post(_replyBody.text, parentId: parentId);
    if (!mounted) return;
    if (outcome != WriteOutcome.failed) {
      _replyBody.clear();
      _replyFor = null;
    }
    if (outcome == WriteOutcome.queuedOffline) showSavedOfflineSnackBar(context);
    setState(() => _posting = false);
  }

  Future<void> _delete(String id) async {
    final outcome = await _c.delete(id);
    if (!mounted) return;
    setState(() => _confirmDeleteId = null);
    if (outcome == WriteOutcome.queuedOffline) showSavedOfflineSnackBar(context);
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: ListenableBuilder(
        listenable: _c,
        builder: (context, _) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _header(),
              if (_open) ...[
                const Divider(height: 1, color: AppColors.line),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                  child: _body(),
                ),
              ],
            ],
          );
        },
      ),
    );
  }

  Widget _header() {
    final label = _c.loading ? 'Discussion' : 'Discussion (${_c.count})';
    return Semantics(
      button: true,
      expanded: _open,
      label: label,
      child: InkWell(
        onTap: () => setState(() => _open = !_open),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              const Icon(Icons.forum_outlined,
                  size: 18, color: AppColors.accent),
              const SizedBox(width: 8),
              Expanded(
                child: Text(label,
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, color: AppColors.primary)),
              ),
              Icon(_open ? Icons.expand_less : Icons.expand_more,
                  color: AppColors.muted),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_c.actionError != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(_c.actionError!,
                style: const TextStyle(color: Colors.red, fontSize: 12)),
          ),
        if (_c.isSignedIn) _questionComposer(),
        const SizedBox(height: 8),
        _list(),
      ],
    );
  }

  Widget _questionComposer() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text('Ask a question about this lesson',
            style: TextStyle(fontSize: 12, color: AppColors.muted)),
        const SizedBox(height: 4),
        TextField(
          controller: _newBody,
          maxLength: _maxBody,
          maxLines: 3,
          minLines: 1,
          decoration: const InputDecoration(
            hintText: 'What would you like to ask?',
            counterText: '',
            isDense: true,
          ),
        ),
        const SizedBox(height: 6),
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton(
            onPressed: _posting ? null : _postQuestion,
            child: Text(_posting ? 'Posting…' : 'Post question'),
          ),
        ),
      ],
    );
  }

  Widget _list() {
    if (_c.loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Text('Loading discussion…',
            style: TextStyle(color: AppColors.muted, fontSize: 13)),
      );
    }
    if (_c.loadError != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_c.loadError!,
              style: const TextStyle(color: Colors.red, fontSize: 13)),
          const SizedBox(height: 6),
          OutlinedButton(onPressed: _c.load, child: const Text('Try again')),
        ],
      );
    }
    final threads = _c.threads;
    if (threads.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Text('No questions yet — ask the first one',
            style: TextStyle(color: AppColors.muted, fontSize: 13)),
      );
    }
    final now = DateTime.now().millisecondsSinceEpoch;
    return Column(
      children: [
        for (final t in threads)
          Container(
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.line),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _meta(t.post, now),
                const SizedBox(height: 4),
                SelectableText(t.post.body,
                    style: const TextStyle(fontSize: 14, color: AppColors.ink)),
                if (_c.isSignedIn)
                  TextButton(
                    style: TextButton.styleFrom(
                        padding: EdgeInsets.zero,
                        minimumSize: const Size(0, 32),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap),
                    onPressed: () => setState(() {
                      _replyBody.clear();
                      _replyFor = _replyFor == t.post.id ? null : t.post.id;
                    }),
                    child: Text(
                        _replyFor == t.post.id ? 'Cancel reply' : 'Reply',
                        style: const TextStyle(fontSize: 12)),
                  ),
                if (_c.isSignedIn && _replyFor == t.post.id)
                  _replyComposer(t.post.id, t.post.userName),
                if (t.replies.isNotEmpty)
                  Container(
                    margin: const EdgeInsets.only(top: 8),
                    padding: const EdgeInsets.only(left: 12),
                    decoration: const BoxDecoration(
                      border: Border(
                        left: BorderSide(color: AppColors.line, width: 2),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (final r in t.replies) ...[
                          _meta(r, now),
                          const SizedBox(height: 2),
                          SelectableText(r.body,
                              style: const TextStyle(
                                  fontSize: 13.5, color: AppColors.ink)),
                          const SizedBox(height: 8),
                        ],
                      ],
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _replyComposer(String parentId, String toName) {
    return Padding(
      padding: const EdgeInsets.only(top: 6, bottom: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Reply to $toName',
              style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          const SizedBox(height: 4),
          TextField(
            controller: _replyBody,
            maxLength: _maxBody,
            maxLines: 2,
            minLines: 1,
            decoration: const InputDecoration(
              hintText: 'Write a reply…',
              counterText: '',
              isDense: true,
            ),
          ),
          const SizedBox(height: 6),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton(
              onPressed: _posting ? null : () => _postReply(parentId),
              child: Text(_posting ? 'Posting…' : 'Post reply'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _meta(Discussion post, int now) {
    final canDel = _c.canDeletePost(post);
    return Row(
      children: [
        Flexible(
          child: Text(post.userName,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.primary)),
        ),
        const SizedBox(width: 8),
        Text(formatRelativeTime(post.createdAtMillis, nowMillis: now),
            style: const TextStyle(fontSize: 11, color: AppColors.muted)),
        const Spacer(),
        if (canDel)
          if (_confirmDeleteId == post.id) ...[
            TextButton(
              style: TextButton.styleFrom(
                  padding: EdgeInsets.zero,
                  minimumSize: const Size(0, 28),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap),
              onPressed: () => _delete(post.id),
              child: const Text('Confirm',
                  style: TextStyle(fontSize: 11, color: Colors.red)),
            ),
            const SizedBox(width: 8),
            TextButton(
              style: TextButton.styleFrom(
                  padding: EdgeInsets.zero,
                  minimumSize: const Size(0, 28),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap),
              onPressed: () => setState(() => _confirmDeleteId = null),
              child: const Text('Cancel',
                  style: TextStyle(fontSize: 11, color: AppColors.muted)),
            ),
          ] else
            IconButton(
              tooltip: 'Delete post',
              visualDensity: VisualDensity.compact,
              iconSize: 16,
              color: Colors.red,
              icon: const Icon(Icons.delete_outline),
              onPressed: () => setState(() => _confirmDeleteId = post.id),
            ),
      ],
    );
  }
}
