import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../api_config.dart';
import '../models/freezer_item.dart';

class RecipeSuggestion {
  const RecipeSuggestion({
    required this.basedOn,
    required this.title,
    required this.minutes,
    required this.difficulty,
    required this.ingredients,
    required this.steps,
    required this.imageEmoji,
    required this.imageColors,
    this.imageUrl,
    this.searchKeyword,
    this.source = 'local',
    this.keywords = const [],
  });

  final String basedOn;
  final String title;
  final int minutes;
  final String difficulty;
  final List<String> ingredients;
  final List<String> steps;
  final String imageEmoji;
  final List<Color> imageColors;
  final String? imageUrl;
  final String? searchKeyword;
  final String source;
  final List<String> keywords;

  static const _speciesAliases = <String, List<String>>{
    'salmon': ['salmon'],
    'tuna': ['tuna'],
    'prawn': ['prawn', 'shrimp', 'udang'],
    'shrimp': ['prawn', 'shrimp', 'udang'],
    'udang': ['prawn', 'shrimp', 'udang'],
    'crab': ['crab', 'ketam'],
    'ketam': ['crab', 'ketam'],
    'squid': ['squid', 'sotong'],
    'sotong': ['squid', 'sotong'],
    'fish': ['fish', 'ikan', 'cod', 'bass', 'snapper', 'tilapia', 'mackerel'],
    'ikan': ['fish', 'ikan'],
    'clam': ['clam', 'lala'],
    'mussel': ['mussel', 'shellfish'],
    'lobster': ['lobster'],
  };

  static List<String> _termsForSpecies(String species) {
    final lower = species.toLowerCase().trim();
    if (lower.isEmpty) return const [];
    final terms = <String>{lower};
    for (final entry in _speciesAliases.entries) {
      if (entry.key == lower ||
          entry.value.any((alias) => lower.contains(alias))) {
        terms.add(entry.key);
        terms.addAll(entry.value);
      }
    }
    for (final word in lower.split(RegExp(r'[^a-z0-9]+'))) {
      if (word.length >= 3) terms.add(word);
    }
    return terms.toList();
  }

  bool _matchesSpeciesName(String species) {
    final name = species.toLowerCase().trim();
    if (name.isEmpty) return false;
    final based = basedOn.toLowerCase();
    if (based.isNotEmpty && (based.contains(name) || name.contains(based))) {
      return true;
    }
    final search = searchKeyword?.toLowerCase() ?? '';
    if (search.isNotEmpty && (name.contains(search) || search.contains(name))) {
      return true;
    }

    final freezerTerms = _termsForSpecies(name);
    final recipeTerms = <String>{
      ...keywords.map((k) => k.toLowerCase()),
      ..._termsForSpecies(basedOn),
      if (search.isNotEmpty) search,
    };

    for (final ft in freezerTerms) {
      for (final rt in recipeTerms) {
        if (ft == rt || ft.contains(rt) || rt.contains(ft)) return true;
      }
    }

    for (final line in ingredients) {
      final lower = line.toLowerCase();
      for (final ft in freezerTerms) {
        if (lower.contains(ft)) return true;
      }
    }
    return false;
  }

  bool matchesAnyFreezerItem(List<FreezerItem> items) {
    if (items.isEmpty) return false;
    return items.any((item) => _matchesSpeciesName(item.species));
  }

  /// When [filterSpecies] is null, caller should use [matchesAnyFreezerItem].
  bool matchesIngredientFilter(String? filterSpecies) {
    if (filterSpecies == null || filterSpecies.trim().isEmpty) return true;
    return _matchesSpeciesName(filterSpecies);
  }

  bool ingredientFromFreezer(String line) {
    final lower = line.toLowerCase();
    final species = basedOn.toLowerCase();
    if (species.isNotEmpty && lower.contains(species)) return true;
    final keyword = searchKeyword?.toLowerCase();
    if (keyword != null && keyword.isNotEmpty && lower.contains(keyword)) {
      return true;
    }
    return false;
  }
}

class RecipeSuggestResult {
  const RecipeSuggestResult({
    required this.recipes,
    required this.usedApi,
    this.message,
    this.source = 'local',
  });

  final List<RecipeSuggestion> recipes;
  final bool usedApi;
  final String? message;
  final String source;
}

class RecipeSuggestionService {
  Future<RecipeSuggestResult> suggestRecipes(
    List<FreezerItem> freezerItems,
  ) async {
    if (freezerItems.isEmpty) {
      return const RecipeSuggestResult(recipes: [], usedApi: false);
    }

    try {
      final endpoint = await ApiConfig.recipesSuggestUrl();
      final response = await http
          .post(
            Uri.parse(endpoint),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'items': freezerItems
                  .map(
                    (item) => {
                      'species': item.species,
                      'stockKg': item.stockKg,
                      'daysRemaining': item.daysRemaining,
                    },
                  )
                  .toList(),
            }),
          )
          .timeout(const Duration(seconds: 55));

