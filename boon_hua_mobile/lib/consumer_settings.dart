class ConsumerSettings {
  const ConsumerSettings({
    this.notificationsEnabled = true,
    this.expiryRemindersEnabled = true,
    this.expiryReminderDays = 3,
    this.recipeTipsEnabled = true,
    this.displayName = '',
    this.phone = '',
    this.email = '',
    this.apiBaseUrl = '',
  });

  final bool notificationsEnabled;
  final bool expiryRemindersEnabled;
  final int expiryReminderDays;
  final bool recipeTipsEnabled;
  final String displayName;
  final String phone;
  final String email;
  final String apiBaseUrl;

  String get resolvedName => displayName.trim();

  ConsumerSettings copyWith({
    bool? notificationsEnabled,
    bool? expiryRemindersEnabled,
    int? expiryReminderDays,
    bool? recipeTipsEnabled,
    String? displayName,
    String? phone,
    String? email,
    String? apiBaseUrl,
  }) {
    return ConsumerSettings(
      notificationsEnabled: notificationsEnabled ?? this.notificationsEnabled,
      expiryRemindersEnabled:
          expiryRemindersEnabled ?? this.expiryRemindersEnabled,
      expiryReminderDays: expiryReminderDays ?? this.expiryReminderDays,
      recipeTipsEnabled: recipeTipsEnabled ?? this.recipeTipsEnabled,
      displayName: displayName ?? this.displayName,
      phone: phone ?? this.phone,
      email: email ?? this.email,
      apiBaseUrl: apiBaseUrl ?? this.apiBaseUrl,
    );
  }

  factory ConsumerSettings.fromMap(Map<String, dynamic>? data) {
    if (data == null) return const ConsumerSettings();
    final name = (data['displayName'] as String? ?? '').trim().isNotEmpty
        ? (data['displayName'] as String).trim()
        : (data['name'] as String? ?? '').trim();
    return ConsumerSettings(
      notificationsEnabled: data['notificationsEnabled'] as bool? ?? true,
      expiryRemindersEnabled: data['expiryRemindersEnabled'] as bool? ?? true,
      expiryReminderDays: (data['expiryReminderDays'] as num?)?.toInt() ?? 3,
      recipeTipsEnabled: data['recipeTipsEnabled'] as bool? ?? true,
      displayName: name,
      phone: data['phone'] as String? ?? data['phoneNum'] as String? ?? '',
      email: data['email'] as String? ?? '',
      apiBaseUrl: data['apiBaseUrl'] as String? ?? '',
    );
  }

  /// Writes all fields needed for admin User Management and mobile profile.
  Map<String, dynamic> toFirestoreMap({required String uid}) {
    final name = resolvedName;
    return {
      'uid': uid,
      'name': name,
      'displayName': name,
      'email': email.trim(),
      'phone': phone.trim(),
      'phoneNum': phone.trim(),
      'role': 'Consumer',
      'notificationsEnabled': notificationsEnabled,
      'expiryRemindersEnabled': expiryRemindersEnabled,
      'expiryReminderDays': expiryReminderDays,
      'recipeTipsEnabled': recipeTipsEnabled,
      'apiBaseUrl': apiBaseUrl,
      'updatedAt': DateTime.now().toIso8601String(),
    };
  }
}
