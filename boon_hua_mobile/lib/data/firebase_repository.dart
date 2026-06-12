import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/freezer_item.dart';
import '../models/price_history_entry.dart';
import '../weight_units.dart';

class FirebaseRepository {
  FirebaseRepository(this.userId);

  final String userId;
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  CollectionReference<Map<String, dynamic>> get _freezerCollection {
    return _db.collection('users').doc(userId).collection('virtualFreezer');
  }

  CollectionReference<Map<String, dynamic>> get _priceHistoryCollection {
    return _db.collection('users').doc(userId).collection('priceHistory');
  }

  CollectionReference<Map<String, dynamic>> get _freezerHistoryCollection {
    return _db.collection('users').doc(userId).collection('freezerHistory');
  }

  Stream<List<FreezerItem>> watchFreezerItems() {
    return _freezerCollection
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((snapshot) {
          return snapshot.docs.map((doc) => _freezerFromDoc(doc)).toList();
        });
  }

  Stream<List<PriceHistoryEntry>> watchPriceHistory() {
    return _priceHistoryCollection
        .orderBy('recordedAt', descending: true)
        .snapshots()
        .map((snapshot) {
          return snapshot.docs.map((doc) => _historyFromDoc(doc)).toList();
        });
  }

  Stream<List<FreezerHistoryEntry>> watchFreezerHistory() {
    return _freezerHistoryCollection
        .orderBy('recordedAt', descending: true)
        .snapshots()
        .map(
          (snapshot) => snapshot.docs.map((doc) => _freezerHistoryFromDoc(doc)).toList(),
        );
  }

  Future<String> addFreezerItem(FreezerItem item) async {
    final ref = _freezerCollection.doc();
    await ref.set(_freezerToMap(item));
    return ref.id;
  }

  Future<void> addFreezerItems(List<FreezerItem> items) async {
    final batch = _db.batch();
    for (final item in items) {
      batch.set(_freezerCollection.doc(), _freezerToMap(item));
    }
    await batch.commit();
  }

  Future<void> updateFreezerItem(FreezerItem item) async {
    if (item.id == null) return;
    await _freezerCollection
        .doc(item.id)
        .update(_freezerToMap(item, includeCreatedAt: false));
  }

  Future<void> deleteFreezerItem(FreezerItem item) async {
    if (item.id == null) return;
    await _freezerCollection.doc(item.id).delete();
  }

  Future<String> addPriceHistory(PriceHistoryEntry entry) async {
    final ref = _priceHistoryCollection.doc();
    await ref.set(_historyToMap(entry));
    return ref.id;
  }

  /// Creates freezer item and linked price history in one batch.
  Future<void> addFreezerWithPriceHistory({
    required FreezerItem item,
    required PriceHistoryEntry history,
  }) async {
    final freezerRef = _freezerCollection.doc();
    final historyRef = _priceHistoryCollection.doc();
    final batch = _db.batch();
    batch.set(
      historyRef,
      {
        ..._historyToMap(history),
        'freezerItemId': freezerRef.id,
      },
    );
    batch.set(
      freezerRef,
      {
        ..._freezerToMap(item),
        'linkedPriceHistoryId': historyRef.id,
      },
    );
    await batch.commit();
  }

  Future<void> addPriceHistoryEntries(List<PriceHistoryEntry> entries) async {
    final batch = _db.batch();
    for (final entry in entries) {
      batch.set(_priceHistoryCollection.doc(), _historyToMap(entry));
    }
    await batch.commit();
  }

  Future<void> updatePriceHistory(PriceHistoryEntry entry) async {
    if (entry.id == null) return;
    await _priceHistoryCollection.doc(entry.id).update(_historyUpdateMap(entry));
  }

  Future<void> deletePriceHistory(PriceHistoryEntry entry) async {
    if (entry.id == null) return;
    await _priceHistoryCollection.doc(entry.id).delete();
  }

  Future<void> recordFreezerLoss({
    required FreezerItem item,
    required String reason,
    String note = '',
  }) async {
    if (item.id == null) return;
    final batch = _db.batch();
    final historyRef = _freezerHistoryCollection.doc();
    batch.set(historyRef, {
      'species': item.species,
      'stockKg': item.stockKg,
      'reason': reason,
      'note': note.trim(),
      'freezerItemId': item.id,
      'displayWeightUnit': item.displayWeightUnit,
      'recordedAt': FieldValue.serverTimestamp(),
      'createdAt': FieldValue.serverTimestamp(),
    });
    final nextStatus = reason == 'consumed' ? 'consumed' : 'spoiled';
    batch.update(_freezerCollection.doc(item.id!), {
      'status': nextStatus,
      'statusChangedAt': FieldValue.serverTimestamp(),
    });
    await batch.commit();
  }

  FreezerItem _freezerFromDoc(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data();
    return FreezerItem(
      id: doc.id,
      species: data['species'] ?? '',
      stockKg: (data['stockKg'] as num?)?.toDouble() ?? 0,
      purchaseDate: _dateFromValue(data['purchaseDate']),
      bestBeforeDate: _dateFromValue(data['bestBeforeDate']),
      pricePerKg: (data['pricePerKg'] as num?)?.toDouble() ?? 0,
      iconKey: data['iconKey'] as String? ?? 'fish',
      imagePath: data['imageFileName'] as String?,
      displayWeightUnit: data['displayWeightUnit'] as String? ?? 'g',
      linkedPriceHistoryId: data['linkedPriceHistoryId'] as String?,
      status: data['status'] as String? ?? 'active',
      statusChangedAt: data['statusChangedAt'] is Timestamp
          ? (data['statusChangedAt'] as Timestamp).toDate()
          : null,
    );
  }

