/// Course search utilities.
///
/// Pure Dart port of `src/lib/search.ts`. Matching is diacritic- and
/// case-insensitive substring over title + description.
///
/// DEVIATION FROM WEB: JS uses `String.normalize("NFD")` + stripping the
/// combining-marks range. Dart's core library has no Unicode NFD normalizer,
/// so we fold precomposed Latin diacritics via a lookup map AND strip any
/// standalone combining marks (U+0300–U+036F). This yields identical results
/// for realistic course text ("Café" → "cafe", "Über" → "uber", "naïve" →
/// "naive") without adding a dependency.

/// Minimal searchable shape — courses satisfy this.
class Searchable {
  final String title;
  final String? description;
  const Searchable({required this.title, this.description});
}

const Map<int, String> _diacriticFold = {
  // a
  0x00E0: 'a', 0x00E1: 'a', 0x00E2: 'a', 0x00E3: 'a', 0x00E4: 'a',
  0x00E5: 'a', 0x0101: 'a', 0x0103: 'a', 0x0105: 'a',
  // c
  0x00E7: 'c', 0x0107: 'c', 0x0109: 'c', 0x010B: 'c', 0x010D: 'c',
  // d
  0x010F: 'd', 0x0111: 'd',
  // e
  0x00E8: 'e', 0x00E9: 'e', 0x00EA: 'e', 0x00EB: 'e', 0x0113: 'e',
  0x0115: 'e', 0x0117: 'e', 0x0119: 'e', 0x011B: 'e',
  // g
  0x011D: 'g', 0x011F: 'g', 0x0121: 'g', 0x0123: 'g',
  // i
  0x00EC: 'i', 0x00ED: 'i', 0x00EE: 'i', 0x00EF: 'i', 0x0129: 'i',
  0x012B: 'i', 0x012D: 'i', 0x012F: 'i', 0x0131: 'i',
  // l
  0x013A: 'l', 0x013C: 'l', 0x013E: 'l', 0x0142: 'l',
  // n
  0x00F1: 'n', 0x0144: 'n', 0x0146: 'n', 0x0148: 'n',
  // o
  0x00F2: 'o', 0x00F3: 'o', 0x00F4: 'o', 0x00F5: 'o', 0x00F6: 'o',
  0x00F8: 'o', 0x014D: 'o', 0x014F: 'o', 0x0151: 'o',
  // r
  0x0155: 'r', 0x0157: 'r', 0x0159: 'r',
  // s
  0x015B: 's', 0x015D: 's', 0x015F: 's', 0x0161: 's', 0x017F: 's',
  // t
  0x0163: 't', 0x0165: 't', 0x0167: 't',
  // u
  0x00F9: 'u', 0x00FA: 'u', 0x00FB: 'u', 0x00FC: 'u', 0x0169: 'u',
  0x016B: 'u', 0x016D: 'u', 0x016F: 'u', 0x0171: 'u', 0x0173: 'u',
  // y
  0x00FD: 'y', 0x00FF: 'y', 0x0177: 'y',
  // z
  0x017A: 'z', 0x017C: 'z', 0x017E: 'z',
  // ligatures / special
  0x00E6: 'ae', 0x0153: 'oe', 0x00DF: 'ss',
};

/// Normalize text for matching: lowercase, fold Latin diacritics, strip
/// standalone combining marks.
String normalizeForSearch(String text) {
  final lower = text.toLowerCase();
  final sb = StringBuffer();
  for (final rune in lower.runes) {
    if (rune >= 0x0300 && rune <= 0x036F) continue; // combining marks
    final folded = _diacriticFold[rune];
    if (folded != null) {
      sb.write(folded);
    } else {
      sb.writeCharCode(rune);
    }
  }
  return sb.toString();
}

/// Filter items by a free-text query against title + description.
/// Empty/whitespace query returns all items.
List<T> filterCourses<T extends Searchable>(List<T> items, String query) {
  final q = normalizeForSearch(query.trim());
  if (q.isEmpty) return items;
  return items
      .where((item) =>
          normalizeForSearch('${item.title} ${item.description ?? ''}')
              .contains(q))
      .toList();
}
