import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_config.dart';

class RecipeChatMessage {
  const RecipeChatMessage({required this.role, required this.content});

  final String role;
  final String content;

  Map<String, dynamic> toJson() => {'role': role, 'content': content};
}

class RecipeChatResult {
  const RecipeChatResult({
    required this.reply,
    this.recipeMaps = const [],
    this.source = 'ai',
  });

  final String reply;
  final List<Map<String, dynamic>> recipeMaps;
  final String source;
}

class FreezerItemPayload {
  const FreezerItemPayload({
    required this.species,
    required this.stockKg,
    required this.daysRemaining,
  });

  final String species;
  final double stockKg;
  final int daysRemaining;

  Map<String, dynamic> toJson() => {
        'species': species,
        'stockKg': stockKg,
        'daysRemaining': daysRemaining,
      };
}

class RecipeAiService {
  /// `null` = could not reach status endpoint (often old API not deployed).
  Future<bool?> isAiEnabled() async {
    try {
      final base = await ApiConfig.baseUrl();
      final response = await http
          .get(Uri.parse('$base/recipes/ai-status'))
          .timeout(const Duration(seconds: 12));
      if (response.statusCode == 404) return null;
      if (response.statusCode >= 200 && response.statusCode < 300) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        return data['enabled'] == true;
      }
    } catch (_) {}
    return false;
  }

  Future<RecipeChatResult> chat({
    required String message,
    required List<FreezerItemPayload> freezerItems,
    required List<RecipeChatMessage> history,
  }) async {
    final base = await ApiConfig.baseUrl();
    final response = await http
        .post(
          Uri.parse('$base/recipes/chat'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'message': message,
            'items': freezerItems.map((item) => item.toJson()).toList(),
            'history': history.map((m) => m.toJson()).toList(),
          }),
        )
        .timeout(const Duration(seconds: 60));

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final detail = _errorDetail(response.body);
      throw Exception(detail ?? 'AI assistant unavailable (${response.statusCode})');
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final reply = (data['reply'] as String?)?.trim() ?? '';
    final recipesRaw = data['recipes'] as List<dynamic>? ?? [];
    final recipeMaps = recipesRaw
        .whereType<Map<String, dynamic>>()
        .toList();

    return RecipeChatResult(
      reply: reply.isEmpty ? 'No response from the assistant.' : reply,
      recipeMaps: recipeMaps,
      source: data['source'] as String? ?? 'ai',
    );
  }

  String? _errorDetail(String body) {
    try {
      final data = jsonDecode(body) as Map<String, dynamic>;
      return data['detail']?.toString();
    } catch (_) {
      return null;
    }
  }
}
