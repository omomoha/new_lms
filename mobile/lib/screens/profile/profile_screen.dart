import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../models/cohort.dart';
import '../../services/firestore_service.dart';
import '../../state/auth_controller.dart';
import '../../theme/app_theme.dart';

/// Learner profile & settings — mirrors `src/app/learn/profile/page.tsx`.
/// Cards: account (email/role/joined), display name, change password, my
/// cohorts. Body-only: the bottom-nav shell owns the AppBar.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _nameController = TextEditingController();
  final _currentPwController = TextEditingController();
  final _newPwController = TextEditingController();
  final _confirmPwController = TextEditingController();

  bool _nameInitialized = false;

  bool _nameSaving = false;
  String? _nameError;
  bool _nameSaved = false;

  bool _pwSaving = false;
  String? _pwError;
  bool _pwSaved = false;

  bool _cohortsLoading = true;
  List<Cohort> _cohorts = const [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadCohorts());
  }

  Future<void> _loadCohorts() async {
    final user = context.read<AuthController>().profile;
    final ids = user?.cohortIds ?? const <String>[];
    if (ids.isEmpty) {
      if (mounted) setState(() => _cohortsLoading = false);
      return;
    }
    try {
      final cohorts = await context.read<FirestoreService>().getMemberCohorts(ids);
      if (mounted) {
        setState(() {
          _cohorts = cohorts;
          _cohortsLoading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _cohorts = const [];
          _cohortsLoading = false;
        });
      }
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _currentPwController.dispose();
    _newPwController.dispose();
    _confirmPwController.dispose();
    super.dispose();
  }

  Future<void> _saveName() async {
    setState(() {
      _nameError = null;
      _nameSaved = false;
    });
    // QA LOW-2 fix: validate 2..100 chars client-side (matches firestore.rules
    // `name.size() >= 2 && <= 100`) BEFORE attempting the write.
    final trimmed = _nameController.text.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      setState(() => _nameError = 'Name must be between 2 and 100 characters.');
      return;
    }
    setState(() => _nameSaving = true);
    final auth = context.read<AuthController>();
    final ok = await auth.updateDisplayName(trimmed);
    if (!mounted) return;
    setState(() {
      _nameSaving = false;
      if (ok) {
        _nameSaved = true;
      } else {
        _nameError = auth.error ?? 'Failed to save your name. Try again.';
      }
    });
  }

  Future<void> _changePassword() async {
    setState(() {
      _pwError = null;
      _pwSaved = false;
    });
    final current = _currentPwController.text;
    final next = _newPwController.text;
    final confirm = _confirmPwController.text;
    if (next.length < 8) {
      setState(() => _pwError = 'New password must be at least 8 characters.');
      return;
    }
    if (next != confirm) {
      setState(() => _pwError = 'New password and confirmation do not match.');
      return;
    }
    setState(() => _pwSaving = true);
    final auth = context.read<AuthController>();
    final ok = await auth.changePassword(
      currentPassword: current,
      newPassword: next,
    );
    if (!mounted) return;
    setState(() {
      _pwSaving = false;
      if (ok) {
        _pwSaved = true;
        _currentPwController.clear();
        _newPwController.clear();
        _confirmPwController.clear();
      } else {
        _pwError = auth.error ?? 'Failed to update password. Try again.';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final user = auth.profile;
    final email = user?.email ?? auth.firebaseUser?.email ?? '—';
    final role = user?.role ?? 'learner';

    // Prefill the name field once the profile resolves.
    if (!_nameInitialized && user != null) {
      _nameController.text = user.name;
      _nameInitialized = true;
    }

    final joined = user?.createdAt != null
        ? DateFormat.yMMMMd().format(user!.createdAt!)
        : null;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        _hero(),
        const SizedBox(height: 16),

        // ── Account ─────────────────────────────────────────────────────
        _sectionCard(
          title: 'Account',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _accountRow('Email', email),
              const SizedBox(height: 10),
              Row(
                children: [
                  const SizedBox(
                      width: 80,
                      child: Text('Role',
                          style: TextStyle(color: AppColors.muted, fontSize: 13))),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.mint,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      role[0].toUpperCase() + role.substring(1),
                      style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: AppColors.primary),
                    ),
                  ),
                ],
              ),
              if (joined != null) ...[
                const SizedBox(height: 10),
                _accountRow('Joined', joined),
              ],
            ],
          ),
        ),
        const SizedBox(height: 16),

        // ── Display name ────────────────────────────────────────────────
        _sectionCard(
          title: 'Display name',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(
                controller: _nameController,
                textInputAction: TextInputAction.done,
                decoration: const InputDecoration(
                  labelText: 'Name',
                  hintText: 'Your full name',
                ),
                onChanged: (_) {
                  if (_nameSaved) setState(() => _nameSaved = false);
                },
              ),
              if (_nameError != null) ...[
                const SizedBox(height: 8),
                _fieldError(_nameError!),
              ],
              const SizedBox(height: 12),
              Row(
                children: [
                  FilledButton(
                    onPressed: _nameSaving ? null : _saveName,
                    child: Text(_nameSaving ? 'Saving…' : 'Save'),
                  ),
                  const SizedBox(width: 12),
                  if (_nameSaved)
                    const Text('Saved ✓',
                        style: TextStyle(
                            color: AppColors.teal,
                            fontWeight: FontWeight.w600)),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // ── Change password ─────────────────────────────────────────────
        _sectionCard(
          title: 'Change password',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(
                controller: _currentPwController,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Current password',
                  hintText: '••••••••',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _newPwController,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'New password',
                  hintText: 'At least 8 characters',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _confirmPwController,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: 'Confirm new password',
                  hintText: 'Repeat new password',
                ),
              ),
              if (_pwError != null) ...[
                const SizedBox(height: 8),
                _fieldError(_pwError!),
              ],
              const SizedBox(height: 12),
              Row(
                children: [
                  FilledButton(
                    onPressed: _pwSaving ? null : _changePassword,
                    child: Text(_pwSaving ? 'Updating…' : 'Update password'),
                  ),
                  const SizedBox(width: 12),
                  if (_pwSaved)
                    const Text('Password updated ✓',
                        style: TextStyle(
                            color: AppColors.teal,
                            fontWeight: FontWeight.w600)),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // ── My cohorts ──────────────────────────────────────────────────
        _sectionCard(
          title: 'My cohorts',
          child: _cohortsLoading
              ? const Text('Loading cohorts…',
                  style: TextStyle(color: AppColors.muted, fontSize: 13))
              : _cohorts.isEmpty
                  ? const Text(
                      'You are not in any cohorts yet — your admin will assign you to one.',
                      style: TextStyle(color: AppColors.muted, fontSize: 13))
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: _cohorts
                          .map((c) => Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: Row(
                                  children: [
                                    Transform.rotate(
                                      angle: 0.785398,
                                      child: Container(
                                        width: 8,
                                        height: 8,
                                        color: AppColors.accent,
                                      ),
                                    ),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      child: Text(
                                          c.name.isNotEmpty ? c.name : c.id,
                                          style: const TextStyle(
                                              color: AppColors.ink)),
                                    ),
                                  ],
                                ),
                              ))
                          .toList(),
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

  Widget _hero() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.primary,
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('MY LEARNING · PROFILE',
              style: TextStyle(
                  color: AppColors.accent,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1)),
          SizedBox(height: 6),
          Text('Your profile',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 24,
                  fontWeight: FontWeight.w700)),
          SizedBox(height: 4),
          Text('Manage your account details and password',
              style: TextStyle(color: AppColors.mist, fontSize: 13)),
        ],
      ),
    );
  }

  Widget _sectionCard({required String title, required Widget child}) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title,
                style: const TextStyle(
                    fontWeight: FontWeight.w700, color: AppColors.ink)),
            const SizedBox(height: 14),
            child,
          ],
        ),
      ),
    );
  }

  Widget _accountRow(String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
            width: 80,
            child: Text(label,
                style: const TextStyle(color: AppColors.muted, fontSize: 13))),
        Expanded(
          child: Text(value,
              style: const TextStyle(color: AppColors.ink, fontSize: 13)),
        ),
      ],
    );
  }

  Widget _fieldError(String message) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF2F2),
        border: Border.all(color: const Color(0xFFFECACA)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(message,
          style: const TextStyle(fontSize: 13, color: Color(0xFFB91C1C))),
    );
  }
}
