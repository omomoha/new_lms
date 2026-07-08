import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../models/certificate.dart';
import '../../services/firestore_service.dart';
import '../../theme/app_theme.dart';

/// Public certificate verification page (`/verify/:certId`). Reachable without
/// auth. Reads certificates/{certId.toUpperCase()} via a public single `get`
/// (never a list). Mirrors `src/app/verify/[certId]/page.tsx`.
class VerifyCertificateScreen extends StatefulWidget {
  const VerifyCertificateScreen({super.key, required this.certId});
  final String certId;

  @override
  State<VerifyCertificateScreen> createState() =>
      _VerifyCertificateScreenState();
}

class _VerifyCertificateScreenState extends State<VerifyCertificateScreen> {
  late Future<Certificate?> _future;

  String get _upperId => widget.certId.toUpperCase();

  @override
  void initState() {
    super.initState();
    _future = context.read<FirestoreService>().getCertificate(widget.certId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.primary,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(height: 24),
                  // Diamond motif + title.
                  Transform.rotate(
                    angle: 0.785398,
                    child: Container(
                      width: 12,
                      height: 12,
                      color: AppColors.accent,
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Text('Andela Learn — Certificate Verification',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w700)),
                  const SizedBox(height: 24),
                  Container(
                    width: double.infinity,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    padding: const EdgeInsets.all(28),
                    child: FutureBuilder<Certificate?>(
                      future: _future,
                      builder: (context, snap) {
                        if (snap.connectionState == ConnectionState.waiting) {
                          return const Padding(
                            padding: EdgeInsets.symmetric(vertical: 8),
                            child: Text('Checking certificate…',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: AppColors.muted)),
                          );
                        }
                        if (snap.hasError) return _error();
                        final cert = snap.data;
                        if (cert == null) return _notFound();
                        return _valid(cert);
                      },
                    ),
                  ),
                  const SizedBox(height: 20),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _valid(Certificate cert) {
    final issued = cert.issuedAt != null
        ? DateFormat('d MMMM y').format(cert.issuedAt!)
        : null;
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.mint,
            borderRadius: BorderRadius.circular(999),
          ),
          child: const Text('✓ Valid certificate',
              style: TextStyle(
                  fontWeight: FontWeight.w700, color: AppColors.primary)),
        ),
        const SizedBox(height: 20),
        const Text('AWARDED TO',
            style: TextStyle(
                fontSize: 11,
                letterSpacing: 0.5,
                color: AppColors.muted,
                fontWeight: FontWeight.w600)),
        const SizedBox(height: 4),
        Text(cert.learnerName,
            textAlign: TextAlign.center,
            style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w700,
                color: AppColors.primary)),
        const SizedBox(height: 16),
        const Text('FOR COMPLETING',
            style: TextStyle(
                fontSize: 11,
                letterSpacing: 0.5,
                color: AppColors.muted,
                fontWeight: FontWeight.w600)),
        const SizedBox(height: 4),
        Text(cert.courseTitle,
            textAlign: TextAlign.center,
            style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: AppColors.ink)),
        const SizedBox(height: 20),
        if (issued != null)
          Text('Issued $issued',
              style: const TextStyle(fontSize: 13, color: AppColors.muted)),
        const SizedBox(height: 4),
        Text.rich(
          TextSpan(children: [
            const TextSpan(
                text: 'Certificate ID: ',
                style: TextStyle(fontSize: 13, color: AppColors.muted)),
            TextSpan(
                text: cert.certId,
                style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.muted)),
          ]),
        ),
      ],
    );
  }

  Widget _notFound() {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: const Color(0xFFFEE2E2),
            borderRadius: BorderRadius.circular(999),
          ),
          child: const Text('✕ No certificate found',
              style: TextStyle(
                  fontWeight: FontWeight.w700, color: Color(0xFF991B1B))),
        ),
        const SizedBox(height: 12),
        Text(
          'No certificate with ID $_upperId exists. Check the ID and try again.',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 13, color: AppColors.muted),
        ),
      ],
    );
  }

  Widget _error() {
    return const Text(
      'Could not check the certificate right now. Please try again shortly.',
      textAlign: TextAlign.center,
      style: TextStyle(fontSize: 13, color: Color(0xFF991B1B)),
    );
  }
}
