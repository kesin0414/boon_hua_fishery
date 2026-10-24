import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../api_config.dart';

class SeafoodIdentifyResult {
  const SeafoodIdentifyResult({
    required this.species,
    required this.commonName,
    required this.confidence,
    required this.category,
    required this.photoQuality,
    required this.qualityNote,
    required this.dishIdeas,
    required this.disclaimer,
    required this.statusNote,
    this.previewFeature = true,
  });

  final String species;
  final String commonName;
  final double confidence;
  final String category;
  final String photoQuality;
  final String qualityNote;
  final List<String> dishIdeas;
  final String disclaimer;
  final String statusNote;
  final bool previewFeature;

  bool get photoLooksPoor =>
      photoQuality == 'mixed_pile' ||
      photoQuality == 'ice_glare' ||
      photoQuality == 'blurry' ||
      photoQuality == 'unclear';

  factory SeafoodIdentifyResult.fromJson(Map<String, dynamic> json) {
    final dishes = (json['dishIdeas'] as List<dynamic>? ?? [])
        .map((item) => '$item'.trim())
        .where((item) => item.isNotEmpty)
        .toList();
    return SeafoodIdentifyResult(
      species: (json['species'] as String?)?.trim().isNotEmpty == true
          ? (json['species'] as String).trim()
          : 'Unknown seafood',
      commonName: (json['commonName'] as String?)?.trim() ?? '',
      confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
      category: (json['category'] as String?)?.trim() ?? 'Unknown',
      photoQuality: (json['photoQuality'] as String?)?.trim().toLowerCase() ??
          'unclear',
      qualityNote: (json['qualityNote'] as String?)?.trim() ?? '',
      dishIdeas: dishes,
      disclaimer: (json['disclaimer'] as String?)?.trim().isNotEmpty == true
          ? (json['disclaimer'] as String).trim()
          : 'This guess is not always 100% accurate. Confirm the seafood yourself before cooking.',
      statusNote: (json['statusNote'] as String?)?.trim().isNotEmpty == true
          ? (json['statusNote'] as String).trim()
          : 'This seafood photo ID feature is not yet fully developed.',
      previewFeature: json['previewFeature'] != false,
    );
  }
}

class SeafoodIdentifyService {
  Future<SeafoodIdentifyResult> identifyFromFile(File imageFile) async {
    final bytes = await imageFile.readAsBytes();
    if (bytes.isEmpty) {
      throw Exception('Could not read the photo. Please try again.');
    }
    // Keep payload reasonable for mobile networks.
    if (bytes.length > 4 * 1024 * 1024) {
      throw Exception(
        'Photo is too large. Move closer, use a clearer single subject, and try again.',
      );
    }

    final path = imageFile.path.toLowerCase();
    final mimeType = path.endsWith('.png')
        ? 'image/png'
        : path.endsWith('.webp')
            ? 'image/webp'
            : 'image/jpeg';

    final base = await ApiConfig.baseUrl();
    final response = await http
        .post(
          Uri.parse('$base/seafood/identify'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'imageBase64': base64Encode(bytes),
            'mimeType': mimeType,
          }),
        )
        .timeout(const Duration(seconds: 70));

    if (response.statusCode == 404) {
      throw Exception(
        'Seafood photo ID is not available on the server yet. '
        'Ask admin to redeploy the API with /seafood/identify.',
      );
    }
    if (response.statusCode == 429) {
      throw Exception('AI is busy right now. Please try again in a minute.');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      String detail = 'Could not identify this photo (${response.statusCode}).';
      try {
        final body = jsonDecode(response.body);
        if (body is Map && body['detail'] != null) {
          detail = '${body['detail']}';
        }
      } catch (_) {}
      throw Exception(detail);
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return SeafoodIdentifyResult.fromJson(data);
  }
}
