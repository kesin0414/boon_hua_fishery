import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../api_config.dart';
import '../receipt_scanner.dart';

/// Cloud vision receipt OCR — used only when on-device parse is empty/low confidence.
class ReceiptAiOcrService {
  Future<ParsedReceipt> extractFromFile(
    File imageFile, {
    String? mlKitHint,
  }) async {
    var bytes = await imageFile.readAsBytes();
    if (bytes.isEmpty) {
      throw Exception('Could not read the receipt photo.');
    }
    // Keep uploads small so AI OCR stays responsive on mobile networks.
    if (bytes.length > 900 * 1024) {
      throw Exception(
        'Photo is too large for quick AI OCR. Crop tighter to the handwriting and try again.',
      );
    }

    final path = imageFile.path.toLowerCase();
    final mimeType = path.endsWith('.png')
        ? 'image/png'
        : path.endsWith('.webp')
            ? 'image/webp'
            : 'image/jpeg';

    final base = await ApiConfig.baseUrl();
    final body = <String, dynamic>{
      'imageBase64': base64Encode(bytes),
      'mimeType': mimeType,
    };
    final hint = mlKitHint?.trim();
    if (hint != null && hint.isNotEmpty) {
      body['mlKitHint'] = hint.length > 500 ? hint.substring(0, 500) : hint;
    }

    final response = await http
        .post(
          Uri.parse('$base/receipt/ocr'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 35));

    if (response.statusCode == 404) {
      throw Exception(
        'Receipt AI OCR is not on the server yet. Ask admin to redeploy the API.',
      );
    }
    if (response.statusCode == 429) {
      throw Exception('AI is busy right now. Please try again in a minute.');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      String detail = 'Could not read this receipt (${response.statusCode}).';
      try {
        final decoded = jsonDecode(response.body);
        if (decoded is Map && decoded['detail'] != null) {
          detail = '${decoded['detail']}';
        }
      } catch (_) {}
      throw Exception(detail);
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return ReceiptParser.parsedReceiptFromAiJson(data);
  }
}
