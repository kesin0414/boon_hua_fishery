import 'package:url_launcher/url_launcher.dart';

/// Admin WhatsApp for Contact Us (testing).
class AppContact {
  AppContact._();

  /// E.164 without + or spaces — used in wa.me links.
  static const adminWhatsAppDigits = '60162003486';

  static const adminWhatsAppDisplay = '+60 16 200 3486';

  static const defaultMessage =
      'Hi Boon Hua Fishery, I need help with my account.';

  static Uri whatsAppUri({String? message}) {
    final text = Uri.encodeComponent(message ?? defaultMessage);
    return Uri.parse('https://wa.me/$adminWhatsAppDigits?text=$text');
  }

  static Future<bool> openAdminWhatsApp({String? message}) async {
    final uri = whatsAppUri(message: message);
    if (await canLaunchUrl(uri)) {
      return launchUrl(uri, mode: LaunchMode.externalApplication);
    }
    return false;
  }
}
