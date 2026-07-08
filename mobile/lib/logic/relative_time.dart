import 'package:intl/intl.dart';

/// Relative-time formatting, ported from the web thresholds
/// (`relativeTime.ts` / DiscussionPanel.formatRelativeTime):
///   null           → "just now"
///   < 60s          → "just now"
///   < 60m          → "Nm ago"
///   < 24h          → "Nh ago"
///   < 7d           → "Nd ago"
///   otherwise      → locale date (via intl).
String formatRelativeTime(int? millis, {int? nowMillis}) {
  if (millis == null) return 'just now';
  final now = nowMillis ?? DateTime.now().millisecondsSinceEpoch;
  final diff = now - millis;
  if (diff < 60000) return 'just now';
  final minutes = diff ~/ 60000;
  if (minutes < 60) return '${minutes}m ago';
  final hours = minutes ~/ 60;
  if (hours < 24) return '${hours}h ago';
  final days = hours ~/ 24;
  if (days < 7) return '${days}d ago';
  return DateFormat.yMd().format(DateTime.fromMillisecondsSinceEpoch(millis));
}
