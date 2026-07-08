import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../models/course.dart';
import '../../services/firestore_service.dart';
import '../../state/auth_controller.dart';
import '../../theme/app_theme.dart';
import '../../widgets/course_card.dart';
import '../../widgets/loading.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  late Future<List<CourseWithProgress>> _future;
  final Map<String, String?> _thumbCache = {};
  String _query = '';

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<CourseWithProgress>> _load() async {
    final auth = context.read<AuthController>();
    final fs = context.read<FirestoreService>();
    final user = auth.profile;
    if (user == null) return [];
    final items = await fs.loadDashboard(user);

    // Resolve thumbnails (best-effort, cached).
    for (final it in items) {
      final path = it.course.thumbPath;
      if (path != null && !_thumbCache.containsKey(it.course.id)) {
        _thumbCache[it.course.id] = await fs.resolveStorageUrl(path);
      }
    }
    return items;
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    final name = context.watch<AuthController>().profile?.name ?? '';
    return Scaffold(
      appBar: AppBar(
        title: const Text.rich(
          TextSpan(children: [
            TextSpan(
                text: 'Andela ',
                style: TextStyle(
                    color: AppColors.accent, fontWeight: FontWeight.w800)),
            TextSpan(
                text: 'LMS',
                style: TextStyle(
                    color: Colors.white, fontWeight: FontWeight.w300)),
          ]),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<CourseWithProgress>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Loading();
            }
            if (snap.hasError) {
              return ErrorRetry(
                message: 'Could not load your courses.\n${snap.error}',
                onRetry: _refresh,
              );
            }
            final all = snap.data ?? [];
            final filtered = _query.isEmpty
                ? all
                : all
                    .where((c) => c.course.title
                        .toLowerCase()
                        .contains(_query.toLowerCase()))
                    .toList();

            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              children: [
                if (name.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      'Welcome back, ${name.split(' ').first}',
                      style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink),
                    ),
                  ),
                TextField(
                  decoration: const InputDecoration(
                    hintText: 'Search courses',
                    prefixIcon: Icon(Icons.search),
                  ),
                  onChanged: (v) => setState(() => _query = v),
                ),
                const SizedBox(height: 16),
                if (filtered.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 64),
                    child: Center(
                      child: Text('No courses yet.',
                          style: TextStyle(color: AppColors.muted)),
                    ),
                  )
                else
                  ...filtered.map((item) => Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: CourseCard(
                          item: item,
                          thumbUrl: _thumbCache[item.course.id],
                          onTap: () =>
                              context.push('/course/${item.course.id}'),
                        ),
                      )),
              ],
            );
          },
        ),
      ),
    );
  }
}
