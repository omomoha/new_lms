import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:pdfx/pdfx.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../services/file_service.dart';
import '../../theme/app_theme.dart';
import 'text_lesson.dart';

/// Unified renderer for slides/doc/lab resource files. Decision table mirrors
/// the web DocumentViewer via [getDocRenderKind]:
///   .md/.markdown/.txt → fetch text + native Markdown (TextLesson)
///   .pdf               → inline paged PDF viewer (pdfx, downloads disabled)
///   office (pptx/ppt/doc/…) → server-converted `${filePath}.pdf` twin in the
///                             PDF viewer, else external open (url_launcher)
///   .docx              → NO in-app renderer → external open (documented gap)
class DocumentViewer extends StatefulWidget {
  const DocumentViewer({
    super.key,
    required this.fileService,
    required this.filePath,
    required this.fileUrl,
    required this.title,
  });

  final FileService fileService;
  final String? filePath;
  final String? fileUrl;
  final String title;

  @override
  State<DocumentViewer> createState() => _DocumentViewerState();
}

enum _Mode { loading, text, pdf, external, unavailable }

class _DocumentViewerState extends State<DocumentViewer> {
  _Mode _mode = _Mode.loading;
  String? _text;
  PdfControllerPinch? _pdf;
  String? _externalUrl;
  String? _message;

  String get _source => widget.filePath ?? widget.fileUrl ?? '';

  @override
  void initState() {
    super.initState();
    _prepare();
  }

  Future<void> _prepare() async {
    if (_source.isEmpty) {
      _set(_Mode.unavailable, message: 'File not yet uploaded for this lesson.');
      return;
    }
    final kind = getDocRenderKind(_source);
    try {
      switch (kind) {
        case DocRenderKind.text:
          final bytes = await _bytes();
          if (bytes == null) {
            await _prepareExternal();
          } else {
            _text = utf8.decode(bytes, allowMalformed: true);
            _set(_Mode.text);
          }
          break;

        case DocRenderKind.pdf:
          final bytes = await _bytes();
          if (bytes == null) {
            await _prepareExternal();
          } else {
            _openPdf(bytes);
          }
          break;

        case DocRenderKind.office:
          // Prefer the server-converted PDF twin.
          Uint8List? twin;
          if (widget.filePath != null) {
            twin = await widget.fileService.officePdfTwinBytes(widget.filePath!);
          }
          if (twin != null) {
            _openPdf(twin);
          } else {
            await _prepareExternal(
              note:
                  'Opening in an external app. A page-by-page PDF version is '
                  'usually ready within a couple of minutes — reopen to get it.',
            );
          }
          break;

        case DocRenderKind.docx:
          // No in-app DOCX renderer on mobile (web uses in-browser mammoth).
          await _prepareExternal(
            note: 'DOCX files open in an external app on mobile.',
          );
          break;
      }
    } catch (_) {
      _set(_Mode.unavailable,
          message: 'Unable to load this document. Check your connection.');
    }
  }

  Future<Uint8List?> _bytes() async {
    if (widget.filePath != null) {
      return widget.fileService.resourceBytes(widget.filePath!);
    }
    return null; // fileUrl-only → handled by external open
  }

  void _openPdf(Uint8List bytes) {
    _pdf = PdfControllerPinch(document: PdfDocument.openData(bytes));
    _set(_Mode.pdf);
  }

  Future<void> _prepareExternal({String? note}) async {
    String? url = widget.fileUrl;
    if (url == null && widget.filePath != null) {
      try {
        url = await widget.fileService.resourceUrl(widget.filePath!);
      } catch (_) {
        url = null;
      }
    }
    if (url == null) {
      _set(_Mode.unavailable,
          message: 'Unable to load this document. Check your connection.');
      return;
    }
    _externalUrl = url;
    _set(_Mode.external, message: note);
  }

  void _set(_Mode mode, {String? message}) {
    if (!mounted) return;
    setState(() {
      _mode = mode;
      _message = message;
    });
  }

  Future<void> _openExternal() async {
    final url = _externalUrl;
    if (url == null) return;
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open the document.')),
        );
      }
    }
  }

  @override
  void dispose() {
    _pdf?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    switch (_mode) {
      case _Mode.loading:
        return const SizedBox(
          height: 240,
          child: Center(child: CircularProgressIndicator()),
        );
      case _Mode.text:
        return TextLesson(content: _text ?? '');
      case _Mode.pdf:
        return SizedBox(
          height: MediaQuery.of(context).size.height * 0.7,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: PdfViewPinch(controller: _pdf!),
          ),
        );
      case _Mode.external:
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              children: [
                const Icon(Icons.description_outlined,
                    size: 48, color: AppColors.teal),
                const SizedBox(height: 12),
                Text(
                  _message ?? 'This document opens in an external app.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.muted),
                ),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: _openExternal,
                  icon: const Icon(Icons.open_in_new),
                  label: const Text('Open document'),
                ),
              ],
            ),
          ),
        );
      case _Mode.unavailable:
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: Text(
                _message ?? 'File not available.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.muted),
              ),
            ),
          ),
        );
    }
  }
}
