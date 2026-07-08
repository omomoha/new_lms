import 'dart:typed_data';

import 'package:firebase_storage/firebase_storage.dart';

import '../logic/video_embed.dart';

// Re-export the video-embed port so callers can use `toEmbedUrl` from the same
// file-handling surface the web exposes it on.
export '../logic/video_embed.dart' show toEmbedUrl, EmbedResult, VideoProvider;

/// How the document viewer should render a file — Dart port of
/// `getDocRenderKind` in `src/lib/files.ts`.
///  - text   → fetch + native Markdown/plain-text renderer (md, markdown, txt)
///  - docx   → in-browser DOCX→HTML on web; mobile has no renderer (external open)
///  - pdf    → inline PDF viewer (downloads disabled)
///  - office → Office Online embed / server-converted PDF twin (pptx, ppt, doc…)
enum DocRenderKind { text, docx, pdf, office }

String _cleanPath(String filename) {
  try {
    final uri = Uri.parse(filename);
    if (uri.hasScheme) return uri.path.toLowerCase();
  } catch (_) {
    // fall through
  }
  return filename.split('?')[0].toLowerCase();
}

DocRenderKind getDocRenderKind(String filename) {
  final clean = _cleanPath(filename);
  if (clean.endsWith('.md') ||
      clean.endsWith('.markdown') ||
      clean.endsWith('.txt')) {
    return DocRenderKind.text;
  }
  if (clean.endsWith('.docx')) return DocRenderKind.docx;
  if (clean.endsWith('.pdf')) return DocRenderKind.pdf;
  return DocRenderKind.office;
}

/// True if the path/URL points to a plain-text/markdown file rendered natively.
bool isTextDoc(String filename) {
  final clean = _cleanPath(filename);
  return clean.endsWith('.md') ||
      clean.endsWith('.markdown') ||
      clean.endsWith('.txt');
}

/// True if the path/URL points to a PDF (query strings/fragments stripped).
bool isPdf(String filename) => _cleanPath(filename).endsWith('.pdf');

/// Resolves Firebase Storage paths (lesson resources, captions) to download
/// URLs. Mirrors the web's `getResourceUrl` / captions handling and the
/// server-converted Office PDF twin convention (`${filePath}.pdf`).
class FileService {
  final FirebaseStorage _storage;

  FileService({FirebaseStorage? storage})
      : _storage = storage ?? FirebaseStorage.instance;

  /// Convert a storage path (Lesson.filePath) into a download URL.
  Future<String> resourceUrl(String storagePath) =>
      _storage.ref(storagePath).getDownloadURL();

  /// Download the raw bytes of a storage object (used to render PDFs inline
  /// with pdfx and to fetch md/txt content). Max 50 MB. Null on failure.
  Future<Uint8List?> resourceBytes(String storagePath) async {
    try {
      return await _storage.ref(storagePath).getData(50 * 1024 * 1024);
    } catch (_) {
      return null;
    }
  }

  /// Bytes of the server-converted PDF twin at `${filePath}.pdf`, or null when
  /// no twin exists yet.
  Future<Uint8List?> officePdfTwinBytes(String filePath) async {
    try {
      return await _storage.ref('$filePath.pdf').getData(50 * 1024 * 1024);
    } catch (_) {
      return null;
    }
  }

  /// Try the server-converted PDF twin at `${filePath}.pdf` (written by the
  /// convertOfficeToPdf Storage trigger for pptx/ppt/doc). Returns null when
  /// no twin exists.
  Future<String?> officePdfTwinUrl(String filePath) async {
    try {
      return await _storage.ref('$filePath.pdf').getDownloadURL();
    } catch (_) {
      return null;
    }
  }

  /// Resolve a WebVTT captions path to a URL, or null if unset/unavailable.
  Future<String?> captionsUrl(String? path) async {
    if (path == null || path.isEmpty) return null;
    try {
      return await _storage.ref(path).getDownloadURL();
    } catch (_) {
      return null;
    }
  }
}
