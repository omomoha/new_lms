// util/offline.dart — the offline-aware write outcome mapping used by every
// learner write path (mark-complete, video progress, feedback, flashcards).
//   synced         → the write reached the backend
//   queuedOffline  → timeout OR a network/unavailable error (SDK queued it)
//   failed         → a genuine, non-network error (e.g. permission-denied)
import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:andela_lms_mobile/util/offline.dart';

void main() {
  group('runOfflineAwareWrite', () {
    test('returns synced when the write completes', () async {
      final outcome = await runOfflineAwareWrite(() async {});
      expect(outcome, WriteOutcome.synced);
    });

    test('returns queuedOffline when the write times out', () async {
      // A write whose Future never resolves within the race window = offline.
      final outcome = await runOfflineAwareWrite(
        () => Completer<void>().future, // never completes
        timeout: const Duration(milliseconds: 20),
      );
      expect(outcome, WriteOutcome.queuedOffline);
    });

    test('returns queuedOffline on an `unavailable` Firestore error', () async {
      final outcome = await runOfflineAwareWrite(
        () async => throw FirebaseException(
            plugin: 'cloud_firestore', code: 'unavailable'),
      );
      expect(outcome, WriteOutcome.queuedOffline);
    });

    test('returns queuedOffline on a TimeoutException from the write', () async {
      final outcome = await runOfflineAwareWrite(
        () async => throw TimeoutException('slow'),
      );
      expect(outcome, WriteOutcome.queuedOffline);
    });

    test('returns failed on a genuine permission-denied error', () async {
      final outcome = await runOfflineAwareWrite(
        () async => throw FirebaseException(
            plugin: 'cloud_firestore', code: 'permission-denied'),
      );
      expect(outcome, WriteOutcome.failed);
    });
  });

  group('isOfflineError', () {
    test('true for network/unavailable codes and TimeoutException', () {
      expect(isOfflineError(TimeoutException('x')), isTrue);
      expect(
          isOfflineError(FirebaseException(
              plugin: 'cloud_firestore', code: 'unavailable')),
          isTrue);
      expect(
          isOfflineError(FirebaseException(
              plugin: 'cloud_firestore', code: 'deadline-exceeded')),
          isTrue);
      expect(
          isOfflineError(FirebaseException(
              plugin: 'cloud_firestore', code: 'network-request-failed')),
          isTrue);
    });

    test('false for a genuine permission-denied error', () {
      expect(
          isOfflineError(FirebaseException(
              plugin: 'cloud_firestore', code: 'permission-denied')),
          isFalse);
    });
  });
}