      if (response.statusCode >= 200 && response.statusCode < 300) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        final recipes = data['recipes'] as List<dynamic>? ?? [];
        final apiSource = data['source'] as String? ?? 'local';
        final parsed = recipes.map((recipe) {
          final map = recipe as Map<String, dynamic>;
          final basedOn = map['basedOn'] ?? freezerItems.first.species;
          final imageTag = map['imageTag'] as String? ?? '';
          final visuals = _recipeVisuals(basedOn, imageTag: imageTag);
          final keywords = (map['keywords'] as List<dynamic>? ?? [])
              .map((k) => '$k'.toLowerCase())
              .where((k) => k.isNotEmpty)
              .toList();
          return RecipeSuggestion(
            basedOn: basedOn,
            title: map['title'] ?? 'Seafood Meal Idea',
            minutes: (map['minutes'] as num?)?.toInt() ?? 20,
            difficulty: map['difficulty'] ?? 'Easy',
            ingredients: (map['ingredients'] as List<dynamic>? ?? [])
                .map((item) => '$item')
                .where((item) => item.trim().isNotEmpty)
                .toList(),
            steps: (map['steps'] as List<dynamic>? ?? [])
                .map((step) => '$step')
                .toList(),
            imageEmoji: visuals.$1,
            imageColors: visuals.$2,
            imageUrl: map['imageUrl'] as String?,
            searchKeyword: map['searchKeyword'] as String?,
            source: map['source'] as String? ?? apiSource,
            keywords: keywords,
          );
        }).toList();
        if (parsed.isNotEmpty) {
          return RecipeSuggestResult(
            recipes: parsed,
            usedApi: true,
            source: apiSource,
          );
        }
      }
    } catch (_) {
      // Fall back to local suggestions when the backend is not reachable.
    }

    final fallback = freezerItems.take(3).map((item) {
      final urgent = item.daysRemaining <= 3 ? 'Use-Soon' : 'Fresh';
      final visuals = _recipeVisuals(item.species);
      return RecipeSuggestion(
        basedOn: item.species,
        title: '$urgent ${item.species} with Garlic Ginger Sauce',
        minutes: item.daysRemaining <= 3 ? 15 : 25,
        difficulty: 'Easy',
        ingredients: [
          item.species,
          'Garlic (minced)',
          'Fresh ginger',
          'Light soy sauce',
          'Cooking oil',
          'Salt & white pepper',
        ],
        steps: [
          'Pat ${item.species} dry and season lightly.',
          'Cook with garlic, ginger, soy sauce, and a small amount of oil.',
          'Serve hot with rice or vegetables.',
        ],
        imageEmoji: visuals.$1,
        imageColors: visuals.$2,
      );
    }).toList();
    return RecipeSuggestResult(
      recipes: fallback,
      usedApi: false,
      message: 'Showing basic ideas — connect to the internet and refresh for the full recipe list.',
    );
  }

  (String, List<Color>) _recipeVisuals(String species, {String imageTag = ''}) {
    final tag = imageTag.toLowerCase();
    if (tag == 'prawn') {
      return ('🦐', [const Color(0xFFFFB347), const Color(0xFF8B3A00)]);
    }
    if (tag == 'crab') {
      return ('🦀', [const Color(0xFFFF6B6B), const Color(0xFF7F1D1D)]);
    }
    if (tag == 'squid') {
      return ('🦑', [const Color(0xFF9AD5CA), const Color(0xFF1F4E5F)]);
    }
    if (tag == 'shellfish') {
      return ('🐚', [const Color(0xFFE8D5B7), const Color(0xFF4A6741)]);
    }

    final name = species.toLowerCase();
    if (name.contains('prawn') || name.contains('shrimp') || name.contains('udang')) {
      return ('🦐', [const Color(0xFFFFB347), const Color(0xFF8B3A00)]);
    }
    if (name.contains('crab') || name.contains('ketam')) {
      return ('🦀', [const Color(0xFFFF6B6B), const Color(0xFF7F1D1D)]);
    }
    if (name.contains('squid') || name.contains('sotong')) {
      return ('🦑', [const Color(0xFF9AD5CA), const Color(0xFF1F4E5F)]);
    }
    if (name.contains('clam') || name.contains('mussel')) {
      return ('🐚', [const Color(0xFFE8D5B7), const Color(0xFF4A6741)]);
    }
    return ('🐟', [const Color(0xFF7DD3FC), const Color(0xFF0F4C5C)]);
  }
}
