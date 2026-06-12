import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'app_contact.dart';
import 'app_widgets.dart';
import 'theme/app_colors.dart';
import 'store_settings.dart';
import 'consumer_settings.dart';
import 'models/freezer_item.dart';
import 'notification_service.dart';

/// Settings hub — tap a card to open that section only.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({
    super.key,
    required this.user,
    required this.freezerItems,
    required this.onLogout,
    required this.onSettingsSaved,
  });

  final User user;
  final List<FreezerItem> freezerItems;
  final VoidCallback onLogout;
  final ValueChanged<ConsumerSettings> onSettingsSaved;

  @override
  Widget build(BuildContext context) {
    return ScreenScaffold(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const PageHeading(
            title: 'Settings',
            subtitle: 'Choose a section to view or change',
          ),
          const SizedBox(height: 16),
          SettingsMenuCard(
            icon: Icons.person_outline,
            title: 'Profile',
            subtitle: 'Name, phone, and account details',
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => ProfileSettingsPage(
                  user: user,
                  onSettingsSaved: onSettingsSaved,
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          SettingsMenuCard(
            icon: Icons.notifications_outlined,
            title: 'Notifications',
            subtitle: 'Expiry alerts and recipe tips',
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => NotificationSettingsPage(
                  freezerItems: freezerItems,
                  onSettingsSaved: onSettingsSaved,
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          SettingsMenuCard(
            icon: Icons.support_agent_outlined,
            title: 'Contact Us',
            subtitle: 'Chat with us on WhatsApp',
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ContactUsPage()),
            ),
          ),
          const SizedBox(height: 10),
          SettingsMenuCard(
            icon: Icons.logout,
            title: 'Log Out',
            subtitle: 'Sign out of this device',
            onTap: () {
              showDialog<void>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: const Text('Log out?'),
                  content: const Text('You will need to sign in again to use the app.'),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Cancel'),
                    ),
                    FilledButton(
                      onPressed: () {
                        Navigator.pop(ctx);
                        onLogout();
                      },
                      child: const Text('Log Out'),
                    ),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

class ContactUsPage extends StatelessWidget {
  const ContactUsPage({super.key});

  Future<void> _openWhatsApp(BuildContext context, String storePhone) async {
    final opened = await AppContact.openAdminWhatsApp(storePhone: storePhone);
    if (!context.mounted) return;
    if (!opened) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Could not open WhatsApp. Install WhatsApp or try again.',
          ),
        ),
      );
    }
  }

  Widget _detailRow(IconData icon, String label, String value) {
    if (value.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: AppColors.teal),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.muted,
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.6,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.page,
      appBar: AppBar(
        backgroundColor: AppColors.navy,
        foregroundColor: Colors.white,
        title: const Text('Contact Us'),
      ),
      body: StreamBuilder<StoreSettings>(
        stream: StoreSettings.watchMain(),
        builder: (context, snapshot) {
          final store = snapshot.data ?? const StoreSettings();
          final phone = store.phone.isNotEmpty
              ? store.phone
              : AppContact.fallbackWhatsAppDisplay;
          final phoneForWa = store.phone.isNotEmpty
              ? store.phone
              : AppContact.fallbackWhatsAppDigits;

          return ListView(
            padding: const EdgeInsets.all(18),
            children: [
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      store.storeName,
                      style: const TextStyle(
                        color: AppColors.ink,
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Store details from admin settings — updates automatically.',
                      style: TextStyle(color: AppColors.muted, height: 1.45),
                    ),
                    const SizedBox(height: 16),
                    _detailRow(Icons.location_on_outlined, 'ADDRESS', store.address),
                    _detailRow(Icons.schedule, 'HOURS', store.hoursLabel),
                    _detailRow(Icons.phone_outlined, 'PHONE / WHATSAPP', phone),
                    _detailRow(Icons.email_outlined, 'EMAIL', store.email),
                    if (store.contactNote.isNotEmpty)
                      _detailRow(Icons.info_outline, 'NOTE', store.contactNote),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        color: const Color(0xFF25D366).withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: const Icon(
                        Icons.chat_rounded,
                        color: Color(0xFF25D366),
                        size: 30,
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'Chat with us',
                      style: TextStyle(
                        color: AppColors.ink,
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'WhatsApp the store for account help, orders, or support.',
                      style: TextStyle(color: AppColors.muted, height: 1.45),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF25D366),
                  foregroundColor: Colors.white,
                  minimumSize: const Size.fromHeight(52),
                ),
                onPressed: () => _openWhatsApp(context, phoneForWa),
                icon: const Icon(Icons.open_in_new),
                label: const Text('Open WhatsApp'),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: () => _openWhatsApp(context, phoneForWa),
                icon: const Icon(Icons.message_outlined),
                label: const Text('Send default message'),
              ),
            ],
          );
        },
      ),
    );
  }
}

