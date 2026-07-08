import 'package:flutter/foundation.dart';

import '../models/tutor.dart';
import '../services/callable_service.dart';
import '../services/firestore_service.dart';

/// Holds the tutor chat state for one lesson/course context and drives the
/// `askTutor` callable. Mirrors the web `TutorPanel` behaviour:
///  - chat is stateless per session (fresh on open); the last ≤8 turns are sent
///    as history before each new question;
///  - persistence + thumbs are gated behind [enhanced] (tutorEnhancements). With
///    the flag OFF: no `conversationId` is sent/kept and no feedback is offered;
///  - a persistence failure server-side does NOT fail the call — the answer
///    still returns, so a `conversationId` never implies a durable doc.
class TutorController extends ChangeNotifier {
  TutorController({
    required CallableService callable,
    required FirestoreService firestore,
    required this.courseId,
    required this.uid,
    this.moduleId,
    this.lessonId,
    this.enhanced = false,
  })  : _callable = callable,
        _fs = firestore;

  final CallableService _callable;
  final FirestoreService _fs;

  final String courseId;
  final String uid;
  final String? moduleId;
  final String? lessonId;

  /// tutorEnhancements: gates conversationId persistence + thumbs feedback.
  bool enhanced;

  static const int _maxHistoryTurns = 8;

  final List<TutorTurn> _messages = [];
  bool _sending = false;
  String? _error;
  String? _conversationId;
  bool _disposed = false;

  /// messages-index → submitted rating ("up"/"down"), to reflect the choice.
  final Map<int, String> _feedback = {};

  // getters -------------------------------------------------------------------
  List<TutorTurn> get messages => List.unmodifiable(_messages);
  bool get sending => _sending;
  String? get error => _error;
  String? get conversationId => _conversationId;
  Map<int, String> get feedback => Map.unmodifiable(_feedback);

  /// Feedback controls are only offered with the flag ON and a conversation id.
  bool get canRate => enhanced && uid.isNotEmpty && _conversationId != null;

  /// Update the flag once it resolves (used by the panel after the flag loads).
  void setEnhanced(bool value) {
    if (enhanced == value) return;
    enhanced = value;
    _safeNotify();
  }

  Future<void> send(String raw) async {
    final question = raw.trim();
    if (question.isEmpty || _sending) return;

    _error = null;
    // History as it stood BEFORE this question, trimmed to the last 8 turns.
    final history = _messages.length > _maxHistoryTurns
        ? _messages.sublist(_messages.length - _maxHistoryTurns)
        : List<TutorTurn>.from(_messages);

    _messages.add(TutorTurn(role: 'user', content: question));
    _sending = true;
    _safeNotify();

    try {
      final res = await _callable.askTutor(
        courseId: courseId,
        moduleId: moduleId,
        lessonId: lessonId,
        question: question,
        history: history,
        // Only append to an existing conversation when the flag is ON.
        conversationId:
            enhanced && _conversationId != null ? _conversationId : null,
      );
      _messages.add(TutorTurn(role: 'assistant', content: res.answer));
      if (enhanced && res.conversationId.isNotEmpty) {
        _conversationId = res.conversationId;
      }
    } on CallableException catch (e) {
      _error = e.message;
    } catch (_) {
      _error = 'The tutor is unavailable right now. Please try again.';
    } finally {
      _sending = false;
      _safeNotify();
    }
  }

  /// Thumbs up/down for the assistant answer at [turnIndex] (its index in
  /// [messages]). No-op unless enhancements are on and a conversation exists.
  /// Optimistic; reverted on failure so the learner can retry.
  Future<void> rate(int turnIndex, String rating) async {
    if (!canRate) return;
    final convId = _conversationId!;
    _feedback[turnIndex] = rating;
    _safeNotify();
    try {
      await _fs.submitTutorFeedback(
        uid: uid,
        conversationId: convId,
        turnIndex: turnIndex,
        courseId: courseId,
        rating: rating,
      );
    } catch (_) {
      _feedback.remove(turnIndex);
      _safeNotify();
    }
  }

  void _safeNotify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
