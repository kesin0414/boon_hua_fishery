import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Recipe API URL is set once by admin in the web portal (Firestore app_config/public).
/// Consumers never configure this in the mobile app.
class ApiConfig {
  static const _remotePrefsKey = 'boonhua_remote_api_base_url';
  static const _remoteConfigDoc = 'app_config/public';

  static const productionDefault = String.fromEnvironment('BOONHUA_API_URL');

  static String? _cachedRemote;

  static Future<String> recipesSuggestUrl() async {
    final base = await baseUrl();
    return '$base/recipes/suggest';
  }

  /// Loads the shared API URL from Firestore and caches it on the device.
  static Future<String?> syncRemoteConfig() async {
    try {
      final snap = await FirebaseFirestore.instance.doc(_remoteConfigDoc).get();
      final url = (snap.data()?['recipeApiBaseUrl'] as String?)?.trim();
      if (url == null || url.isEmpty) return null;
      final normalized = _normalize(url);
      _cachedRemote = normalized;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_remotePrefsKey, normalized);
      return normalized;
    } catch (_) {
      return null;
    }
  }

  static Future<String> baseUrl() async {
    const fromEnv = String.fromEnvironment('API_BASE_URL');
    if (fromEnv.isNotEmpty) return _normalize(fromEnv);

    if (productionDefault.isNotEmpty) return _normalize(productionDefault);

    final remote = _cachedRemote ?? await _loadCachedRemote();
    if (remote != null && remote.isNotEmpty) return _normalize(remote);

    final synced = await syncRemoteConfig();
    if (synced != null && synced.isNotEmpty) return synced;

    if (kDebugMode) {
      if (kIsWeb) return 'http://127.0.0.1:8000';
      if (!kIsWeb && Platform.isAndroid) return 'http://10.0.2.2:8000';
      return 'http://127.0.0.1:8000';
    }

    return 'https://boonhua-api.onrender.com';
  }

  static Future<String?> _loadCachedRemote() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_remotePrefsKey)?.trim();
  }

  static Future<String> resolvedSourceLabel() async {
    const fromEnv = String.fromEnvironment('API_BASE_URL');
    if (fromEnv.isNotEmpty) return 'build config';
    if (productionDefault.isNotEmpty) return 'app default';

    final remote = _cachedRemote ?? await _loadCachedRemote();
    if (remote != null && remote.isNotEmpty) {
      return 'cloud';
    }
    if (kDebugMode) return 'developer machine';
    return 'not configured';
  }

  static String _normalize(String url) =>
      url.trim().replaceAll(RegExp(r'/+$'), '');
}
