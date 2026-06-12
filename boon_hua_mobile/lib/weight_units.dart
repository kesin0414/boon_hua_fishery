/// Shared weight unit conversion for freezer items and price history.
class WeightUnits {
  WeightUnits._();

  static const options = ['g', 'kg', 'lb'];

  static double toKg(double value, String unit) {
    switch (unit.toLowerCase()) {
      case 'g':
      case 'gram':
      case 'grams':
        return value / 1000;
      case 'lb':
      case 'lbs':
        return value * 0.453592;
      case 'kg':
      case 'kgs':
      default:
        return value;
    }
  }

  static double fromKg(double kg, String unit) {
    switch (unit.toLowerCase()) {
      case 'g':
      case 'gram':
      case 'grams':
        return kg * 1000;
      case 'lb':
      case 'lbs':
        return kg / 0.453592;
      case 'kg':
      case 'kgs':
      default:
        return kg;
    }
  }

  static String formatQuantity(double? kg, String unit) {
    if (kg == null || kg <= 0) return '—';
    final display = fromKg(kg, unit);
    final decimals = unit == 'g' ? 0 : 2;
    return '${display.toStringAsFixed(decimals)} $unit';
  }

  static String formatStockKg(double stockKg, String unit) =>
      formatQuantity(stockKg, unit);
}
