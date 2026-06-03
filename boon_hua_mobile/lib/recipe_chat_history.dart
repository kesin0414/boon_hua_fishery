import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';

/// Persists AI chef chat under `users/{userId}/recipeAiChat`.
class RecipeChatHistoryStore {
  RecipeChatHistoryStore(this.userId);

  final String userId;

  CollectionReference<Map<String, dynamic>> get _collection {
    return FirebaseFirestore.instance
        .collection('users')
        .doc(userId)
        .collection('recipeAiChat');
  }

  Future<List<PersistedChatMessage>> load({int limit = 80}) async {
    final snap = await _collection
        .orderBy('createdAt', descending: false)
        .limit(limit)
        .get();

    return snap.docs.map((doc) {
      final data = doc.data();
      final recipesRaw = data['recipes'];
      List<Map<String, dynamic>> recipes = [];
      if (recipesRaw is List) {
        recipes = recipesRaw
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      } else if (recipesRaw is String && recipesRaw.isNotEmpty) {
        try {
          final decoded = jsonDecode(recipesRaw);
          if (decoded is List) {
            recipes = decoded
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList();
          }
        } catch (_) {}
      }

      return PersistedChatMessage(
        id: doc.id,
        role: data['role'] as String? ?? 'assistant',
        text: data['content'] as String? ?? '',
        recipes: recipes,
        isError: data['isError'] == true,
        createdAt: (data['createdAt'] as Timestamp?)?.toDate(),
      );
    }).toList();
  }

  Future<void> saveMessage({
    required String role,
    required String content,
    List<Map<String, dynamic>> recipes = const [],
    bool isError = false,
  }) async {
    await _collection.add({
      'role': role,
      'content': content,
      'recipes': recipes,
      'isError': isError,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> clearAll() async {
    const batchSize = 100;
    while (true) {
      final snap = await _collection.limit(batchSize).get();
      if (snap.docs.isEmpty) return;
      final batch = FirebaseFirestore.instance.batch();
      for (final doc in snap.docs) {
        batch.delete(doc.reference);
      }
      await batch.commit();
      if (snap.docs.length < batchSize) return;
    }
  }
}

class PersistedChatMessage {
  const PersistedChatMessage({
    required this.id,
    required this.role,
    required this.text,
    this.recipes = const [],
    this.isError = false,
    this.createdAt,
  });

  final String id;
  final String role;
  final String text;
  final List<Map<String, dynamic>> recipes;
  final bool isError;
  final DateTime? createdAt;
}
