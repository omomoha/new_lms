// Pure-unit tests for logic/tutor_markdown.dart (7A). The inert transform must
// strip every tappable/launchable surface (links, images, autolinks incl.
// javascript:/data:) down to visible text BEFORE flutter_markdown renders it,
// while leaving safe structural markdown (headings, lists, bold/italic, fenced
// code, blockquotes) intact for flutter_markdown to render.

import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/logic/tutor_markdown.dart';

void main() {
  group('inertTutorMarkdown strips live surfaces', () {
    test('inline link → visible text only (no url, no brackets)', () {
      final out = inertTutorMarkdown('See [the docs](https://evil.example) now');
      expect(out, 'See the docs now');
      expect(out.contains('https://evil.example'), isFalse);
      expect(out.contains('['), isFalse);
      expect(out.contains(']('), isFalse);
    });

    test('javascript: link is neutralised', () {
      final out = inertTutorMarkdown('[click](javascript:alert(1))');
      expect(out, 'click');
      expect(out.contains('javascript:'), isFalse);
    });

    test('image → alt text only (image dropped)', () {
      final out = inertTutorMarkdown('![diagram](https://x/y.png)');
      expect(out, 'diagram');
      expect(out.contains('.png'), isFalse);
    });

    test('autolink <https://…> → bare text (not an anchor)', () {
      final out = inertTutorMarkdown('visit <https://x.example/z>');
      expect(out.contains('<https://'), isFalse);
      expect(out.contains('>'), isFalse);
      expect(out.contains('https://x.example/z'), isTrue);
    });

    test('data:/mailto: autolinks are stripped of angle brackets', () {
      expect(inertTutorMarkdown('<mailto:a@b.com>').contains('<'), isFalse);
      expect(inertTutorMarkdown('<data:text/html,x>').contains('<data:'),
          isFalse);
    });

    test('multiple links on one line each collapse to text', () {
      final out = inertTutorMarkdown('[a](u1) and [b](u2)');
      expect(out, 'a and b');
    });
  });

  group('inertTutorMarkdown preserves safe markdown', () {
    test('leaves headings, bold, italic, inline code untouched', () {
      const src = '# Title\n\n**bold** and *italic* and `code()`';
      expect(inertTutorMarkdown(src), src);
    });

    test('leaves bullet + numbered lists untouched', () {
      const src = '- one\n- two\n\n1. first\n2. second';
      expect(inertTutorMarkdown(src), src);
    });

    test('leaves fenced code blocks (incl. their contents) untouched', () {
      const src = '```dart\nfinal x = [1,2];\n```';
      // Note: [1,2] is NOT link syntax ([text](url)), so it must survive.
      expect(inertTutorMarkdown(src), src);
    });

    test('leaves blockquotes untouched', () {
      const src = '> a quoted line';
      expect(inertTutorMarkdown(src), src);
    });

    test('empty string is a no-op', () {
      expect(inertTutorMarkdown(''), '');
    });
  });
}
