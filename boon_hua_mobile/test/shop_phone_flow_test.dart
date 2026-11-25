import 'package:boon_hua_mobile/models/market_inventory_item.dart';
import 'package:boon_hua_mobile/models/price_history_entry.dart';
import 'package:boon_hua_mobile/receipt_scanner.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('shop-to-phone rehearsal: market hides 0 kg, scan fills freezer, price edit recalculates', () {
    final inventory = [
      const MarketInventoryItem(
        id: 'a',
        species: 'Octopus',
        pricePerKg: 22,
        weightKg: 14,
        category: 'Squid',
      ),
      const MarketInventoryItem(
        id: 'b',
        species: 'Stingray',
        pricePerKg: 18,
        weightKg: 0,
        category: 'Fish',
      ),
    ];

    final market = MarketInventoryItem.consolidateBySpecies(inventory);
    expect(market.map((item) => item.species), ['Octopus']);
    expect(market.first.pricePerKg, 22);

    const raw = '''
16/6
1. Octopus 1kg RM20
''';
    final receipt = ReceiptParser().parse(raw);
    final freezer = FreezerService().createItemsFromReceipt(receipt);
    expect(freezer, hasLength(1));
    expect(freezer.first.species.toLowerCase(), contains('octopus'));
    expect(freezer.first.stockKg, 1);
    expect(freezer.first.pricePerKg, 20);
    expect(
      freezer.first.bestBeforeDate.difference(freezer.first.purchaseDate).inDays,
      FreezerService.defaultShelfLifeDays,
    );

    const normalizer = PriceNormalizer();
    final editedPerKg = normalizer.normalizeFromWeight(
      totalPrice: 20,
      weightValue: 500,
      unit: 'g',
    );
    expect(editedPerKg, 40);
  });
}