class ProfileSettingsPage extends StatefulWidget {
  const ProfileSettingsPage({
    super.key,
    required this.user,
    required this.onSettingsSaved,
  });

  final User user;
  final ValueChanged<ConsumerSettings> onSettingsSaved;

  @override
  State<ProfileSettingsPage> createState() => _ProfileSettingsPageState();
}

class _ProfileSettingsPageState extends State<ProfileSettingsPage> {
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final snap = await FirebaseFirestore.instance
          .collection('customers')
          .doc(widget.user.uid)
          .get();
      final settings = ConsumerSettings.fromMap(snap.data());
      if (!mounted) return;
      setState(() {
        _nameController.text = settings.displayName.isNotEmpty
            ? settings.displayName
            : (widget.user.displayName ?? '');
        _phoneController.text = settings.phone;
        _emailController.text = settings.email.isNotEmpty
            ? settings.email
            : (widget.user.email ?? '');
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter your full name.')),
      );
      return;
    }

    setState(() => _saving = true);
    try {
      final snap = await FirebaseFirestore.instance
          .collection('customers')
          .doc(widget.user.uid)
          .get();
      final current = ConsumerSettings.fromMap(snap.data());
      final updated = current.copyWith(
        displayName: name,
        phone: _phoneController.text.trim(),
        email: _emailController.text.trim(),
      );

      await FirebaseFirestore.instance
          .collection('customers')
          .doc(widget.user.uid)
          .set(
            updated.toFirestoreMap(uid: widget.user.uid),
            SetOptions(merge: true),
          );

      await widget.user.updateDisplayName(name);
      widget.onSettingsSaved(updated);

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Profile saved. Admin User Management updates automatically.'),
        ),
      );
      Navigator.pop(context);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not save profile: $error')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.page,
      appBar: AppBar(
        backgroundColor: AppColors.navy,
        foregroundColor: Colors.white,
        title: const Text('Profile'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(18),
              children: [
                AppCard(
                  child: Column(
                    children: [
                      FormFieldBox(
                        label: 'FULL NAME',
                        controller: _nameController,
                      ),
                      FormFieldBox(
                        label: 'PHONE NUMBER',
                        controller: _phoneController,
                      ),
                      FormFieldBox(
                        label: 'EMAIL (READ ONLY)',
                        controller: _emailController,
                        readOnly: true,
                      ),
                      const Text(
                        'Your full name appears after “Hi,” on the home screen.',
                        style: TextStyle(color: AppColors.muted, fontSize: 11),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.teal,
                    minimumSize: const Size.fromHeight(50),
                  ),
                  onPressed: _saving ? null : _save,
                  icon: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.save_outlined),
                  label: Text(_saving ? 'Saving...' : 'Save Profile'),
                ),
              ],
            ),
    );
  }
}

class NotificationSettingsPage extends StatefulWidget {
  const NotificationSettingsPage({
    super.key,
    required this.freezerItems,
    required this.onSettingsSaved,
  });

  final List<FreezerItem> freezerItems;
  final ValueChanged<ConsumerSettings> onSettingsSaved;

  @override
  State<NotificationSettingsPage> createState() => _NotificationSettingsPageState();
}

