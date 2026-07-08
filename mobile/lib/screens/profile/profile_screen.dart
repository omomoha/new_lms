import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../state/auth_controller.dart';
import '../../theme/app_theme.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final user = auth.profile;
    final email = user?.email ?? auth.firebaseUser?.email ?? '';
    final name = user?.name ?? '';
    final initials = name.isNotEmpty
        ? name.trim().split(' ').map((w) => w[0]).take(2).join().toUpperCase()
        : '?';

    // Body-only: the bottom-nav shell owns the AppBar. Full profile forms
    // (name/password/cohorts) arrive in Phase 5.
    return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const SizedBox(height: 8),
          Center(
            child: CircleAvatar(
              radius: 44,
              backgroundColor: AppColors.mint,
              child: Text(
                initials,
                style: const TextStyle(
                    fontSize: 30,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primary),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Center(
            child: Text(name,
                style: const TextStyle(
                    fontSize: 20, fontWeight: FontWeight.w700)),
          ),
          Center(
            child: Text(email,
                style: const TextStyle(color: AppColors.muted)),
          ),
          const SizedBox(height: 24),
          Card(
            child: Column(
              children: [
                _row('Role', user?.role ?? '—'),
                const Divider(height: 1),
                _row('Status', user?.status ?? '—'),
                const Divider(height: 1),
                _row('Cohorts',
                    (user?.cohortIds.isEmpty ?? true) ? 'None' : user!.cohortIds.join(', ')),
              ],
            ),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: () => auth.signOut(),
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.red.shade700,
              minimumSize: const Size.fromHeight(52),
            ),
            icon: const Icon(Icons.logout),
            label: const Text('Sign out'),
          ),
        ],
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AppColors.muted)),
          Flexible(
            child: Text(value,
                textAlign: TextAlign.right,
                style: const TextStyle(fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}
