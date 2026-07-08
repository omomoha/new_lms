// Ported 1:1 from web tests/dueDates.test.ts.
// JS months are 0-indexed (June == 5); Dart uses 1-indexed (June == 6).
import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/logic/due_dates.dart';

const int dayMs = 24 * 60 * 60 * 1000;

class _Ts implements DueTimestampLike {
  final int _m;
  const _Ts(this._m);
  @override
  int toMillis() => _m;
}

// Fixed "now": Wednesday 10 June 2026, 12:00 local time.
final int nowMs = DateTime(2026, 6, 10, 12, 0, 0).millisecondsSinceEpoch;

int on(int day, [int hour = 12, int minute = 0]) =>
    DateTime(2026, 6, day, hour, minute, 0).millisecondsSinceEpoch;

void main() {
  group('resolveDueDate', () {
    test('returns null when no cohorts are given', () {
      expect(resolveDueDate('c1', const []), isNull);
    });

    test('returns null when no cohort sets a due date for the course', () {
      final cohorts = [
        const DueDateCohort(),
        const DueDateCohort(courseDueDates: {}),
        DueDateCohort(courseDueDates: {'other': _Ts(on(20))}),
      ];
      expect(resolveDueDate('c1', cohorts), isNull);
    });

    test('returns the due date when exactly one cohort sets it', () {
      final cohorts = [
        DueDateCohort(courseDueDates: {'c1': _Ts(on(15))}),
        const DueDateCohort(),
      ];
      expect(resolveDueDate('c1', cohorts), on(15));
    });

    test('picks the EARLIEST due date across multiple cohorts', () {
      final cohorts = [
        DueDateCohort(courseDueDates: {'c1': _Ts(on(20))}),
        DueDateCohort(courseDueDates: {'c1': _Ts(on(12))}),
        DueDateCohort(courseDueDates: {'c1': _Ts(on(25))}),
      ];
      expect(resolveDueDate('c1', cohorts), on(12));
    });

    test("resolves per course — other courses' dates don't interfere", () {
      final cohorts = [
        DueDateCohort(courseDueDates: {'c1': _Ts(on(20)), 'c2': _Ts(on(11))}),
      ];
      expect(resolveDueDate('c1', cohorts), on(20));
      expect(resolveDueDate('c2', cohorts), on(11));
    });
  });

  group('dueBadge', () {
    test('returns null when there is no due date', () {
      expect(dueBadge(null, nowMs, 0), isNull);
    });

    test('returns null for a completed course even when overdue', () {
      expect(dueBadge(on(1), nowMs, 100), isNull);
      expect(dueBadge(on(1), nowMs, 120), isNull);
    });

    test('flags overdue when now is strictly past the due date', () {
      final badge = dueBadge(on(9, 23, 59), nowMs, 40);
      expect(badge?.label, 'Overdue — was due 9 Jun 2026');
      expect(badge?.tone, DueTone.overdue);
    });

    test('is NOT overdue at the exact due instant — shows Due today', () {
      final badge = dueBadge(nowMs, nowMs, 40);
      expect(badge?.label, 'Due today');
      expect(badge?.tone, DueTone.warn);
    });

    test('shows Due today when less than a full day remains', () {
      final badge = dueBadge(nowMs + dayMs - 1, nowMs, 0);
      expect(badge?.label, 'Due today');
      expect(badge?.tone, DueTone.warn);
    });

    test('shows Due in 1d at exactly one day out', () {
      final badge = dueBadge(nowMs + dayMs, nowMs, 0);
      expect(badge?.label, 'Due in 1d');
      expect(badge?.tone, DueTone.warn);
    });

    test('warns up to and including 7 days out', () {
      final badge = dueBadge(nowMs + 7 * dayMs, nowMs, 0);
      expect(badge?.label, 'Due in 7d');
      expect(badge?.tone, DueTone.warn);
    });

    test('goes muted past the 7-day window', () {
      final badge = dueBadge(nowMs + 8 * dayMs, nowMs, 0);
      expect(badge?.label, 'Due 18 Jun 2026');
      expect(badge?.tone, DueTone.muted);
    });

    test('muted label uses the deterministic short date', () {
      final badge = dueBadge(on(30), nowMs, 50);
      expect(badge?.label, 'Due 30 Jun 2026');
      expect(badge?.tone, DueTone.muted);
    });

    test('accepts an injected formatter (muted)', () {
      final badge = dueBadge(on(30), nowMs, 0, format: (m) => '@$m');
      expect(badge?.label, 'Due @${on(30)}');
      expect(badge?.tone, DueTone.muted);
    });

    test('accepts an injected formatter (overdue)', () {
      final badge = dueBadge(on(1), nowMs, 0, format: (_) => 'FIXED');
      expect(badge?.label, 'Overdue — was due FIXED');
      expect(badge?.tone, DueTone.overdue);
    });

    test('still badges at 99% progress, drops at 100%', () {
      expect(dueBadge(on(30), nowMs, 99), isNotNull);
      expect(dueBadge(on(30), nowMs, 100), isNull);
    });
  });
}
