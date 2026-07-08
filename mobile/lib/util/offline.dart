import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Cross-cutting offline-write helpers (Phase 6).
///
/// Firestore has local persistence enabled (see main.dart), so a write issued
/// while offline is applied to the local cache and QUEUED for sync — it is not
/// lost. The Future returned by `set`/`update` only completes once the write
/// reaches the backend, which means awaiting it while offline would block the
/// UI indefinitely. These helpers let callers apply an optimistic UI update,
/// treat "offline / queued" as success (not an error), and never block the UI.

/// Firestore/network error codes that mean "you're offline, the write is
/// queued" rather than a genuine failure.
const Set<String> _offlineCodes = {
  'unavailable',
  'deadline-exceeded',
  'network-request-failed',
};

/// True when [error] indicates the device is offline (so a Firestore write is
/// safely queued and will sync later) rather than a real, permanent failure.
bool isOfflineError(Object error) {
  if (error is TimeoutException) return true;
  if (error is FirebaseException) {
    if (_offlineCodes.contains(error.code)) return true;
    final msg = (error.message ?? '').toLowerCase();
    return msg.contains('offline') ||
        msg.contains('network') ||
        msg.contains('unavailable');
  }
  final s = error.toString().toLowerCase();
  return s.contains('unavailable') ||
      s.contains('network') ||
      s.contains('offline');
}

/// The outcome of an offline-aware write.
enum WriteOutcome {
  /// Committed to the backend.
  synced,

  /// Applied locally and queued — the device is offline and it will sync later.
  queuedOffline,

  /// A genuine, non-network failure (e.g. permission-denied).
  failed,
}

/// Runs a Firestore [write] without blocking the UI when offline.
///
/// Because an offline write's Future does not complete until reconnection, the
/// call is raced against a short [timeout]; a timeout is treated as
/// [WriteOutcome.queuedOffline] (the write is already in the local cache). An
/// `unavailable`/network error is likewise treated as queued; anything else is
/// [WriteOutcome.failed].
Future<WriteOutcome> runOfflineAwareWrite(
  Future<void> Function() write, {
  Duration timeout = const Duration(seconds: 4),
}) async {
  try {
    await write().timeout(timeout);
    return WriteOutcome.synced;
  } on TimeoutException {
    // Applied to the local cache and queued; will sync when back online.
    return WriteOutcome.queuedOffline;
  } catch (e) {
    return isOfflineError(e) ? WriteOutcome.queuedOffline : WriteOutcome.failed;
  }
}

/// Non-blocking "saved offline" affordance shown when a write is queued while
/// the device is offline. Reused by every learner write path (mark-complete,
/// video progress, lesson feedback, flashcard grading).
void showSavedOfflineSnackBar(BuildContext context, {String? message}) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  if (messenger == null) return;
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.primary,
        content: Row(
          children: [
            const Icon(Icons.cloud_off, color: Colors.white, size: 18),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                message ?? "Saved offline — will sync when you're back online",
                style: const TextStyle(color: Colors.white),
              ),
            ),
          ],
        ),
      ),
    );
}