  FreezerHistoryEntry _freezerHistoryFromDoc(
    QueryDocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final data = doc.data();
    return FreezerHistoryEntry(
      id: doc.id,
      species: data['species'] ?? '',
      stockKg: (data['stockKg'] as num?)?.toDouble() ?? 0,
      reason: data['reason'] as String? ?? 'spoiled',
      recordedAt: _dateFromValue(data['recordedAt']),
      note: data['note'] as String? ?? '',
      freezerItemId: data['freezerItemId'] as String?,
      displayWeightUnit: data['displayWeightUnit'] as String? ?? 'g',
    );
  }

  PriceHistoryEntry _historyFromData(String id, Map<String, dynamic> data) {
    final quantityKg = (data['quantityKg'] as num?)?.toDouble();
    final weightUnit = data['weightUnit'] as String? ?? 'kg';
    final weightValue = (data['weightValue'] as num?)?.toDouble() ??
        (quantityKg != null ? WeightUnits.fromKg(quantityKg, weightUnit) : null);
    return PriceHistoryEntry(
      id: id,
      species: data['species'] ?? '',
      pricePerKg: (data['pricePerKg'] as num?)?.toDouble() ?? 0,
      recordedAt: _dateFromValue(data['recordedAt']),
      quantityKg: quantityKg,
      weightValue: weightValue,
      weightUnit: weightUnit,
      totalPriceRm: (data['totalPriceRm'] as num?)?.toDouble(),
      freezerItemId: data['freezerItemId'] as String?,
    );
  }

  PriceHistoryEntry _historyFromDoc(
    QueryDocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    return _historyFromData(doc.id, doc.data());
  }

  Future<PriceHistoryEntry?> getPriceHistoryById(String id) async {
    final doc = await _priceHistoryCollection.doc(id).get();
    if (!doc.exists) return null;
    final data = doc.data();
    if (data == null) return null;
    return _historyFromData(doc.id, data);
  }

  Future<PriceHistoryEntry?> findPriceHistoryByFreezerItemId(
    String freezerItemId,
  ) async {
    final snap = await _priceHistoryCollection
        .where('freezerItemId', isEqualTo: freezerItemId)
        .limit(5)
        .get();
    if (snap.docs.isEmpty) return null;
    final entries = snap.docs.map(_historyFromDoc).toList()
      ..sort((a, b) => b.recordedAt.compareTo(a.recordedAt));
    return entries.first;
  }

  Future<void> upsertFreezerWithLinkedHistory({
    required FreezerItem item,
    required PriceHistoryEntry history,
  }) async {
    if (item.id == null) return;
    var itemToSave = item;
    final batch = _db.batch();
    final freezerRef = _freezerCollection.doc(item.id!);
    if (history.id != null) {
      batch.update(
        _priceHistoryCollection.doc(history.id!),
        _historyUpdateMap(history),
      );
    } else {
      final historyRef = _priceHistoryCollection.doc();
      batch.set(historyRef, {
        ..._historyToMap(history),
        'freezerItemId': item.id,
      });
      itemToSave = item.copyWith(linkedPriceHistoryId: historyRef.id);
    }
    batch.update(
      freezerRef,
      _freezerToMap(itemToSave, includeCreatedAt: false),
    );
    await batch.commit();
  }

  Map<String, dynamic> _freezerToMap(FreezerItem item, {bool includeCreatedAt = true}) {
    return {
      'species': item.species,
      'stockKg': item.stockKg,
      'purchaseDate': Timestamp.fromDate(item.purchaseDate),
      'bestBeforeDate': Timestamp.fromDate(item.bestBeforeDate),
      'pricePerKg': item.pricePerKg,
      'iconKey': item.iconKey,
      'displayWeightUnit': item.displayWeightUnit,
      'status': item.status.isEmpty ? 'active' : item.status,
      if (item.statusChangedAt != null)
        'statusChangedAt': Timestamp.fromDate(item.statusChangedAt!),
      if (item.linkedPriceHistoryId != null)
        'linkedPriceHistoryId': item.linkedPriceHistoryId,
      if (item.imagePath != null) 'imageFileName': item.imagePath,
      if (includeCreatedAt) 'createdAt': FieldValue.serverTimestamp(),
    };
  }

  Map<String, dynamic> _historyToMap(PriceHistoryEntry entry) {
    return {
      'species': entry.species.trim(),
      'pricePerKg': entry.pricePerKg,
      'recordedAt': Timestamp.fromDate(entry.recordedAt),
      if (entry.quantityKg != null) 'quantityKg': entry.quantityKg,
      if (entry.weightValue != null) 'weightValue': entry.weightValue,
      'weightUnit': entry.weightUnit,
      if (entry.totalPriceRm != null) 'totalPriceRm': entry.totalPriceRm,
      if (entry.freezerItemId != null) 'freezerItemId': entry.freezerItemId,
      'createdAt': FieldValue.serverTimestamp(),
    };
  }

  Map<String, dynamic> _historyUpdateMap(PriceHistoryEntry entry) {
    return {
      'species': entry.species.trim(),
      'pricePerKg': entry.pricePerKg,
      'recordedAt': Timestamp.fromDate(entry.recordedAt),
      if (entry.quantityKg != null) 'quantityKg': entry.quantityKg,
      if (entry.weightValue != null) 'weightValue': entry.weightValue,
      'weightUnit': entry.weightUnit,
      if (entry.totalPriceRm != null) 'totalPriceRm': entry.totalPriceRm,
      if (entry.freezerItemId != null) 'freezerItemId': entry.freezerItemId,
    };
  }

  DateTime _dateFromValue(Object? value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    return DateTime.now();
  }
}
