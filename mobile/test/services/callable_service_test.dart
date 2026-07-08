// Pure coverage of the callable_service value objects (no Firebase init).
// The private FirebaseFunctionsException -> friendly-message mapping is verified
// by static review; the score-percentage math and typed results are asserted
// here.
import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/services/callable_service.dart';

void main() {
  group('GradeAttemptResult.scorePct', () {
    test('rounds to nearest integer percent', () {
      expect(
        const GradeAttemptResult(
                score: 3, total: 4, passed: true, perQuestion: {})
            .scorePct,
        75,
      );
      expect(
        const GradeAttemptResult(
                score: 5, total: 6, passed: true, perQuestion: {})
            .scorePct,
        83, // 83.33 -> 83
      );
    });

    test('guards divide-by-zero (total 0 -> 0)', () {
      expect(
        const GradeAttemptResult(
                score: 0, total: 0, passed: false, perQuestion: {})
            .scorePct,
        0,
      );
    });
  });

  group('CallableException', () {
    test('carries a code and toString() surfaces the message', () {
      const e = CallableException('resource-exhausted', 'Slow down.');
      expect(e.code, 'resource-exhausted');
      expect(e.toString(), 'Slow down.');
    });
  });

  group('typed result objects', () {
    test('SignedVideoUrl / IssueCertificate / Leaderboard hold their fields',
        () {
      const v = SignedVideoUrl(url: 'https://x/y', expiresAt: 123);
      expect(v.url, 'https://x/y');
      expect(v.expiresAt, 123);

      const c = IssueCertificateResult(certId: 'ABC', downloadUrl: 'u');
      expect(c.certId, 'ABC');

      const row = LeaderboardRow(
          name: 'Ada',
          xp: 200,
          lessonsCompleted: 5,
          certificates: 1,
          isYou: true);
      const lb =
          LeaderboardResult(cohortName: 'Q1', rows: [row], truncated: false);
      expect(lb.rows.single.isYou, isTrue);
      expect(lb.cohortName, 'Q1');
    });
  });
}
