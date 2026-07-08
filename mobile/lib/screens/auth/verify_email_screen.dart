import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../state/auth_controller.dart';
import '../../theme/app_theme.dart';

/// Email verification gate — mirrors the web portal requiring a verified
/// email before accessing learner content.
class VerifyEmailScreen extends StatefulWidget {
  const VerifyEmailScreen({super.key});

  @override
  State<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends State<VerifyEmailScreen> {
  bool _busy = false;

  Future<void> _refresh() async {
    setState(() => _busy = true);
    await context.read<AuthController>().refreshVerification();
    if (!mounted) return;
    setState(() => _busy = false);
    if (context.read<AuthController>().status == AuthStatus.needsVerification) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Still unverified — check your inbox.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    final email = auth.firebaseUser?.email ?? 'your email';
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.mark_email_unread_outlined,
                    size: 56, color: AppColors.teal),
                const SizedBox(height: 20),
                const Text('Verify your email',
                    style: TextStyle(
                        fontSize: 22, fontWeight: FontWeight.w700)),
                const SizedBox(height: 10),
                Text(
                  'We sent a verification link to $email. '
                  'Open it, then tap "I\'ve verified".',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.muted, height: 1.4),
                ),
                const SizedBox(height: 28),
                FilledButton(
                  onPressed: _busy ? null : _refresh,
                  child: _busy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Text("I've verified"),
                ),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: () => auth.resendVerification(),
                  child: const Text('Resend email'),
                ),
                TextButton(
                  onPressed: () => auth.signOut(),
                  child: const Text('Sign out'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
