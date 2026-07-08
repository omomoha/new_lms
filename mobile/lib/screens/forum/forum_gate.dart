import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../logic/forum_rules.dart' show maxNameLength;
import '../../services/feature_flags_service.dart';
import '../../theme/app_theme.dart';
import '../../widgets/loading.dart';

/// Wraps a forum screen's body behind the `communityForum` feature flag. Reads
/// the shared (cache-once) FeatureFlagsService: while loading shows a spinner,
/// when OFF shows the web's "not available yet" message, when ON shows [child].
/// Matches the web gating (each forum page checks the flag).
class ForumGate extends StatelessWidget {
  const ForumGate({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final flags = context.read<FeatureFlagsService>();
    return FutureBuilder<void>(
      future: flags.ensureLoaded(),
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Loading();
        }
        if (!flags.isCommunityForum) {
          return const Center(
            child: Padding(
              padding: EdgeInsets.all(32),
              child: Text(
                "The community forum isn't available yet. Check back soon.",
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.muted),
              ),
            ),
          );
        }
        return child;
      },
    );
  }
}

/// Resolve a <=100 char display name from a profile's name/email (mirrors the
/// web `displayName` memo: name || email local-part || "Member").
String resolveForumName(String? name, String? email) {
  final n = (name ?? '').trim();
  final prefix = (email ?? '').split('@').first;
  final resolved = n.isNotEmpty ? n : (prefix.isNotEmpty ? prefix : 'Member');
  return resolved.length > maxNameLength
      ? resolved.substring(0, maxNameLength)
      : resolved;
}
