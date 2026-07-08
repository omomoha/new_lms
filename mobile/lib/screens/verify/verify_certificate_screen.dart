import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../models/certificate.dart';
import '../../services/firestore_service.dart';
import '../../theme/app_theme.dart';
import '../../widgets/loading.dart';

/// Public certificate verification page (`/verify/:certId`). Reachable without
/// auth. Reads certificates/{certId.toUpperCase()} via a public single `get`
/// (never a list). Mirrors `src/app/verify/[certId]/page.tsx`.
///
/// This is a functional stub for Phases 2-3; Phase 5 may enrich the layout.
class VerifyCertificateScreen extends StatefulWidget {
  const VerifyCertificateScreen({super.key, required this.certId});
  final String certId;

  @override
  State<VerifyCertificateScreen> createState() =>
      _VerifyCertificateScreenState();
}

class _VerifyCertificateScreenState extends State<VerifyCertificateScreen> {
  late Future<Certificate?> _future;

  @override
  void initState() {
    super.initState();
    _future = context.read<FirestoreService>().getCertificate(widget.certId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Certificate verification')),
      body: FutureBuilder<Certificate?>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Loading();
          }
          if (snap.hasError) {
            return const _Status(
              icon: Icons.error_outline,
              color: AppColors.muted,
              title: 'Could not verify',
              body: 'Something went wrong. Please try again.',
            );
          }
          final cert = snap.data;
          if (cert == null) {
            return _Status(
              icon: Icons.help_outline,
              color: AppColors.muted,
              title: 'Certificate not found',
              body: 'No certificate matches ID "${widget.certId.toUpperCase()}".',
            );
          }
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.verified,
                          size: 48, color: AppColors.accent),
                      const SizedBox(height: 12),
                      const Text('Valid certificate',
                          style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                              color: AppColors.primary)),
                      const SizedBox(height: 16),
                      _row('Name', cert.learnerName),
                      _row('Course', cert.courseTitle),
                      _row('Certificate ID', cert.certId),
                      if (cert.issuedAt != null)
                        _row('Issued',
                            cert.issuedAt!.toLocal().toString().split(' ').first),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 110,
              child: Text(label,
                  style: const TextStyle(color: AppColors.muted, fontSize: 13)),
            ),
            Expanded(
              child: Text(value,
                  style: const TextStyle(
                      fontWeight: FontWeight.w600, color: AppColors.ink)),
            ),
          ],
        ),
      );
}

class _Status extends StatelessWidget {
  const _Status(
      {required this.icon,
      required this.color,
      required this.title,
      required this.body});
  final IconData icon;
  final Color color;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: color),
            const SizedBox(height: 12),
            Text(title,
                style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink)),
            const SizedBox(height: 6),
            Text(body,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.muted)),
          ],
        ),
      ),
    );
  }
}
