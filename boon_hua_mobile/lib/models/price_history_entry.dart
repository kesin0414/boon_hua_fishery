import '../weight_units.dart';

class PriceHistoryEntry {
  const PriceHistoryEntry({
    this.id,
    required this.species,
    required this.pricePerKg,
    required this.recordedAt,
    this.quantityKg,
    this.weightValue,
    this.weightUnit = 'kg',
    this.totalPriceRm,
    this.freezerItemId,
  });

  final String? id;
  final String species;
  final double pricePerKg;
  final DateTime recordedAt;
  /// Canonical weight in kg (for RM/kg and freezer sync).
  final double? quantityKg;
  /// Weight amount in [weightUnit] for display/editing.
  final double? weightValue;
  final String weightUnit;
  /// Total RM paid for this purchase (used to recalc RM/kg when weight is corrected).
  final double? totalPriceRm;
  final String? freezerItemId;

  PriceHistoryEntry copyWith({
    String? id,
    String? species,
    double? pricePerKg,
    DateTime? recordedAt,
    double? quantityKg,
    double? weightValue,
    String? weightUnit,
    double? totalPriceRm,
    String? freezerItemId,
  }) {
    return PriceHistoryEntry(
      id: id ?? this.id,
      species: species ?? this.species,
      pricePerKg: pricePerKg ?? this.pricePerKg,
      recordedAt: recordedAt ?? this.recordedAt,
      quantityKg: quantityKg ?? this.quantityKg,
      weightValue: weightValue ?? this.weightValue,
      weightUnit: weightUnit ?? this.weightUnit,
      totalPriceRm: totalPriceRm ?? this.totalPriceRm,
      freezerItemId: freezerItemId ?? this.freezerItemId,
    );
  }
}

class PriceNormalizer {
  const PriceNormalizer();

  double calculatePricePerKg({
    required double totalPrice,
    required double quantityKg,
  }) {
    if (quantityKg <= 0) return 0;
    return totalPrice / quantityKg;
  }

  double normalizeFromWeight({
    required double totalPrice,
    required double weightValue,
    required String unit,
  }) {
    final quantityKg = _toKg(weightValue, unit);
    return calculatePricePerKg(totalPrice: totalPrice, quantityKg: quantityKg);
  }

  double _toKg(double value, String unit) => WeightUnits.toKg(value, unit);
}
