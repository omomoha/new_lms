// Mirrors the accept/reject contract of web src/lib/videoEmbed.ts:
// only YouTube (/embed/{id}) and Google Drive (/file/d/{id}/preview) URLs are
// accepted; everything else returns null (never embed arbitrary URLs).
import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/logic/video_embed.dart';

const String ytId = 'dQw4w9WgXcQ'; // 11 chars
const String driveId = '1A2B3C4D5E6F'; // 12 chars (>= 10)

void main() {
  group('toEmbedUrl — YouTube (accepted)', () {
    test('youtube.com/watch?v=<id>', () {
      final r = toEmbedUrl('https://www.youtube.com/watch?v=$ytId');
      expect(r?.provider, VideoProvider.youtube);
      expect(r?.embedUrl, 'https://www.youtube.com/embed/$ytId');
    });

    test('strips www and still matches', () {
      final r = toEmbedUrl('https://youtube.com/watch?v=$ytId');
      expect(r?.embedUrl, 'https://www.youtube.com/embed/$ytId');
    });

    test('youtu.be/<id>', () {
      final r = toEmbedUrl('https://youtu.be/$ytId');
      expect(r?.provider, VideoProvider.youtube);
      expect(r?.embedUrl, 'https://www.youtube.com/embed/$ytId');
    });

    test('youtube.com/shorts/<id>', () {
      final r = toEmbedUrl('https://www.youtube.com/shorts/$ytId');
      expect(r?.provider, VideoProvider.youtube);
      expect(r?.embedUrl, 'https://www.youtube.com/embed/$ytId');
    });
  });

  group('toEmbedUrl — Google Drive (accepted)', () {
    test('/file/d/<id>/view -> /preview', () {
      final r = toEmbedUrl('https://drive.google.com/file/d/$driveId/view');
      expect(r?.provider, VideoProvider.drive);
      expect(r?.embedUrl, 'https://drive.google.com/file/d/$driveId/preview');
    });

    test('/file/d/<id>/preview -> /preview', () {
      final r = toEmbedUrl('https://drive.google.com/file/d/$driveId/preview');
      expect(r?.embedUrl, 'https://drive.google.com/file/d/$driveId/preview');
    });
  });

  group('toEmbedUrl — rejected', () {
    test('null / empty', () {
      expect(toEmbedUrl(null), isNull);
      expect(toEmbedUrl(''), isNull);
    });

    test('non-YouTube/Drive host (vimeo)', () {
      expect(toEmbedUrl('https://vimeo.com/123456789'), isNull);
    });

    test('arbitrary http host', () {
      expect(toEmbedUrl('https://evil.example.com/embed/$ytId'), isNull);
    });

    test('relative / schemeless URL', () {
      expect(toEmbedUrl('watch?v=$ytId'), isNull);
    });

    test('YouTube id with wrong length', () {
      expect(toEmbedUrl('https://youtu.be/short'), isNull);
      expect(toEmbedUrl('https://www.youtube.com/watch?v=short'), isNull);
    });

    test('Drive id too short (< 10 chars)', () {
      expect(toEmbedUrl('https://drive.google.com/file/d/short/view'), isNull);
    });
  });
}
