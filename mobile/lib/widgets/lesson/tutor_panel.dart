import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:provider/provider.dart';

import '../../logic/tutor_markdown.dart';
import '../../models/tutor.dart';
import '../../services/callable_service.dart';
import '../../services/feature_flags_service.dart';
import '../../services/firestore_service.dart';
import '../../state/tutor_controller.dart';
import '../../theme/app_theme.dart';

/// Collapsible "Ask the AI tutor" chat panel for the lesson screen (7A).
///
/// The base chat works with no flag; conversation persistence + thumbs feedback
/// are gated behind `tutorEnhancements`. Assistant answers render as INERT
/// Markdown via flutter_markdown (no tappable links — see logic/tutor_markdown);
/// user turns are plain [SelectableText].
class TutorPanel extends StatefulWidget {
  const TutorPanel({
    super.key,
    required this.courseId,
    required this.uid,
    this.moduleId,
    this.lessonId,
  });

  final String courseId;
  final String uid;
  final String? moduleId;
  final String? lessonId;

  @override
  State<TutorPanel> createState() => _TutorPanelState();
}

class _TutorPanelState extends State<TutorPanel> {
  static const List<String> _starters = [
    'Summarize the key ideas I should take away from this lesson.',
    'Can you walk me through a practical example?',
    'What should I focus on to pass the assessment?',
  ];

  late final TutorController _c;
  final TextEditingController _input = TextEditingController();
  final ScrollController _scroll = ScrollController();
  bool _open = false;

  @override
  void initState() {
    super.initState();
    _c = TutorController(
      callable: context.read<CallableService>(),
      firestore: context.read<FirestoreService>(),
      courseId: widget.courseId,
      uid: widget.uid,
      moduleId: widget.moduleId,
      lessonId: widget.lessonId,
    );
    // Resolve the tutorEnhancements flag once, then reflect it on the controller.
    final flags = context.read<FeatureFlagsService>();
    flags.ensureLoaded().then((_) {
      if (mounted) _c.setEnhanced(flags.isTutorEnhancements);
    });
  }

  @override
  void dispose() {
    _c.dispose();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.jumpTo(_scroll.position.maxScrollExtent);
      }
    });
  }

  Future<void> _send([String? raw]) async {
    final text = (raw ?? _input.text).trim();
    if (text.isEmpty || _c.sending) return;
    _input.clear();
    await _c.send(text);
    _scrollToEnd();
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _header(),
          if (_open) ...[
            const Divider(height: 1, color: AppColors.line),
            _conversation(),
            const Divider(height: 1, color: AppColors.line),
            _composer(),
          ],
        ],
      ),
    );
  }

  Widget _header() {
    return Semantics(
      button: true,
      expanded: _open,
      label: 'Ask the AI tutor',
      child: InkWell(
        onTap: () => setState(() => _open = !_open),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              const Icon(Icons.auto_awesome, size: 18, color: AppColors.accent),
              const SizedBox(width: 8),
              const Expanded(
                child: Text('Ask the AI tutor',
                    style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary)),
              ),
              Icon(_open ? Icons.expand_less : Icons.expand_more,
                  color: AppColors.muted),
            ],
          ),
        ),
      ),
    );
  }

  Widget _conversation() {
    return ListenableBuilder(
      listenable: _c,
      builder: (context, _) {
        final msgs = _c.messages;
        return ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 340),
          child: ListView(
            controller: _scroll,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            shrinkWrap: true,
            children: [
              if (msgs.isEmpty && !_c.sending) _starterChips(),
              for (var i = 0; i < msgs.length; i++) _turn(i, msgs[i]),
              if (_c.sending)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Row(children: [
                    SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2)),
                    SizedBox(width: 8),
                    Text('The tutor is thinking…',
                        style: TextStyle(color: AppColors.muted, fontSize: 13)),
                  ]),
                ),
              if (_c.error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(_c.error!,
                      style: const TextStyle(color: Colors.red, fontSize: 13)),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _starterChips() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Ask anything about this course — the tutor answers from the course '
          'material. Try one of these:',
          style: TextStyle(color: AppColors.muted, fontSize: 12),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: _starters
              .map((q) => ActionChip(
                    label: Text(q, style: const TextStyle(fontSize: 12)),
                    backgroundColor: AppColors.mint,
                    onPressed: () => _send(q),
                  ))
              .toList(),
        ),
      ],
    );
  }

  Widget _turn(int index, TutorTurn m) {
    if (m.isUser) {
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          margin: const EdgeInsets.only(top: 8, left: 32),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: AppColors.primary,
            borderRadius: BorderRadius.circular(14),
          ),
          child: SelectableText(m.content,
              style: const TextStyle(color: Colors.white, fontSize: 14)),
        ),
      );
    }
    // Assistant: inert Markdown (no tappable links).
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(top: 8, right: 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: AppColors.mint,
                borderRadius: BorderRadius.circular(14),
              ),
              child: MarkdownBody(
                data: inertTutorMarkdown(m.content),
                selectable: true,
                // Links are stripped upstream; keep tap handling inert anyway.
                onTapLink: null,
                styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context))
                    .copyWith(
                  p: const TextStyle(color: AppColors.ink, fontSize: 14),
                  code: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12.5,
                    backgroundColor: Color(0x14000000),
                  ),
                  codeblockDecoration: BoxDecoration(
                    color: AppColors.primaryDark,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  codeblockPadding: const EdgeInsets.all(10),
                ),
              ),
            ),
            if (_c.canRate) _feedbackRow(index),
          ],
        ),
      ),
    );
  }

  Widget _feedbackRow(int index) {
    final chosen = _c.feedback[index];
    return Padding(
      padding: const EdgeInsets.only(top: 4, left: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            visualDensity: VisualDensity.compact,
            tooltip: 'Helpful',
            iconSize: 18,
            color: chosen == 'up' ? AppColors.teal : AppColors.muted,
            icon: const Icon(Icons.thumb_up_alt_outlined),
            onPressed: () => _c.rate(index, 'up'),
          ),
          IconButton(
            visualDensity: VisualDensity.compact,
            tooltip: 'Not helpful',
            iconSize: 18,
            color: chosen == 'down' ? Colors.red : AppColors.muted,
            icon: const Icon(Icons.thumb_down_alt_outlined),
            onPressed: () => _c.rate(index, 'down'),
          ),
        ],
      ),
    );
  }

  Widget _composer() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextField(
              controller: _input,
              maxLength: 2000,
              maxLines: 4,
              minLines: 1,
              textInputAction: TextInputAction.newline,
              decoration: const InputDecoration(
                hintText: 'Ask a question about this course…',
                counterText: '',
                isDense: true,
              ),
            ),
          ),
          const SizedBox(width: 8),
          ListenableBuilder(
            listenable: _c,
            builder: (context, _) => FilledButton(
              onPressed: _c.sending ? null : () => _send(),
              child: Text(_c.sending ? 'Sending…' : 'Send'),
            ),
          ),
        ],
      ),
    );
  }
}
