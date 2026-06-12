class FreezerItem {
  FreezerItem({
    this.id,
    required this.species,
    required this.stockKg,
    required this.purchaseDate,
    required this.bestBeforeDate,
    required this.pricePerKg,
    this.iconKey = 'fish',
    this.imagePath,
    this.displayWeightUnit = 'g',
    this.linkedPriceHistoryId,
    this.status = 'active',
    this.statusChangedAt,
  });

  final String? id;
  final String species;
  final double stockKg;
  final DateTime purchaseDate;
  DateTime bestBeforeDate;
  final double pricePerKg;
  final String iconKey;
  final String? imagePath;
  /// Unit shown when entering weight (g, kg, lb). Stock is always stored as kg.
  final String displayWeightUnit;
  final String? linkedPriceHistoryId;
  /// active | spoiled | consumed
  final String status;
  final DateTime? statusChangedAt;

  bool get isActive => status.isEmpty || status == 'active';

  int get daysRemaining {
    return bestBeforeDate.difference(DateTime.now()).inDays;
  }

  FreezerItem copyWith({
    String? id,
    String? species,
    double? stockKg,
    DateTime? purchaseDate,
    DateTime? bestBeforeDate,
    double? pricePerKg,
    String? iconKey,
    String? imagePath,
    String? displayWeightUnit,
    String? linkedPriceHistoryId,
    String? status,
    DateTime? statusChangedAt,
  }) {
    return FreezerItem(
      id: id ?? this.id,
      species: species ?? this.species,
      stockKg: stockKg ?? this.stockKg,
      purchaseDate: purchaseDate ?? this.purchaseDate,
      bestBeforeDate: bestBeforeDate ?? this.bestBeforeDate,
      pricePerKg: pricePerKg ?? this.pricePerKg,
      iconKey: iconKey ?? this.iconKey,
      imagePath: imagePath ?? this.imagePath,
      displayWeightUnit: displayWeightUnit ?? this.displayWeightUnit,
      linkedPriceHistoryId: linkedPriceHistoryId ?? this.linkedPriceHistoryId,
      status: status ?? this.status,
      statusChangedAt: statusChangedAt ?? this.statusChangedAt,
    );
  }
}

/// Record when seafood leaves the freezer (spoiled, expired, used, etc.).
class FreezerHistoryEntry {
  const FreezerHistoryEntry({
    this.id,
    required this.species,
    required this.stockKg,
    required this.reason,
    required this.recordedAt,
    this.note = '',
    this.freezerItemId,
    this.displayWeightUnit = 'g',
  });

  final String? id;
  final String species;
  final double stockKg;
  /// spoiled | expired | wastage | consumed
  final String reason;
  final DateTime recordedAt;
  final String note;
  final String? freezerItemId;
  final String displayWeightUnit;

  static String reasonLabel(String reason) {
    switch (reason) {
      case 'expired':
        return 'Expired';
      case 'wastage':
        return 'Wastage';
      case 'consumed':
        return 'Used / cooked';
      default:
        return 'Spoiled';
    }
  }
}
