import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

import 'consumer_settings.dart';
import 'receipt_scanner.dart';

class NotificationService {
  NotificationService._();
  static final NotificationService instance = NotificationService._();

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized) return;

    tz_data.initializeTimeZones();
    tz.setLocalLocation(tz.getLocation('Asia/Kuala_Lumpur'));

    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const ios = DarwinInitializationSettings();
    await _plugin.initialize(
      const InitializationSettings(android: android, iOS: ios),
    );

    final androidPlugin = _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >();
    await androidPlugin?.createNotificationChannel(
      const AndroidNotificationChannel(
        'boonhua_expiry',
        'Seafood expiry alerts',
        description: 'Reminders when items in your virtual freezer are expiring',
        importance: Importance.high,
      ),
    );

    _initialized = true;
  }

  Future<bool> requestPermission() async {
    final status = await Permission.notification.request();
    return status.isGranted;
  }

  Future<void> syncFreezerReminders({
    required ConsumerSettings settings,
    required List<FreezerItem> items,
  }) async {
    await initialize();
    await _plugin.cancelAll();

    if (!settings.notificationsEnabled || !settings.expiryRemindersEnabled) {
      return;
    }

    final granted = await requestPermission();
    if (!granted) return;

    final threshold = settings.expiryReminderDays;
    final now = tz.TZDateTime.now(tz.local);

    for (final item in items) {
      final daysLeft = item.daysRemaining;
      if (daysLeft < 0 || daysLeft > threshold) continue;

      final notifyAt = tz.TZDateTime(
        tz.local,
        item.bestBeforeDate.year,
        item.bestBeforeDate.month,
        item.bestBeforeDate.day,
        9,
      ).subtract(const Duration(days: 1));

      final scheduled = notifyAt.isAfter(now) ? notifyAt : now.add(const Duration(seconds: 5));
      final id = item.id?.hashCode ?? item.species.hashCode;

      await _plugin.zonedSchedule(
        id,
        'Eat soon: ${item.species}',
        daysLeft <= 0
            ? '${item.species} may be expiring today. Check your virtual freezer.'
            : '${item.species} has about $daysLeft day(s) left (${item.stockKg.toStringAsFixed(1)} kg in stock).',
        scheduled,
        const NotificationDetails(
          android: AndroidNotificationDetails(
            'boonhua_expiry',
            'Seafood expiry alerts',
            importance: Importance.high,
            priority: Priority.high,
          ),
          iOS: DarwinNotificationDetails(),
        ),
        androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      );
    }
  }

  Future<void> showRecipeTip(String title, String body) async {
    await initialize();
    if (!await requestPermission()) return;

    await _plugin.show(
      DateTime.now().millisecondsSinceEpoch ~/ 1000,
      title,
      body,
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'boonhua_expiry',
          'Seafood expiry alerts',
          importance: Importance.defaultImportance,
          priority: Priority.defaultPriority,
        ),
        iOS: DarwinNotificationDetails(),
      ),
    );
  }
}
