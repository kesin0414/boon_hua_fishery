class SeafoodCategoryOption {
  const SeafoodCategoryOption({
    required this.value,
    required this.label,
    required this.emoji,
  });

  final String value;
  final String label;
  final String emoji;
}

class SeafoodCatalogEntry {
  const SeafoodCatalogEntry({
    required this.name,
    required this.keywords,
    required this.pricePerKg,
    required this.iconKey,
  });

  final String name;
  final List<String> keywords;
  final double pricePerKg;
  final String iconKey;
}

class SeafoodCatalog {
  SeafoodCatalog._();

  static const allCategoriesFilter = 'All';

  static const List<SeafoodCategoryOption> categoryOptions = [
    SeafoodCategoryOption(value: 'Fish', label: 'Fish', emoji: '🐟'),
    SeafoodCategoryOption(value: 'Shellfish', label: 'Shellfish', emoji: '🐚'),
    SeafoodCategoryOption(value: 'Prawn', label: 'Prawn & shrimp', emoji: '🦐'),
    SeafoodCategoryOption(value: 'Crab', label: 'Crab', emoji: '🦀'),
    SeafoodCategoryOption(value: 'Squid', label: 'Squid & octopus', emoji: '🦑'),
  ];

  static const List<SeafoodCatalogEntry> all = [
    SeafoodCatalogEntry(name: 'Peeled Tiger Prawn XL (大虎虾)', keywords: ['tiger prawn', 'prawn', 'udang', 'shrimp'], pricePerKg: 116, iconKey: 'prawn'),
    SeafoodCatalogEntry(name: 'Local Chinese Pomfret (上斗鲳)', keywords: ['pomfret', 'chinese pomfret', 'dou chang'], pricePerKg: 125, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Tiger Prawn XL (大虎虾)', keywords: ['tiger prawn', 'prawn', 'udang', 'shrimp'], pricePerKg: 62, iconKey: 'prawn'),
    SeafoodCatalogEntry(name: 'Giant Black Pomfret (大黑鲳)', keywords: ['pomfret', 'black pomfret'], pricePerKg: 45, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Dragon Tiger Grouper (龙虎班)', keywords: ['grouper', 'dragon tiger', 'long hu ban'], pricePerKg: 88, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Blue-spotted Sting Ray (蒲鱼)', keywords: ['stingray', 'sting ray', 'pari', 'ikan pari'], pricePerKg: 18, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Chinese Herring / Ikan Beliak Mata', keywords: ['herring', 'beliak', 'mata'], pricePerKg: 28, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Deep Sea Snapper (上红皂)', keywords: ['snapper', 'deep sea'], pricePerKg: 75, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Dragon Tiger Grouper Fillet (龙虎班)', keywords: ['grouper', 'fillet', 'dragon tiger'], pricePerKg: 145, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Duskytail Grouper / Kerapu (石斑魚)', keywords: ['grouper', 'kerapu', 'seabass'], pricePerKg: 75, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Fourfinger Threadfin Medium (Senangin)', keywords: ['threadfin', 'senangin', 'ma yau'], pricePerKg: 29, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Fourfinger Threadfin Small (Senangin)', keywords: ['threadfin', 'senangin', 'ma yau'], pricePerKg: 20, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Fourfinger Threadfin (上午)', keywords: ['threadfin', 'senangin', 'ma yau'], pricePerKg: 45, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Giant Dragon Tiger Grouper (大龙虎班)', keywords: ['grouper', 'dragon tiger'], pricePerKg: 75, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Golden Pomfret (銀鲳)', keywords: ['pomfret', 'golden pomfret'], pricePerKg: 48, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Golden Snapper (红皂)', keywords: ['snapper', 'golden snapper'], pricePerKg: 48, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Golden Snapper Fillet', keywords: ['snapper', 'fillet'], pricePerKg: 98, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Hardtail Scad / Cencaru', keywords: ['scad', 'cencaru', 'ikan kembung'], pricePerKg: 12, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Indian Threadfin / Kurau (順丰)', keywords: ['threadfin', 'kurau', 'senangin'], pricePerKg: 95, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Baby Cuttlefish / Sotong Katak (目仔)', keywords: ['cuttlefish', 'sotong katak', 'baby cuttlefish'], pricePerKg: 19, iconKey: 'squid'),
    SeafoodCatalogEntry(name: 'Bamboo Razor Clams (竹滩)', keywords: ['razor clam', 'bamboo clam', 'clam'], pricePerKg: 21, iconKey: 'shellfish'),
    SeafoodCatalogEntry(name: 'Cuttlefish / Sotong Katak (大目)', keywords: ['cuttlefish', 'sotong katak', 'sotong'], pricePerKg: 39, iconKey: 'squid'),
    SeafoodCatalogEntry(name: 'Female Flower Crab (女花蟹)', keywords: ['flower crab', 'crab', 'ketam'], pricePerKg: 45, iconKey: 'crab'),
    SeafoodCatalogEntry(name: 'Flower Crab (大市)', keywords: ['flower crab', 'crab', 'ketam'], pricePerKg: 49, iconKey: 'crab'),
    SeafoodCatalogEntry(name: 'LIVE Blood Cockle / Siham', keywords: ['cockle', 'siham', 'blood cockle', 'shellfish'], pricePerKg: 27, iconKey: 'shellfish'),
    SeafoodCatalogEntry(name: 'LIVE Hard Shell Clams / Kepah', keywords: ['clam', 'kepah', 'hard shell', 'shellfish'], pricePerKg: 21, iconKey: 'shellfish'),
    SeafoodCatalogEntry(name: 'LIVE Local Mud Crab L (螃蟹)', keywords: ['mud crab', 'crab', 'ketam'], pricePerKg: 95, iconKey: 'crab'),
    SeafoodCatalogEntry(name: 'Rainbow Prawns', keywords: ['rainbow prawn', 'prawn', 'udang', 'shrimp'], pricePerKg: 32, iconKey: 'prawn'),
    SeafoodCatalogEntry(name: 'Red Big Prawn L (红大虾)', keywords: ['red prawn', 'prawn', 'udang', 'shrimp'], pricePerKg: 68, iconKey: 'prawn'),
    SeafoodCatalogEntry(name: 'Red Big Prawn XL (红大虾)', keywords: ['red prawn', 'prawn', 'udang', 'shrimp'], pricePerKg: 75, iconKey: 'prawn'),
    SeafoodCatalogEntry(name: 'Squid M / Sotong Putih (沙中)', keywords: ['squid', 'sotong putih', 'sotong'], pricePerKg: 49, iconKey: 'squid'),
    SeafoodCatalogEntry(name: 'Super Big Red Prawn (特大虾)', keywords: ['red prawn', 'prawn', 'udang', 'shrimp'], pricePerKg: 90, iconKey: 'prawn'),
    SeafoodCatalogEntry(name: '[FROZEN] Dragon Tiger Grouper (龙虎班)', keywords: ['grouper', 'dragon tiger', 'frozen'], pricePerKg: 78, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Octopus', keywords: ['octopus', 'sotong kurak'], pricePerKg: 20, iconKey: 'squid'),
    SeafoodCatalogEntry(name: 'Stingray', keywords: ['stingray', 'pari'], pricePerKg: 18, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Salmon', keywords: ['salmon'], pricePerKg: 85, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Tilapia', keywords: ['tilapia', 'ikan'], pricePerKg: 15, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Mackerel / Kembung', keywords: ['mackerel', 'kembung', 'selar'], pricePerKg: 14, iconKey: 'fish'),
    SeafoodCatalogEntry(name: 'Squid / Sotong', keywords: ['squid', 'sotong', 'cuttlefish'], pricePerKg: 28, iconKey: 'squid'),
    SeafoodCatalogEntry(name: 'Crab / Ketam', keywords: ['crab', 'ketam'], pricePerKg: 55, iconKey: 'crab'),
    SeafoodCatalogEntry(name: 'Clam / Lala', keywords: ['clam', 'lala', 'mussel', 'shellfish'], pricePerKg: 18, iconKey: 'shellfish'),
  ];

  static List<String> get allNames => all.map((entry) => entry.name).toList();

  static String normalizeSpeciesKey(String name) =>
      name.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase();

  /// Same trimming as web `formatSpeciesLabel`.
  static String formatSpeciesLabel(String name) =>
      name.trim().replaceAll(RegExp(r'\s+'), ' ');

  static List<String> get ocrHints {
    final hints = <String>{};
    for (final entry in all) {
      hints.addAll(entry.keywords);
      for (final part in entry.name.toLowerCase().split(RegExp(r'[^a-z]+'))) {
        if (part.length > 2) hints.add(part);
      }
    }
    return hints.toList();
  }

  static SeafoodCatalogEntry? findByName(String species) {
    final key = normalizeSpeciesKey(species);
    for (final entry in all) {
      if (normalizeSpeciesKey(entry.name) == key) return entry;
    }
    return null;
  }

  static bool _matchesSpeciesQuery(String name, String query) {
    if (name.toLowerCase().contains(query)) return true;
    final entry = findByName(name);
    if (entry == null) return false;
    return entry.keywords.any(
      (keyword) => keyword.contains(query) || query.contains(keyword),
    );
  }

  /// Catalog + admin inventory species for autocomplete (inventory names first).
  static List<String> suggestSpeciesNames(
    String query, {
    Iterable<String> inventorySpecies = const [],
  }) {
    final q = query.trim().toLowerCase();
    final seen = <String>{};
    final result = <String>[];

    void tryAdd(String name) {
      final label = formatSpeciesLabel(name);
      if (label.isEmpty) return;
      final key = normalizeSpeciesKey(label);
      if (!seen.add(key)) return;
      if (q.isEmpty || _matchesSpeciesQuery(label, q)) {
        result.add(label);
      }
    }

    for (final name in inventorySpecies) {
      tryAdd(name);
    }
    for (final entry in all) {
      tryAdd(entry.name);
    }
    return result;
  }

  /// Canonical species label — matches web inventory naming where possible.
  static String resolveSpeciesName(
    String input, {
    Iterable<String> inventorySpecies = const [],
  }) {
    final formatted = formatSpeciesLabel(input);
    if (formatted.isEmpty) return formatted;

    final catalog = findByName(formatted);
    if (catalog != null) return catalog.name;

    final key = normalizeSpeciesKey(formatted);
    for (final inv in inventorySpecies) {
      if (normalizeSpeciesKey(inv) == key) {
        return formatSpeciesLabel(inv);
      }
    }

    final suggestions = suggestSpeciesNames(
      formatted,
      inventorySpecies: inventorySpecies,
    );
    if (suggestions.length == 1) return suggestions.first;
    for (final suggestion in suggestions) {
      if (suggestion.toLowerCase() == formatted.toLowerCase()) {
        return suggestion;
      }
    }

    return formatted;
  }

  static List<String> filterNames(String query) =>
      suggestSpeciesNames(query);

  static String iconKeyFor(String species) {
    final catalog = findByName(species);
    if (catalog != null) return catalog.iconKey;

    final name = species.toLowerCase();
    if (name.contains('prawn') ||
        name.contains('shrimp') ||
        name.contains('udang')) {
      return 'prawn';
    }
    if (name.contains('crab') || name.contains('ketam')) return 'crab';
    if (name.contains('squid') ||
        name.contains('sotong') ||
        name.contains('octopus') ||
        name.contains('cuttle')) {
      return 'squid';
    }
    if (name.contains('clam') ||
        name.contains('mussel') ||
        name.contains('lala') ||
        name.contains('cockle') ||
        name.contains('siham') ||
        name.contains('kepah') ||
        name.contains('shell')) {
      return 'shellfish';
    }
    return 'fish';
  }

  static String iconKeyForCategory(String? category) {
    switch ((category ?? '').toLowerCase()) {
      case 'shellfish':
        return 'shellfish';
      case 'prawn':
        return 'prawn';
      case 'crab':
        return 'crab';
      case 'squid':
        return 'squid';
      default:
        return 'fish';
    }
  }

  static bool isValidCategory(String value) {
    return categoryOptions.any((option) => option.value == value);
  }

  /// Category chips to show — only options that appear in [present].
  static List<SeafoodCategoryOption> categoryOptionsWithItems(
    Set<String> present,
  ) {
    if (present.isEmpty) return const [];
    return categoryOptions
        .where((option) => present.contains(option.value))
        .toList();
  }

  static String categoryFromIconKey(String iconKey) {
    switch (iconKey) {
      case 'shellfish':
        return 'Shellfish';
      case 'prawn':
        return 'Prawn';
      case 'crab':
        return 'Crab';
      case 'squid':
        return 'Squid';
      default:
        return 'Fish';
    }
  }

  static String resolveCategory(
    String species, {
    String? stored,
    String? inventoryCategory,
  }) {
    for (final candidate in [stored, inventoryCategory]) {
      if (candidate != null &&
          candidate.isNotEmpty &&
          isValidCategory(candidate)) {
        return candidate;
      }
    }
    final entry = findByName(species);
    if (entry != null) {
      return categoryFromIconKey(entry.iconKey);
    }
    return categoryFromIconKey(iconKeyFor(species));
  }

  static bool matchesSearch(String species, String category, String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return true;
    if (species.toLowerCase().contains(q)) return true;
    if (category.toLowerCase().contains(q)) return true;
    final entry = findByName(species);
    if (entry != null) {
      if (entry.name.toLowerCase().contains(q)) return true;
      if (entry.keywords.any(
        (keyword) => keyword.contains(q) || q.contains(keyword),
      )) {
        return true;
      }
    }
    return false;
  }

  static bool matchesCategoryFilter(String itemCategory, String filter) {
    if (filter == allCategoriesFilter) return true;
    return itemCategory == filter;
  }
}
