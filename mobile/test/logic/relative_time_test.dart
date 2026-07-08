// Pure-unit tests for logic/relative_time.dart. Ports the web thresholds
// (relativeTime.ts): null/<60s → "just now", <60m → "Nm ago", <24h → "Nh ago",
// <7d → "Nd ago", otherwise a locale date.

import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/logic/relative_time.dart';

void main() {
  const now = 10000000000; // fixed reference epoch-millis

  test('null → "just now"', () {
    expect(formatRelativeTime(null, nowMillis: now), 'just now');
  });

  test('under 60s → "just now"', () {
    expect(formatRelativeTime(now - 59000, nowMillis: now), 'just now');
    expect(formatRelativeTime(now, nowMillis: now), 'just now');
  });

  test('minutes bucket', () {
    expect(formatRelativeTime(now - 60000, nowMillis: now), '1m ago');
    expect(formatRelativeTime(now - 59 * 60000, nowMillis: now), '59m ago');
  });

  test('hours bucket', () {
    expect(formatRelativeTime(now - 60 * 60000, nowMillis: now), '1h ago');
    expect(formatRelativeTime(now - 23 * 3600000, nowMillis: now), '23h ago');
  });

  test('days bucket', () {
    expect(formatRelativeTime(now - 24 * 3600000, nowMillis: now), '1d ago');
    expect(formatRelativeTime(now - 6 * 86400000, nowMillis: now), '6d ago');
  });

  test('7 days or more → a locale date (not an "ago" string)', () {
    final out = formatRelativeTime(now - 7 * 86400000, nowMillis: now);
    expect(out.endsWith('ago'), isFalse);
    expect(out, isNot('just now'));
  });
}
