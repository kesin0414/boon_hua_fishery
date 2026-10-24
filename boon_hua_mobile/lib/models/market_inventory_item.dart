/// Admin inventory row from Firestore `inventory` collection (web dashboard).
class MarketInventoryItem {
  const MarketInventoryItem({
    required this.id,
    required this.species,
    required this.pricePerKg,
    required this.weightKg,
    this.status = '',
    this.category = '',
  });

  final String id;
  final String species;
  /// List/market price in RM per kg (`price` field in Firestore).
  final double pricePerKg;
  final double weightKg;
  final String status;
  final String category;

  static String normalizeSpecies(String species) =>
      species.trim().toLowerCase();

  /// One row per species with a list price; excludes out-of-stock (0 kg) rows.
  static List<MarketInventoryItem> consolidateBySpecies(
    List<MarketInventoryItem> items,
  ) {
    final bySpecies = <String, MarketInventoryItem>{};
    for (final item in items) {
      if (item.pricePerKg <= 0) continue;
      final key = normalizeSpecies(item.species);
      final existing = bySpecies[key];
      if (existing == null) {
        bySpecies[key] = item;
      } else if (item.weightKg > existing.weightKg) {
        var winner = item;
        if (winner.category.isEmpty && existing.category.isNotEmpty) {
          winner = MarketInventoryItem(
            id: winner.id,
            species: winner.species,
            pricePerKg: winner.pricePerKg,
            weightKg: winner.weightKg,
            status: winner.status,
            category: existing.category,
          );
        }
        bySpecies[key] = winner;
      } else if (existing.category.isEmpty && item.category.isNotEmpty) {
        bySpecies[key] = MarketInventoryItem(
          id: existing.id,
          species: existing.species,
          pricePerKg: existing.pricePerKg,
          weightKg: existing.weightKg,
          status: existing.status,
          category: item.category,
        );
      }
    }
    final consolidated = bySpecies.values
        .where((item) => item.weightKg > 0)
        .toList()
      ..sort(
        (a, b) => a.species.toLowerCase().compareTo(b.species.toLowerCase()),
      );
    return consolidated;
  }

  /// First inventory row matching species (case/spacing insensitive).
  static MarketInventoryItem? findBySpecies(
    List<MarketInventoryItem> items,
    String species,
  ) {
    final key = normalizeSpecies(species);
    for (final item in items) {
      if (normalizeSpecies(item.species) == key) return item;
    }
    return null;
  }

  /// Unique species names from admin inventory, sorted A–Z.
  static List<String> distinctSpeciesNames(List<MarketInventoryItem> items) {
    final seen = <String>{};
    final names = <String>[];
    for (final item in items) {
      final label = item.species.trim();
      if (label.isEmpty) continue;
      final key = normalizeSpecies(label);
      if (seen.add(key)) names.add(label);
    }
    names.sort(
      (a, b) => a.toLowerCase().compareTo(b.toLowerCase()),
    );
    return names;
  }
}
