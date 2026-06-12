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

/// Result of checking whether the API and AI layer are available.
class RecipeAiAvailability {
  const RecipeAiAvailability({
    required this.apiReachable,
    this.aiEnabled = false,
    this.provider,
    this.apiDown = false,
  });

  /// FastAPI responded on GET / with expected JSON.
  final bool apiReachable;

  /// GEMINI_API_KEY or OPENAI_API_KEY is set on the server.
  final bool aiEnabled;

  final String? provider;

  /// Render returned no-server (service stopped or not deployed).
  final bool apiDown;

  /// `null` = still checking; use [RecipeAiService.checkAvailability].
  static const unknown = RecipeAiAvailability(apiReachable: false);
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

/// Thrown when the server returns HTTP 429 (Gemini rate limit).
class RecipeAiRateLimitException implements Exception {
  RecipeAiRateLimitException(this.message, {this.retryAfterSeconds = 60});

  final String message;
  final int retryAfterSeconds;

  @override
  String toString() => message;
}

class RecipeAiService {
  /// Prefer GET / (aiRecipes + ai.enabled). Falls back to /recipes/ai-status.
  Future<RecipeAiAvailability> checkAvailability() async {
    final base = await ApiConfig.baseUrl();

    try {
      final root = await http.get(Uri.parse(base)).timeout(const Duration(seconds: 15));
      final renderRouting = root.headers['x-render-routing'] ?? '';

      if (root.statusCode == 404 && renderRouting.contains('no-server')) {
        return const RecipeAiAvailability(apiReachable: false, apiDown: true);
      }

      if (root.statusCode >= 200 && root.statusCode < 300) {
        final data = jsonDecode(root.body) as Map<String, dynamic>;
        final parsed = _parseAiFromRoot(data);
        if (parsed != null) {
          return RecipeAiAvailability(
            apiReachable: true,
            aiEnabled: parsed.$1,
            provider: parsed.$2,
          );
        }
      }
    } catch (_) {}

    try {
      final status = await http
          .get(Uri.parse('$base/recipes/ai-status'))
          .timeout(const Duration(seconds: 12));
      if (status.statusCode >= 200 && status.statusCode < 300) {
        final data = jsonDecode(status.body) as Map<String, dynamic>;
        return RecipeAiAvailability(
          apiReachable: true,
          aiEnabled: data['enabled'] == true,
          provider: data['provider'] as String?,
        );
      }
      if (status.statusCode == 404) {
        final alt = await http
            .get(Uri.parse('$base/recipes/aistatus'))
            .timeout(const Duration(seconds: 12));
        if (alt.statusCode >= 200 && alt.statusCode < 300) {
          final data = jsonDecode(alt.body) as Map<String, dynamic>;
          return RecipeAiAvailability(
            apiReachable: true,
            aiEnabled: data['enabled'] == true,
            provider: data['provider'] as String?,
          );
        }
      }
    } catch (_) {}

    return const RecipeAiAvailability(apiReachable: false);
  }

  /// Back-compat: `null` if API down/unknown, `true`/`false` for AI key.
  Future<bool?> isAiEnabled() async {
    final status = await checkAvailability();
    if (status.apiDown || !status.apiReachable) return null;
    return status.aiEnabled;
  }

  (bool enabled, String? provider)? _parseAiFromRoot(Map<String, dynamic> data) {
    final status = (data['status'] as String?)?.toLowerCase();
    if (status != null && status != 'online' && status != 'ok') return null;

    final ai = data['ai'];
    if (ai is Map<String, dynamic>) {
      return (
        ai['enabled'] == true,
        ai['provider'] as String?,
      );
    }
    if (data.containsKey('aiRecipes')) {
      return (
        data['aiRecipes'] == true,
        null,
      );
    }
    return (false, null);
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
      final friendly = _friendlyChatError(detail, response.statusCode);
      if (_isRateLimitedStatus(response.statusCode, detail)) {
        final retryHeader = response.headers['retry-after'];
        final retrySec = int.tryParse(retryHeader ?? '') ?? 60;
        throw RecipeAiRateLimitException(friendly, retryAfterSeconds: retrySec);
      }
      throw Exception(friendly);
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    final reply = (data['reply'] as String?)?.trim() ?? '';
    final recipesRaw = data['recipes'] as List<dynamic>? ?? [];
    final recipeMaps = recipesRaw.whereType<Map<String, dynamic>>().toList();

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

  bool _isRateLimitedStatus(int statusCode, String? detail) {
    final lower = (detail ?? '').toLowerCase();
    return statusCode == 429 ||
        lower.contains('429') ||
        lower.contains('too many requests') ||
        lower.contains('rate-limited') ||
        lower.contains('quota');
  }

  String _friendlyChatError(String? detail, int statusCode) {
    final lower = (detail ?? '').toLowerCase();
    if (_isRateLimitedStatus(statusCode, detail)) {
      return 'The chef is catching up — your answer may use quick tips instead of full AI. '
          'Wait a moment and try again for a longer reply.';
    }
    if (statusCode == 404) {
      return 'AI chat is not available on this API URL (404). '
          'In admin Settings → Mobile Recipe API URL use '
          'https://boon-hua-fishery.onrender.com (no trailing path), save, '
          'then reopen the app.';
    }
    if (detail != null && detail.trim().isNotEmpty) {
      return detail.replaceFirst(RegExp(r'^Gemini:\s*'), '');
    }
    return 'AI assistant unavailable ($statusCode).';
  }
}
