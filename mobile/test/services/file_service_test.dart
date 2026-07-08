// Pure-function coverage of the file_service render-kind port (mirrors
// getDocRenderKind / isPdf / isTextDoc in web src/lib/files.ts) and the
// re-exported toEmbedUrl. No Firebase is instantiated here.
import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/services/file_service.dart';

void main() {
  group('getDocRenderKind', () {
    test('markdown / plain text -> text', () {
      expect(getDocRenderKind('notes.md'), DocRenderKind.text);
      expect(getDocRenderKind('notes.markdown'), DocRenderKind.text);
      expect(getDocRenderKind('notes.txt'), DocRenderKind.text);
      expect(getDocRenderKind('NOTES.MD'), DocRenderKind.text); // case-insensitive
    });

    test('docx -> docx', () {
      expect(getDocRenderKind('report.docx'), DocRenderKind.docx);
    });

    test('pdf -> pdf', () {
      expect(getDocRenderKind('slides.pdf'), DocRenderKind.pdf);
    });

    test('office formats and unknowns -> office', () {
      expect(getDocRenderKind('deck.pptx'), DocRenderKind.office);
      expect(getDocRenderKind('deck.ppt'), DocRenderKind.office);
      expect(getDocRenderKind('legacy.doc'), DocRenderKind.office);
      expect(getDocRenderKind('sheet.xlsx'), DocRenderKind.office);
    });

    test('strips query string / uses URL path', () {
      expect(getDocRenderKind('https://x.com/a/file.pdf?token=abc'),
          DocRenderKind.pdf);
      expect(getDocRenderKind('resource.pdf?v=2'), DocRenderKind.pdf);
    });
  });

  group('isPdf / isTextDoc', () {
    test('isPdf', () {
      expect(isPdf('a.pdf'), isTrue);
      expect(isPdf('https://x.com/a.pdf?t=1'), isTrue);
      expect(isPdf('a.docx'), isFalse);
    });

    test('isTextDoc', () {
      expect(isTextDoc('a.md'), isTrue);
      expect(isTextDoc('a.txt'), isTrue);
      expect(isTextDoc('a.pdf'), isFalse);
    });
  });

  group('re-exported toEmbedUrl', () {
    test('accepts a YouTube URL', () {
      final r = toEmbedUrl('https://youtu.be/dQw4w9WgXcQ');
      expect(r?.embedUrl, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
    });

    test('rejects an arbitrary URL', () {
      expect(toEmbedUrl('https://vimeo.com/1'), isNull);
    });
  });
}
