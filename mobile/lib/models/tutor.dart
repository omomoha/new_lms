import 'package:cloud_firestore/cloud_firestore.dart';

/// One turn in a tutor conversation. `role` is "user" | "assistant" (matches
/// the web `TutorTurn`). `at` is an optional epoch-millis stamp stored on the
/// persisted turns (server-written); it is not required for chat rendering.
class TutorTurn {
  final String role; // "user" | "assistant"
  final String content;
  final int? at;

  const TutorTurn({required this.role, required this.content, this.at});

  bool get isUser => role == 'user';
  bool get isAssistant => role == 'assistant';

  /// The `{role, content}` shape sent to `askTutor` as prior history. Server
  /// treats history as untrusted and re-fences it; the client only needs to
  /// trim to the last 8 turns and send this minimal shape.
  Map<String, dynamic> toHistoryMap() => {'role': role, 'content': content};
}

/// Coerce a stored `turns` array into strict [TutorTurn]s (mirror web
/// `normalizeTurns`): only "user"/"assistant" roles with string content.
List<TutorTurn> _normalizeTurns(Object? raw) {
  if (raw is! List) return const [];
  final out = <TutorTurn>[];
  for (final item in raw) {
    if (item is! Map) continue;
    final role = item['role'];
    final content = item['content'];
    if ((role == 'user' || role == 'assistant') && content is String) {
      final at = item['at'];
      out.add(TutorTurn(
        role: role as String,
        content: content,
        at: at is num ? at.toInt() : null,
      ));
    }
  }
  return out;
}

/// Read model for `users/{uid}/tutorConversations/{id}` (written server-side by
/// the askTutor callable; the client only ever reads it). Only needed for the
/// optional enhanced history list.
class TutorConversation {
  final String id;
  final String? title;
  final String? courseId;
  final List<TutorTurn> turns;
  final int? updatedAtMillis;

  const TutorConversation({
    required this.id,
    this.title,
    this.courseId,
    this.turns = const [],
    this.updatedAtMillis,
  });

  factory TutorConversation.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    final updated = data['updatedAt'];
    return TutorConversation(
      id: doc.id,
      title: data['title'] is String ? data['title'] as String : null,
      courseId: data['courseId'] is String ? data['courseId'] as String : null,
      turns: _normalizeTurns(data['turns']),
      updatedAtMillis: updated is Timestamp ? updated.millisecondsSinceEpoch : null,
    );
  }
}

/// Result of an `askTutor` callable: the Markdown answer plus the conversation
/// id it was saved under (new when omitted, reused when supplied).
class AskTutorResult {
  final String answer;
  final String conversationId;

  const AskTutorResult({required this.answer, required this.conversationId});
}
