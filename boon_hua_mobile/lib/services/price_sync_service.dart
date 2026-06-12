import '../data/firebase_repository.dart';
import '../models/freezer_item.dart';
import '../models/price_history_entry.dart';
import '../weight_units.dart';

class FreezerPriceSyncOutcome {
  const FreezerPriceSyncOutcome({
    required this.itemToSave,
    required this.priceHistoryUpdated,
    this.hadExistingLink = false,
  });

  final FreezerItem itemToSave;
  final bool priceHistoryUpdated;
  final bool hadExistingLink;
}

class PriceSyncService {
  const PriceSyncService();

  static DateTime dateOnly(DateTime value) =>
      DateTime(value.year, value.month, value.day);

  PriceHistoryEntry historyFromFreezerItem(
    FreezerItem item, {
    double? totalPriceRm,
  }) {
    final total = totalPriceRm ??
        (item.pricePerKg > 0 && item.stockKg > 0
            ? item.pricePerKg * item.stockKg
            : null);
    return PriceHistoryEntry(
      species: item.species,
      pricePerKg: item.pricePerKg,
      recordedAt: item.purchaseDate,
      quantityKg: item.stockKg,
      weightValue: WeightUnits.fromKg(item.stockKg, item.displayWeightUnit),
      weightUnit: item.displayWeightUnit,
      totalPriceRm: total,
    );
  }

  double purchaseTotalRm(FreezerItem item) {
    if (item.pricePerKg <= 0 || item.stockKg <= 0) return 0;
    return double.parse(
      (item.pricePerKg * item.stockKg).toStringAsFixed(2),
    );
  }

  PriceHistoryEntry? _linkedFromCache(
    String? historyId,
    List<PriceHistoryEntry> cachedHistory,
  ) {
    if (historyId == null) return null;
    for (final entry in cachedHistory) {
      if (entry.id == historyId) return entry;
    }
    return null;
  }

  Future<PriceHistoryEntry?> resolveLinkedPriceHistory({
    required FreezerItem? existing,
    required FreezerItem updated,
    required FirebaseRepository repository,
    required List<PriceHistoryEntry> cachedHistory,
  }) async {
    final linkIds = <String>{
      if (existing?.linkedPriceHistoryId != null) existing!.linkedPriceHistoryId!,
      if (updated.linkedPriceHistoryId != null) updated.linkedPriceHistoryId!,
    };

    for (final id in linkIds) {
      final cached = _linkedFromCache(id, cachedHistory);
      if (cached != null) return cached;
      final fetched = await repository.getPriceHistoryById(id);
      if (fetched != null) return fetched;
    }

    if (updated.id != null) {
      for (final entry in cachedHistory) {
        if (entry.freezerItemId == updated.id) return entry;
      }
      final fetched = await repository.findPriceHistoryByFreezerItemId(
        updated.id!,
      );
      if (fetched != null) return fetched;
    }

    if (linkIds.isEmpty) {
      final purchaseDay = dateOnly(updated.purchaseDate);
      for (final entry in cachedHistory) {
        if (entry.freezerItemId != null) continue;
        if (entry.species.trim().toLowerCase() ==
                updated.species.trim().toLowerCase() &&
            dateOnly(entry.recordedAt) == purchaseDay) {
          return entry;
        }
      }
    }

    return null;
  }

  Future<FreezerPriceSyncOutcome> syncFreezerUpdate({
    required FreezerItem? existing,
    required FreezerItem item,
    required FirebaseRepository repository,
    required List<PriceHistoryEntry> cachedHistory,
  }) async {
    var itemToSave = item;
    final linked = await resolveLinkedPriceHistory(
      existing: existing,
      updated: item,
      repository: repository,
      cachedHistory: cachedHistory,
    );
    final newTotal = purchaseTotalRm(item);

    if (item.pricePerKg > 0 && item.id != null) {
      final priorTotal = linked?.totalPriceRm ??
          (linked != null
              ? linked.pricePerKg * (linked.quantityKg ?? item.stockKg)
              : 0);
      final weightChanged = existing != null &&
          (existing.stockKg - item.stockKg).abs() > 0.0001;
      final priceChanged =
          existing == null || (priorTotal - newTotal).abs() > 0.009;
      final totalPaid = (weightChanged && !priceChanged && priorTotal > 0)
          ? priorTotal
          : newTotal;
      final correctedPricePerKg = item.stockKg > 0
          ? totalPaid / item.stockKg
          : item.pricePerKg;

      itemToSave = item.copyWith(pricePerKg: correctedPricePerKg);

      final historyEntry = historyFromFreezerItem(
        itemToSave,
        totalPriceRm: totalPaid,
      ).copyWith(
        id: linked?.id,
        freezerItemId: itemToSave.id,
      );

      if (linked != null) {
        await repository.upsertFreezerWithLinkedHistory(
          item: itemToSave.copyWith(linkedPriceHistoryId: linked.id),
          history: historyEntry,
        );
      } else {
        final historyId = await repository.addPriceHistory(historyEntry);
        itemToSave = itemToSave.copyWith(linkedPriceHistoryId: historyId);
        await repository.updateFreezerItem(itemToSave);
      }

      return FreezerPriceSyncOutcome(
        itemToSave: itemToSave,
        priceHistoryUpdated: true,
        hadExistingLink: linked != null,
      );
    }

    await repository.updateFreezerItem(itemToSave);
    return FreezerPriceSyncOutcome(
      itemToSave: itemToSave,
      priceHistoryUpdated: false,
    );
  }
}
