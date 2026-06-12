import 'package:cloud_firestore/cloud_firestore.dart';

/// Public store profile from Firestore `storeSettings/main` (admin web).
class StoreSettings {
  const StoreSettings({
    this.storeName = 'Boon Hua Fishery',
    this.address = '',
    this.openingTime = '',
    this.closingTime = '',
    this.phone = '',
    this.email = '',
    this.contactNote = '',
  });

  final String storeName;
  final String address;
  final String openingTime;
  final String closingTime;
  final String phone;
  final String email;
  final String contactNote;

  factory StoreSettings.fromMap(Map<String, dynamic>? data) {
    if (data == null) return const StoreSettings();
    return StoreSettings(
      storeName: (data['storeName'] as String?)?.trim() ?? 'Boon Hua Fishery',
      address: (data['address'] as String?)?.trim() ?? '',
      openingTime: (data['openingTime'] as String?)?.trim() ?? '',
      closingTime: (data['closingTime'] as String?)?.trim() ?? '',
      phone: (data['phone'] as String?)?.trim() ?? '',
      email: (data['email'] as String?)?.trim() ?? '',
      contactNote: (data['contactNote'] as String?)?.trim() ?? '',
    );
  }

  static Stream<StoreSettings> watchMain() {
    return FirebaseFirestore.instance
        .doc('storeSettings/main')
        .snapshots()
        .map((snap) => StoreSettings.fromMap(snap.data()));
  }

  String get hoursLabel {
    if (openingTime.isEmpty && closingTime.isEmpty) return '';
    return '${openingTime.isEmpty ? '—' : openingTime} – ${closingTime.isEmpty ? '—' : closingTime}';
  }
}
