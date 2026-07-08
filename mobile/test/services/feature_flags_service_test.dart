// FeatureFlagsService tests on fake_cloud_firestore. Mirrors the web
// getFeatureFlag contract: a missing settings/features doc, a missing key, or a
// key set to anything other than boolean-true resolves to FALSE — half-built
// features never reach learners unless explicitly enabled.

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/services/feature_flags_service.dart';

void main() {
  test('missing settings/features doc → all flags false', () async {
    final svc = FeatureFlagsService(db: FakeFirebaseFirestore());
    await svc.ensureLoaded();
    expect(svc.isLoaded, isTrue);
    expect(svc.isTutorEnhancements, isFalse);
    expect(svc.isCommunityForum, isFalse);
    expect(svc.isAnalyticsDashboard, isFalse);
    expect(svc.isMuxVideo, isFalse);
  });

  test('flags read as the booleans in the doc', () async {
    final db = FakeFirebaseFirestore();
    await db.collection('settings').doc('features').set({
      'communityForum': true,
      'tutorEnhancements': true,
      'analyticsDashboard': false,
    });
    final svc = FeatureFlagsService(db: db);
    await svc.ensureLoaded();
    expect(svc.isCommunityForum, isTrue);
    expect(svc.isTutorEnhancements, isTrue);
    expect(svc.isAnalyticsDashboard, isFalse); // present-but-false
    expect(svc.isMuxVideo, isFalse); // absent key
  });

  test('a non-boolean truthy value does NOT enable the flag', () async {
    final db = FakeFirebaseFirestore();
    await db
        .collection('settings')
        .doc('features')
        .set({'communityForum': 'true', 'tutorEnhancements': 1});
    final svc = FeatureFlagsService(db: db);
    await svc.ensureLoaded();
    expect(svc.isCommunityForum, isFalse);
    expect(svc.isTutorEnhancements, isFalse);
  });

  test('flags are false before load resolves', () {
    final svc = FeatureFlagsService(db: FakeFirebaseFirestore());
    expect(svc.isLoaded, isFalse);
    expect(svc.isCommunityForum, isFalse);
  });

  test('ensureLoaded is idempotent (shared in-flight future)', () async {
    final db = FakeFirebaseFirestore();
    await db.collection('settings').doc('features').set({'communityForum': true});
    final svc = FeatureFlagsService(db: db);
    await Future.wait([svc.ensureLoaded(), svc.ensureLoaded()]);
    await svc.ensureLoaded();
    expect(svc.isCommunityForum, isTrue);
  });
}
