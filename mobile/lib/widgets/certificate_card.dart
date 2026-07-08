import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../state/course_controller.dart';
import '../theme/app_theme.dart';

/// Certificate card shown when the learner is eligible (pct>=100 AND (no post
/// OR post passed)) or a certificate already exists. Calls `issueCertificate`
/// and opens the returned signed PDF URL; shows certId + verify link. Maps
/// failed-precondition via the controller. Mirrors the web certificate card.
class CertificateCard extends StatelessWidget {
  const CertificateCard({super.key, required this.controller});

  final CourseController controller;

  Future<void> _get(BuildContext context) async {
    final url = await controller.issueCertificate();
    if (url == null || url.isEmpty) return;
    final uri = Uri.tryParse(url);
    if (uri != null) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cert = controller.certificate;
    final issued = cert != null;

    return Card(
      color: const Color(0xFFFBFDF9),
      child: Container(
        decoration: const BoxDecoration(
          border: Border(
            left: BorderSide(color: AppColors.accent, width: 4),
          ),
        ),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('CERTIFICATE',
                style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.5,
                    color: AppColors.teal)),
            const SizedBox(height: 4),
            Text(
              issued
                  ? 'Your certificate has been issued 🎓'
                  : "You've earned your certificate 🎓",
              style: const TextStyle(
                  fontWeight: FontWeight.w700, color: AppColors.primary),
            ),
            const SizedBox(height: 6),
            if (issued)
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text('ID: ${cert.certId}  ·  ',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.muted)),
                  InkWell(
                    onTap: () => context.push('/verify/${cert.certId}'),
                    child: const Text('public verification link',
                        style: TextStyle(
                            fontSize: 12,
                            color: AppColors.teal,
                            decoration: TextDecoration.underline)),
                  ),
                  const Text('  ·  a copy was emailed to you',
                      style:
                          TextStyle(fontSize: 12, color: AppColors.muted)),
                ],
              )
            else
              const Text(
                'Download your branded PDF — it will also be emailed to you.',
                style: TextStyle(fontSize: 12, color: AppColors.muted),
              ),
            if (controller.certError != null) ...[
              const SizedBox(height: 6),
              Text(controller.certError!,
                  style: const TextStyle(
                      fontSize: 12, color: Color(0xFFB91C1C))),
            ],
            const SizedBox(height: 12),
            FilledButton(
              onPressed: controller.certLoading ? null : () => _get(context),
              child: Text(controller.certLoading
                  ? 'Preparing…'
                  : issued
                      ? 'Download PDF'
                      : 'Get my certificate'),
            ),
          ],
        ),
      ),
    );
  }
}
