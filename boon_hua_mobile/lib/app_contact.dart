import 'package:url_launcher/url_launcher.dart';

/// WhatsApp and contact helpers (store + buyers).
class AppContact {
  AppContact._();

  static const defaultMessage =
      'Hi Boon Hua Fishery, I need help with my account.';

  /// Fallback when Firestore store phone is not set yet.
  static const fallbackWhatsAppDigits = '60162003486';
  static const fallbackWhatsAppDisplay = '+60 16 200 3486';

  /// E.164-style digits for wa.me (Malaysia-friendly).
  static String normalizeWhatsAppDigits(String? phone) {
    var digits = (phone ?? '').replaceAll(RegExp(r'\D'), '');
    if (digits.isEmpty) return '';
    if (digits.startsWith('60')) return digits;
    if (digits.startsWith('0')) return '60${digits.substring(1)}';
    return digits;
  }

  static String formatDisplayPhone(String? phone) {
    final trimmed = phone?.trim() ?? '';
    if (trimmed.isNotEmpty) return trimmed;
    return '';
  }

  static Uri whatsAppUri({required String digits, String? message}) {
    final text = Uri.encodeComponent(message ?? defaultMessage);
    return Uri.parse('https://wa.me/$digits?text=$text');
  }

  static Future<bool> openWhatsApp({
    required String phone,
    String? message,
  }) async {
    final digits = normalizeWhatsAppDigits(phone);
    if (digits.isEmpty) return false;
    final uri = whatsAppUri(digits: digits, message: message);
    if (await canLaunchUrl(uri)) {
      return launchUrl(uri, mode: LaunchMode.externalApplication);
    }
    return false;
  }

  static Future<bool> openAdminWhatsApp({String? message, String? storePhone}) async {
    final digits = normalizeWhatsAppDigits(storePhone);
    final use = digits.isNotEmpty ? digits : fallbackWhatsAppDigits;
    return openWhatsApp(phone: use, message: message);
  }

  static String buyerCollectionMessage({
    required String buyerName,
    required String amountOwing,
    String? saleRef,
  }) {
    final ref = saleRef != null && saleRef.isNotEmpty ? ' (ref $saleRef)' : '';
    return 'Hi $buyerName, this is Boon Hua Fishery regarding your '
        'outstanding balance of RM $amountOwing$ref. Please let us know when payment can be arranged. Thank you.';
  }
}
