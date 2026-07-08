import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/app_notification.dart';
import '../services/firestore_service.dart';
import '../theme/app_theme.dart';

/// Header bell with an unread badge and a notifications panel (a modal bottom
/// sheet on mobile). Subscribes to the learner's `notifications` docs with a
/// single equality filter and NO orderBy (no composite index); sorting
/// (createdAt desc) and the latest-20 cap happen client-side. Marking read
/// writes ONLY the readAt field (the only field firestore.rules allows).
///
/// Mirrors `src/components/notifications/NotificationsBell.tsx`.
class NotificationsBell extends StatefulWidget {
  const NotificationsBell({super.key, required this.uid});

  final String uid;

  @override
  State<NotificationsBell> createState() => _NotificationsBellState();
}

class _NotificationsBellState extends State<NotificationsBell> {
  StreamSubscription<List<AppNotification>>? _sub;
  List<AppNotification> _items = const [];

  @override
  void initState() {
    super.initState();
    _subscribe();
  }

  @override
  void didUpdateWidget(covariant NotificationsBell oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.uid != widget.uid) {
      _sub?.cancel();
      _subscribe();
    }
  }

  void _subscribe() {
    final fs = context.read<FirestoreService>();
    _sub = fs.notificationsStream(widget.uid).listen(
      (list) {
        // Newest first (client-side); pending serverTimestamps (null) float top.
        // Pending serverTimestamps (null createdAt) float to the top, matching
        // the web's Number.MAX_SAFE_INTEGER fallback.
        const maxSafe = 9007199254740991;
        final sorted = list.toList()
          ..sort((a, b) {
            final am = a.createdAt?.millisecondsSinceEpoch ?? maxSafe;
            final bm = b.createdAt?.millisecondsSinceEpoch ?? maxSafe;
            return bm.compareTo(am);
          });
        if (mounted) {
          setState(() => _items = sorted.take(20).toList());
        }
      },
      onError: (e) => debugPrint('NotificationsBell: snapshot failed: $e'),
    );
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  List<AppNotification> get _unread =>
      _items.where((n) => !n.isRead).toList();

  Future<void> _markRead(String id) async {
    try {
      await context.read<FirestoreService>().markNotificationRead(id);
    } catch (e) {
      debugPrint('NotificationsBell: mark read failed: $e');
    }
  }

  Future<void> _markAllRead() async {
    final ids = _unread.map((n) => n.id).toList();
    if (ids.isEmpty) return;
    try {
      await context.read<FirestoreService>().markNotificationsRead(ids);
    } catch (e) {
      debugPrint('NotificationsBell: mark all read failed: $e');
    }
  }

  void _openLink(BuildContext sheetContext, AppNotification n) {
    Navigator.of(sheetContext).pop();
    final link = n.link.trim();
    if (link.isEmpty) return;
    if (link.startsWith('/')) {
      // In-app route (go_router).
      context.push(link);
    } else {
      final uri = Uri.tryParse(link);
      if (uri != null) {
        launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    }
  }

  void _openPanel() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) {
        // StatefulBuilder so "Mark all read" reflects instantly; the underlying
        // list still updates live via the parent stream when reopened.
        return _NotificationsPanel(
          items: _items,
          onMarkAll: _markAllRead,
          onTapItem: (n) {
            if (!n.isRead) _markRead(n.id);
            _openLink(sheetContext, n);
          },
          onMarkReadNoLink: (n) {
            if (!n.isRead) _markRead(n.id);
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final unreadCount = _unread.length;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        IconButton(
          tooltip: 'Notifications',
          icon: const Icon(Icons.notifications_none),
          onPressed: _openPanel,
        ),
        if (unreadCount > 0)
          Positioned(
            right: 6,
            top: 6,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
              decoration: const BoxDecoration(
                color: AppColors.accent,
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: Text(
                unreadCount > 9 ? '9+' : '$unreadCount',
                style: const TextStyle(
                    color: AppColors.primary,
                    fontSize: 10,
                    fontWeight: FontWeight.w800),
              ),
            ),
          ),
      ],
    );
  }
}

/// Relative-time helper mirroring the web: "just now", "5m ago", "2h ago", …
String _timeAgo(DateTime? ts) {
  if (ts == null) return 'just now';
  final seconds =
      ((DateTime.now().millisecondsSinceEpoch - ts.millisecondsSinceEpoch) /
              1000)
          .floor();
  if (seconds < 60) return 'just now';
  final minutes = seconds ~/ 60;
  if (minutes < 60) return '${minutes}m ago';
  final hours = minutes ~/ 60;
  if (hours < 24) return '${hours}h ago';
  final days = hours ~/ 24;
  if (days < 7) return '${days}d ago';
  final weeks = days ~/ 7;
  return '${weeks}w ago';
}

class _NotificationsPanel extends StatelessWidget {
  const _NotificationsPanel({
    required this.items,
    required this.onMarkAll,
    required this.onTapItem,
    required this.onMarkReadNoLink,
  });

  final List<AppNotification> items;
  final Future<void> Function() onMarkAll;
  final void Function(AppNotification) onTapItem;
  final void Function(AppNotification) onMarkReadNoLink;

  @override
  Widget build(BuildContext context) {
    final unreadCount = items.where((n) => !n.isRead).length;
    return StatefulBuilder(
      builder: (context, setSheetState) {
        return SafeArea(
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.of(context).size.height * 0.7,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 8, 8),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Notifications',
                          style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                              color: AppColors.ink)),
                      if (unreadCount > 0)
                        TextButton(
                          onPressed: () async {
                            await onMarkAll();
                            setSheetState(() {});
                          },
                          child: const Text('Mark all read',
                              style: TextStyle(color: AppColors.teal)),
                        ),
                    ],
                  ),
                ),
                const Divider(height: 1),
                if (items.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 40, horizontal: 16),
                    child: Text("You're all caught up",
                        style: TextStyle(color: AppColors.muted)),
                  )
                else
                  Flexible(
                    child: ListView.separated(
                      shrinkWrap: true,
                      itemCount: items.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, i) {
                        final n = items[i];
                        return InkWell(
                          onTap: () {
                            if (n.link.trim().isNotEmpty) {
                              onTapItem(n);
                            } else {
                              onMarkReadNoLink(n);
                              setSheetState(() {});
                            }
                          },
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 12),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Container(
                                  margin: const EdgeInsets.only(top: 5),
                                  width: 8,
                                  height: 8,
                                  decoration: BoxDecoration(
                                    color: n.isRead
                                        ? Colors.transparent
                                        : AppColors.accent,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(n.title,
                                          style: const TextStyle(
                                              fontWeight: FontWeight.w600,
                                              color: AppColors.ink)),
                                      if (n.body.isNotEmpty) ...[
                                        const SizedBox(height: 2),
                                        Text(n.body,
                                            style: const TextStyle(
                                                fontSize: 13,
                                                color: AppColors.muted)),
                                      ],
                                      const SizedBox(height: 2),
                                      Text(_timeAgo(n.createdAt),
                                          style: const TextStyle(
                                              fontSize: 11,
                                              color: AppColors.muted)),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}