class _NotificationSettingsPageState extends State<NotificationSettingsPage> {
  bool _loading = true;
  bool _saving = false;
  bool _notificationsEnabled = true;
  bool _expiryRemindersEnabled = true;
  bool _recipeTipsEnabled = true;
  int _expiryReminderDays = 3;
  String _userId = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;
    _userId = user.uid;
    final snap = await FirebaseFirestore.instance
        .collection('customers')
        .doc(user.uid)
        .get();
    final settings = ConsumerSettings.fromMap(snap.data());
    if (!mounted) return;
    setState(() {
      _notificationsEnabled = settings.notificationsEnabled;
      _expiryRemindersEnabled = settings.expiryRemindersEnabled;
      _recipeTipsEnabled = settings.recipeTipsEnabled;
      _expiryReminderDays = settings.expiryReminderDays;
      _loading = false;
    });
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final snap = await FirebaseFirestore.instance
          .collection('customers')
          .doc(_userId)
          .get();
      final current = ConsumerSettings.fromMap(snap.data());
      final updated = current.copyWith(
        notificationsEnabled: _notificationsEnabled,
        expiryRemindersEnabled: _expiryRemindersEnabled,
        expiryReminderDays: _expiryReminderDays,
        recipeTipsEnabled: _recipeTipsEnabled,
      );

      await FirebaseFirestore.instance
          .collection('customers')
          .doc(_userId)
          .set(updated.toFirestoreMap(uid: _userId), SetOptions(merge: true));

      await NotificationService.instance.syncFreezerReminders(
        settings: updated,
        items: widget.freezerItems,
      );

      widget.onSettingsSaved(updated);

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Notification settings saved')),
      );
      Navigator.pop(context);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not save: $error')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.page,
      appBar: AppBar(
        backgroundColor: AppColors.navy,
        foregroundColor: Colors.white,
        title: const Text('Notifications'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(18),
              children: [
                AppCard(
                  child: Column(
                    children: [
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text(
                          'Enable notifications',
                          style: TextStyle(fontWeight: FontWeight.w800),
                        ),
                        value: _notificationsEnabled,
                        activeThumbColor: AppColors.teal,
                        onChanged: (v) => setState(() => _notificationsEnabled = v),
                      ),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text(
                          'Expiry reminders',
                          style: TextStyle(fontWeight: FontWeight.w800),
                        ),
                        value: _expiryRemindersEnabled,
                        activeThumbColor: AppColors.teal,
                        onChanged: _notificationsEnabled
                            ? (v) => setState(() => _expiryRemindersEnabled = v)
                            : null,
                      ),
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text(
                          'Remind me when',
                          style: TextStyle(fontWeight: FontWeight.w800),
                        ),
                        subtitle: Text('$_expiryReminderDays day(s) or less'),
                        trailing: DropdownButton<int>(
                          value: _expiryReminderDays,
                          items: const [
                            DropdownMenuItem(value: 1, child: Text('1 day')),
                            DropdownMenuItem(value: 3, child: Text('3 days')),
                            DropdownMenuItem(value: 7, child: Text('7 days')),
                          ],
                          onChanged: _notificationsEnabled && _expiryRemindersEnabled
                              ? (v) {
                                  if (v != null) {
                                    setState(() => _expiryReminderDays = v);
                                  }
                                }
                              : null,
                        ),
                      ),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text(
                          'Recipe tips',
                          style: TextStyle(fontWeight: FontWeight.w800),
                        ),
                        value: _recipeTipsEnabled,
                        activeThumbColor: AppColors.teal,
                        onChanged: _notificationsEnabled
                            ? (v) => setState(() => _recipeTipsEnabled = v)
                            : null,
                      ),
                      OutlinedButton.icon(
                        onPressed: () async {
                          if (!_notificationsEnabled) return;
                          await NotificationService.instance.showRecipeTip(
                            'Boon Hua Fishery',
                            'Notifications are working.',
                          );
                        },
                        icon: const Icon(Icons.notifications_active_outlined),
                        label: const Text('Send test notification'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.teal,
                    minimumSize: const Size.fromHeight(50),
                  ),
                  onPressed: _saving ? null : _save,
                  child: Text(_saving ? 'Saving...' : 'Save Notifications'),
                ),
              ],
            ),
    );
  }
}
