// Ported 1:1 from web tests/search.test.ts. The Dart port folds Latin
// diacritics via a lookup map (Dart core has no NFD normalizer) — these cases
// assert it yields the SAME results as the web NFD implementation.
import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/logic/search.dart';

class _Course extends Searchable {
  final String id;
  _Course(this.id, String title, [String? description])
      : super(title: title, description: description);
}

final courses = <_Course>[
  _Course('1', 'Intro to TypeScript', 'Types, generics and more'),
  _Course('2', 'Café Culture & Communication', 'Soft skills résumé builder'),
  _Course('3', 'C++ (Advanced)', 'Pointers, RAII, templates'),
  _Course('4', 'Data Engineering', ''),
  _Course('5', 'No description course'),
];

List<String> ids(List<_Course> cs) => cs.map((c) => c.id).toList();

void main() {
  group('normalizeForSearch', () {
    test('lowercases', () {
      expect(normalizeForSearch('HeLLo'), 'hello');
    });

    test('strips diacritics', () {
      expect(normalizeForSearch('Café Résumé'), 'cafe resume');
    });
  });

  group('filterCourses', () {
    test('returns all items for an empty query', () {
      expect(ids(filterCourses(courses, '')), ids(courses));
    });

    test('returns all items for a whitespace-only query', () {
      expect(ids(filterCourses(courses, '   ')), ids(courses));
    });

    test('matches title case-insensitively', () {
      expect(ids(filterCourses(courses, 'tYpEsCrIpT')), ['1']);
    });

    test('matches description text', () {
      expect(ids(filterCourses(courses, 'generics')), ['1']);
    });

    test('is diacritic-insensitive in both directions', () {
      expect(ids(filterCourses(courses, 'cafe')), ['2']);
      expect(ids(filterCourses(courses, 'café')), ['2']);
      expect(ids(filterCourses(courses, 'résumé')), ['2']);
    });

    test('returns an empty list when nothing matches', () {
      expect(filterCourses(courses, 'quantum basket weaving'), isEmpty);
    });

    test('does not break on special regex characters', () {
      expect(() => filterCourses(courses, 'c++ ('), returnsNormally);
      expect(ids(filterCourses(courses, 'C++ (Advanced)')), ['3']);
      expect(() => filterCourses(courses, '.*[a-z]('), returnsNormally);
      expect(filterCourses(courses, '.*'), isEmpty);
    });

    test('handles items without a description', () {
      expect(ids(filterCourses(courses, 'no description')), ['5']);
    });

    test('trims surrounding whitespace from the query', () {
      expect(ids(filterCourses(courses, '  typescript  ')), ['1']);
    });
  });
}
