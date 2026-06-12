import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';

import 'api_config.dart';
import 'consumer_settings.dart';
import 'data/firebase_repository.dart';
import 'firebase_options.dart';
import 'models/freezer_item.dart';
import 'models/price_history_entry.dart';
import 'notification_service.dart';
import 'receipt_scanner.dart';
import 'app_branding.dart';
import 'recipe_ai_chef_screen.dart';
import 'recipe_ai_service.dart';
import 'services/price_sync_service.dart';
import 'services/recipe_suggestion_service.dart';
import 'settings_screen.dart';
import 'splash_screen.dart';
import 'theme/app_colors.dart';
import 'weight_units.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: AppColors.navy,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Colors.white,
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );
  runApp(const BoonHuaApp());
}

class BoonHuaApp extends StatelessWidget {
  const BoonHuaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Boon Hua Fishery',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: AppColors.teal,
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: AppColors.page,
        fontFamily: 'Roboto',
        useMaterial3: true,
      ),
      home: const AppSplashScreen(child: MobileAuthGate()),
    );
  }
}

class MobileAuthGate extends StatefulWidget {
  const MobileAuthGate({super.key});

  @override
  State<MobileAuthGate> createState() => _MobileAuthGateState();
}

class _MobileAuthGateState extends State<MobileAuthGate> {
  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            backgroundColor: AppColors.navyDark,
            body: Center(
              child: CircularProgressIndicator(color: AppColors.teal),
            ),
          );
        }

        final user = snapshot.data;
        if (user == null) {
          return const AuthScreen();
        }

        return ConsumerShell(
          user: user,
          onLogout: () => FirebaseAuth.instance.signOut(),
        );
      },
    );
  }
}

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _isRegister = false;
  bool _isLoading = false;
  bool _acceptedTerms = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _emailController.text.trim();
    final password = _passwordController.text;

    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)) {
      setState(() => _error = 'Please enter a valid email address.');
      return;
    }
    if (!RegExp(r'^(?=.*[A-Za-z])(?=.*\d).{8,}$').hasMatch(password)) {
      setState(
        () => _error =
            'Password must be at least 8 characters and include letters and numbers.',
      );
      return;
    }
    if (_isRegister && _nameController.text.trim().isEmpty) {
      setState(() => _error = 'Please enter your full name.');
      return;
    }
    if (_isRegister && _phoneController.text.trim().isEmpty) {
      setState(() => _error = 'Please enter your phone number.');
      return;
    }
    if (_isRegister && password != _confirmPasswordController.text) {
      setState(() => _error = 'Confirm password does not match.');
      return;
    }
    if (_isRegister && !_acceptedTerms) {
      setState(
        () => _error = 'Please agree to the terms before creating an account.',
      );
      return;
    }

    setState(() {
      _error = null;
      _isLoading = true;
    });

    try {
      if (_isRegister) {
        final credential = await FirebaseAuth.instance
            .createUserWithEmailAndPassword(email: email, password: password);
        await credential.user?.updateDisplayName(_nameController.text.trim());
        final fullName = _nameController.text.trim();
        await FirebaseFirestore.instance
            .collection('customers')
            .doc(credential.user!.uid)
            .set({
              'uid': credential.user!.uid,
              'name': fullName,
              'displayName': fullName,
              'email': email,
              'phone': _phoneController.text.trim(),
              'phoneNum': _phoneController.text.trim(),
              'role': 'Consumer',
              'status': 'Active',
              'createdAt': FieldValue.serverTimestamp(),
              'updatedAt': FieldValue.serverTimestamp(),
            }, SetOptions(merge: true));
      } else {
        await FirebaseAuth.instance.signInWithEmailAndPassword(
          email: email,
          password: password,
        );
      }
    } on FirebaseAuthException catch (error) {
      setState(() => _error = error.message ?? 'Authentication failed.');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.page,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(22),
            child: AppCard(
              padding: const EdgeInsets.all(22),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Center(child: AppLogo(size: 88, borderRadius: 22)),
                  const SizedBox(height: 14),
                  const Text(
                    'Boon Hua Fishery',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: AppColors.ink,
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const Text(
                    'Track seafood at home — expiry alerts, prices & meal ideas',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: AppColors.muted,
                      fontSize: 12,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _isRegister ? 'Create Account' : 'Login',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: AppColors.muted,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 22),
                  if (_isRegister)
                    Column(
                      children: [
                        FormFieldBox(
                          label: 'FULL NAME',
                          hint: 'e.g. Tan Mei Ling',
                          controller: _nameController,
                        ),
                        FormFieldBox(
                          label: 'PHONE NUMBER',
                          hint: 'e.g. 0123456789',
                          controller: _phoneController,
                        ),
                      ],
                    ),
                  FormFieldBox(
                    label: 'EMAIL ADDRESS',
                    hint: 'consumer@boonhua.com',
                    controller: _emailController,
                  ),
                  FormFieldBox(
                    label: 'PASSWORD',
                    hint: 'At least 8 characters with letters and numbers',
                    controller: _passwordController,
                    obscureText: true,
                  ),
                  if (_isRegister)
                    FormFieldBox(
                      label: 'CONFIRM PASSWORD',
                      hint: 'Re-enter password',
                      controller: _confirmPasswordController,
                      obscureText: true,
                    ),
                  if (_isRegister)
                    CheckboxListTile(
                      value: _acceptedTerms,
                      onChanged: (value) =>
                          setState(() => _acceptedTerms = value ?? false),
                      controlAffinity: ListTileControlAffinity.leading,
                      contentPadding: EdgeInsets.zero,
                      title: const Text(
                        'I agree to the terms and privacy policy',
                        style: TextStyle(color: AppColors.muted, fontSize: 13),
                      ),
                    ),
                  if (_error != null) ...[
                    Text(
                      _error!,
                      style: const TextStyle(
                        color: AppColors.danger,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  SizedBox(
                    height: 52,
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.navy,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                      ),
                      onPressed: _isLoading ? null : _submit,
                      child: Text(
                        _isLoading
                            ? (_isRegister ? 'Creating...' : 'Logging in...')
                            : _isRegister
                            ? 'Create Account'
                            : 'Login',
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextButton(
                    onPressed: () {
                      setState(() {
                        _isRegister = !_isRegister;
                        _error = null;
                      });
                    },
                    child: Text(
                      _isRegister
                          ? 'Already have an account? Log in'
                          : 'New user? Create account',
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class ConsumerShell extends StatefulWidget {
  const ConsumerShell({super.key, required this.user, required this.onLogout});

  final User user;
  final VoidCallback onLogout;

  @override
  State<ConsumerShell> createState() => _ConsumerShellState();
}

class _ConsumerShellState extends State<ConsumerShell> {
  final ReceiptScanner _scanner = ReceiptScanner();
  final FreezerService _freezerService = FreezerService();
  static const _priceSync = PriceSyncService();
  late final FirebaseRepository _repository;
  StreamSubscription<List<FreezerItem>>? _freezerSubscription;
  StreamSubscription<List<PriceHistoryEntry>>? _historySubscription;
  StreamSubscription<List<FreezerHistoryEntry>>? _freezerHistorySubscription;
  List<FreezerItem> _freezerItems = [];
  List<PriceHistoryEntry> _priceHistory = [];
  List<FreezerHistoryEntry> _freezerHistory = [];

  List<FreezerItem> get _activeFreezerItems =>
      _freezerItems.where((item) => item.isActive).toList();
  ConsumerSettings _settings = const ConsumerSettings();

  int _selectedIndex = 0;
  ParsedReceipt? _latestReceipt;
  bool _isScanning = false;

  @override
  void initState() {
    super.initState();
    _repository = FirebaseRepository(widget.user.uid);
    _freezerSubscription = _repository.watchFreezerItems().listen((items) {
      if (!mounted) return;
      setState(() => _freezerItems = items);
      _syncNotifications();
    });
    _historySubscription = _repository.watchPriceHistory().listen((entries) {
      if (mounted) setState(() => _priceHistory = entries);
    });
    _freezerHistorySubscription = _repository.watchFreezerHistory().listen(
      (entries) {
        if (mounted) setState(() => _freezerHistory = entries);
      },
    );
    _loadSettingsAndNotifications();
  }

  Future<void> _loadSettingsAndNotifications() async {
    await NotificationService.instance.initialize();
    await ApiConfig.syncRemoteConfig();
    try {
      final snap = await FirebaseFirestore.instance
          .collection('customers')
          .doc(widget.user.uid)
          .get();
      final settings = ConsumerSettings.fromMap(snap.data());
      if (mounted) setState(() => _settings = settings);
    } catch (_) {
      /* use defaults */
    }
    await _syncNotifications();
  }

  Future<void> _syncNotifications() async {
    await NotificationService.instance.syncFreezerReminders(
      settings: _settings,
      items: _activeFreezerItems,
    );
  }

  @override
  void dispose() {
    _freezerSubscription?.cancel();
    _historySubscription?.cancel();
    _freezerHistorySubscription?.cancel();
    _scanner.dispose();
    super.dispose();
  }

  Future<void> _scanReceipt() async {
    setState(() => _isScanning = true);
    try {
      final result = await _scanner.scanReceipt();
      if (!mounted) return;

      if (result.cancelled) return;

      if (!result.isSuccess) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              result.errorMessage ??
                  'Receipt scan failed. Please try again with better lighting.',
            ),
            backgroundColor: AppColors.danger,
            duration: const Duration(seconds: 5),
          ),
        );
        return;
      }

      final receipt = result.receipt!;
      final confirmed = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.white,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
        ),
        builder: (context) => ReceiptReviewSheet(receipt: receipt),
      );

      if (confirmed == true) {
        await _applyReceipt(receipt);
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Added ${receipt.items.length} item(s). Expiry set to ${FreezerService.defaultShelfLifeDays} days.',
            ),
          ),
        );
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('OCR scan failed: $error'),
          backgroundColor: AppColors.danger,
        ),
      );
    } finally {
      if (mounted) setState(() => _isScanning = false);
    }
  }

  Future<void> _applyReceipt(ParsedReceipt receipt) async {
    final freezerItems = _freezerService.createItemsFromReceipt(receipt);
    for (var i = 0; i < receipt.items.length && i < freezerItems.length; i++) {
      final item = receipt.items[i];
      final freezer = freezerItems[i];
      if (item.pricePerKg <= 0) {
        await _repository.addFreezerItem(freezer);
        continue;
      }
      await _repository.addFreezerWithPriceHistory(
        item: freezer.copyWith(displayWeightUnit: 'kg'),
        history: PriceHistoryEntry(
          species: item.species,
          pricePerKg: item.pricePerKg,
          recordedAt: receipt.purchaseDate,
          quantityKg: item.quantityKg,
          weightValue: WeightUnits.fromKg(item.quantityKg, 'kg'),
          weightUnit: 'kg',
          totalPriceRm: item.totalPrice,
        ),
      );
    }

    setState(() {
      _latestReceipt = receipt;
      _selectedIndex = 1;
    });
  }

  Future<void> _addManualFreezerItem(FreezerItem item) async {
    if (item.pricePerKg > 0) {
      await _repository.addFreezerWithPriceHistory(
        item: item,
        history: _priceSync.historyFromFreezerItem(item),
      );
    } else {
      await _repository.addFreezerItem(item);
    }
    if (!mounted) return;
    if (item.pricePerKg > 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Item saved. Price recorded in Price History.'),
        ),
      );
    }
    setState(() => _selectedIndex = 1);
  }

  Future<void> _saveNormalizedPrice(PriceHistoryEntry entry) async {
    if (entry.species.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a seafood item name.')),
      );
      return;
    }
    await _repository.addPriceHistory(entry);
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Price saved to history')));
  }

  Future<void> _deletePriceHistory(PriceHistoryEntry entry) async {
    await _repository.deletePriceHistory(entry);
  }

  Future<void> _updateFreezerItem(FreezerItem item) async {
    FreezerItem? existing;
    for (final entry in _freezerItems) {
      if (entry.id == item.id) {
        existing = entry;
        break;
      }
    }

    final outcome = await _priceSync.syncFreezerUpdate(
      existing: existing,
      item: item,
      repository: _repository,
      cachedHistory: _priceHistory,
    );

    if (!mounted) return;
    if (outcome.priceHistoryUpdated) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            outcome.hadExistingLink
                ? 'Freezer item saved. Price history updated for ${item.species}.'
                : 'Freezer item saved. Price history linked for ${item.species}.',
          ),
        ),
      );
    }
  }

  Future<void> _updatePriceHistoryFromUi(
    PriceHistoryEntry entry, {
    bool syncFreezer = false,
  }) async {
    await _repository.updatePriceHistory(entry);
    if (!syncFreezer || entry.freezerItemId == null) return;

    FreezerItem? freezer;
    for (final item in _freezerItems) {
      if (item.id == entry.freezerItemId) {
        freezer = item;
        break;
      }
    }
    if (freezer == null) return;

    final kg = entry.quantityKg ?? freezer.stockKg;
    await _repository.updateFreezerItem(
      freezer.copyWith(
        species: entry.species,
        stockKg: kg,
        pricePerKg: entry.pricePerKg,
        purchaseDate: entry.recordedAt,
        displayWeightUnit: entry.weightUnit,
        linkedPriceHistoryId: entry.id,
      ),
    );
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Price history and freezer item updated.')),
    );
  }

  Future<void> _deleteFreezerItem(FreezerItem item) async {
    await _repository.deleteFreezerItem(item);
  }

  Future<void> _markFreezerLoss(
    FreezerItem item,
    String reason,
    String note,
  ) async {
    await _repository.recordFreezerLoss(
      item: item,
      reason: reason,
      note: note,
    );
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          '${item.species} marked as ${FreezerHistoryEntry.reasonLabel(reason).toLowerCase()}.',
        ),
      ),
    );
  }

  void _openSettings() {
    setState(() => _selectedIndex = 5);
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      HomeScreen(
        freezerItems: _activeFreezerItems,
        onViewFreezer: () => setState(() => _selectedIndex = 1),
        onScan: _scanReceipt,
        onRecipes: () => setState(() => _selectedIndex = 4),
      ),
      FreezerScreen(
        items: _activeFreezerItems,
        lossHistory: _freezerHistory,
        priceHistory: _priceHistory,
        onAddItem: _addManualFreezerItem,
        onUpdateItem: _updateFreezerItem,
        onDeleteItem: _deleteFreezerItem,
        onMarkLoss: _markFreezerLoss,
      ),
      ScanScreen(
        isScanning: _isScanning,
        latestReceipt: _latestReceipt,
        onScan: _scanReceipt,
      ),
      CompareScreen(
        history: _priceHistory,
        latestReceipt: _latestReceipt,
        onSave: _saveNormalizedPrice,
        onUpdate: _updatePriceHistoryFromUi,
        onDelete: _deletePriceHistory,
      ),
      RecipesScreen(userId: widget.user.uid, freezerItems: _activeFreezerItems),
      SettingsScreen(
        user: widget.user,
        freezerItems: _activeFreezerItems,
        onLogout: widget.onLogout,
        onSettingsSaved: (settings) {
          setState(() => _settings = settings);
          _syncNotifications();
        },
      ),
    ];

    return Scaffold(
      body: Column(
        children: [
          AppHeader(
            user: widget.user,
            profileName: _settings.resolvedName,
            onSettings: _openSettings,
          ),
          Expanded(child: pages[_selectedIndex]),
        ],
      ),
      bottomNavigationBar: BottomNavBar(
        selectedIndex: _bottomNavIndex,
        onSelect: (index) {
          final pageIndex = switch (index) {
            0 => 0,
            1 => 1,
            2 => 3,
            3 => 4,
            _ => 0,
          };
          setState(() => _selectedIndex = pageIndex);
        },
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppColors.navy,
        foregroundColor: Colors.white,
        elevation: 8,
        shape: const CircleBorder(),
        onPressed: _isScanning ? null : _scanReceipt,
        child: _isScanning
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              )
            : const Icon(Icons.document_scanner_outlined),
      ),
    );
  }

  int get _bottomNavIndex {
    if (_selectedIndex == 0 || _selectedIndex == 1) return _selectedIndex;
    if (_selectedIndex == 3) return 2;
    if (_selectedIndex == 4) return 3;
    return -1;
  }
}

class AppHeader extends StatelessWidget {
  const AppHeader({
    super.key,
    required this.user,
    required this.onSettings,
    this.profileName,
  });

  final User user;
  final VoidCallback onSettings;
  final String? profileName;

  String get _greetingName {
    final fromProfile = profileName?.trim();
    if (fromProfile != null && fromProfile.isNotEmpty) return fromProfile;
    final displayName = user.displayName?.trim();
    if (displayName != null && displayName.isNotEmpty) return displayName;
    final email = user.email;
    if (email != null && email.contains('@')) {
      return email.split('@').first;
    }
    return 'there';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 112,
      padding: const EdgeInsets.fromLTRB(20, 36, 18, 14),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF2F3C95), Color(0xFF3D4FA8)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.only(
          bottomLeft: Radius.circular(18),
          bottomRight: Radius.circular(18),
        ),
        boxShadow: [
          BoxShadow(
            color: Color(0x332F3C95),
            offset: Offset(0, 5),
            blurRadius: 12,
          ),
        ],
      ),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(
            right: -20,
            top: -10,
            child: Icon(
              Icons.waves,
              size: 90,
              color: Colors.white.withValues(alpha: 0.06),
            ),
          ),
          Row(
        children: [
          const CircleAvatar(
            radius: 17,
            backgroundColor: Color(0xFF6071BF),
            child: Icon(
              Icons.phishing_rounded,
              color: AppColors.teal,
              size: 20,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Boon Hua Fishery',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
                Text(
                  'Hi, $_greetingName',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFFDDE6FF),
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          IconButton.filled(
            style: IconButton.styleFrom(backgroundColor: Color(0xFF3445A7)),
            onPressed: onSettings,
            icon: const Icon(Icons.settings_outlined, color: Colors.white),
          ),
        ],
          ),
        ],
      ),
    );
  }
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({
    super.key,
    required this.freezerItems,
    required this.onViewFreezer,
    required this.onScan,
    required this.onRecipes,
  });

  final List<FreezerItem> freezerItems;
  final VoidCallback onViewFreezer;
  final VoidCallback onScan;
  final VoidCallback onRecipes;

  @override
  Widget build(BuildContext context) {
    final expiringItems = freezerItems
        .where((item) => item.daysRemaining <= 3)
        .toList();
    final totalWeight = freezerItems.fold<double>(
      0,
      (total, item) => total + item.stockKg,
    );

    return ScreenScaffold(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SummaryCard(
            totalWeight: totalWeight,
            expiringCount: expiringItems.length,
            itemCount: freezerItems.length,
          ),
          const SizedBox(height: 18),
          SectionTitle(
            title: 'Eat Soon',
            action: 'View All',
            onAction: onViewFreezer,
          ),
          const SizedBox(height: 10),
          for (final item in expiringItems.take(2)) SeafoodTile(item: item),
          const SizedBox(height: 18),
          const Text(
            'Quick Actions',
            style: TextStyle(
              color: AppColors.ink,
              fontSize: 16,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: QuickActionCard(
                  label: 'Scan Receipt',
                  icon: Icons.document_scanner_outlined,
                  color: AppColors.navy,
                  accentColor: const Color(0xFF4379EE),
                  onTap: onScan,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: QuickActionCard(
                  label: 'Get Recipes',
                  icon: Icons.restaurant_menu_outlined,
                  color: AppColors.teal,
                  accentColor: const Color(0xFF3AA896),
                  onTap: onRecipes,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class SummaryCard extends StatelessWidget {
  const SummaryCard({
    super.key,
    required this.totalWeight,
    required this.expiringCount,
    required this.itemCount,
  });

  final double totalWeight;
  final int expiringCount;
  final int itemCount;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF2F3C95), Color(0xFF4A5BB5)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Color(0x332F3C95),
            offset: Offset(0, 6),
            blurRadius: 14,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Text(
                  '🧊 Virtual Freezer',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Text(
            'Good morning!',
            style: TextStyle(
              color: Colors.white,
              fontSize: 20,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'You have $itemCount items in your virtual freezer.',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.85),
              height: 1.4,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: MetricBox(
                  icon: Icons.thermostat_outlined,
                  label: 'Total\nWeight',
                  value: totalWeight.toStringAsFixed(1),
                  unit: 'kg',
                  color: const Color(0xFF4B72FF),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: MetricBox(
                  icon: Icons.error_outline,
                  label: 'Expiring',
                  value: '$expiringCount',
                  unit: 'items',
                  color: AppColors.warning,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class MetricBox extends StatelessWidget {
  const MetricBox({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    required this.unit,
    required this.color,
  });

  final IconData icon;
  final String label;
  final String value;
  final String unit;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 104,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.line),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F000000),
            offset: Offset(0, 3),
            blurRadius: 8,
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, color: color, size: 19),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(color: AppColors.muted, fontSize: 10),
                ),
                Text(
                  value,
                  style: TextStyle(
                    color: color,
                    fontWeight: FontWeight.w900,
                    fontSize: 18,
                  ),
                ),
                Text(
                  unit,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class FreezerScreen extends StatefulWidget {
  const FreezerScreen({
    super.key,
    required this.items,
    required this.lossHistory,
    required this.priceHistory,
    required this.onAddItem,
    required this.onUpdateItem,
    required this.onDeleteItem,
    required this.onMarkLoss,
  });

  final List<FreezerItem> items;
  final List<FreezerHistoryEntry> lossHistory;
  final List<PriceHistoryEntry> priceHistory;
  final ValueChanged<FreezerItem> onAddItem;
  final ValueChanged<FreezerItem> onUpdateItem;
  final ValueChanged<FreezerItem> onDeleteItem;
  final void Function(FreezerItem item, String reason, String note) onMarkLoss;

  @override
  State<FreezerScreen> createState() => _FreezerScreenState();
}

class _FreezerScreenState extends State<FreezerScreen> {
  int _tabIndex = 0;

  Future<void> _confirmMarkLoss(FreezerItem item) async {
    var reason = item.daysRemaining < 0 ? 'expired' : 'spoiled';
    final noteController = TextEditingController();
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setDialogState) {
            return AlertDialog(
              title: Text('Record loss — ${item.species}'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'What happened to this item?',
                    style: TextStyle(fontSize: 13, color: AppColors.muted),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: reason,
                    decoration: const InputDecoration(
                      labelText: 'Reason',
                      border: OutlineInputBorder(),
                    ),
                    items: const [
                      DropdownMenuItem(value: 'spoiled', child: Text('Spoiled')),
                      DropdownMenuItem(value: 'expired', child: Text('Expired')),
                      DropdownMenuItem(value: 'wastage', child: Text('Wastage / damaged')),
                      DropdownMenuItem(value: 'consumed', child: Text('Used / cooked')),
                    ],
                    onChanged: (v) {
                      if (v == null) return;
                      setDialogState(() => reason = v);
                    },
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: noteController,
                    decoration: const InputDecoration(
                      labelText: 'Note (optional)',
                      border: OutlineInputBorder(),
                    ),
                    maxLines: 2,
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(ctx, true),
                  child: const Text('Save'),
                ),
              ],
            );
          },
        );
      },
    );
    if (result != true) {
      noteController.dispose();
      return;
    }
    final note = noteController.text.trim();
    noteController.dispose();
    widget.onMarkLoss(item, reason, note);
  }

  @override
  Widget build(BuildContext context) {
    return ScreenScaffold(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: PageHeading(
                  title: 'Virtual Freezer',
                  subtitle: 'Track stock, expiry, and spoilage',
                ),
              ),
              if (_tabIndex == 0)
                IconButton.filledTonal(
                  style: IconButton.styleFrom(
                    backgroundColor: const Color(0xFFE7FAF6),
                    foregroundColor: AppColors.teal,
                  ),
                  onPressed: () => _openAddItemSheet(context),
                  icon: const Icon(Icons.add),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: FilterChip(
                  label: Text('Active (${widget.items.length})'),
                  selected: _tabIndex == 0,
                  onSelected: (_) => setState(() => _tabIndex = 0),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilterChip(
                  label: Text('Loss history (${widget.lossHistory.length})'),
                  selected: _tabIndex == 1,
                  onSelected: (_) => setState(() => _tabIndex = 1),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          if (_tabIndex == 0) ...[
            const SearchBox(),
            const SizedBox(height: 16),
            if (widget.items.isEmpty)
              const EmptyCard(
                icon: Icons.kitchen_outlined,
                title: 'No active freezer items',
                message:
                    'Scan a receipt or add seafood manually. Spoiled or used items appear under Loss history.',
              ),
            for (final item in widget.items)
              FreezerTile(
                item: item,
                onEdit: () => _openAddItemSheet(context, existingItem: item),
                onDelete: () => widget.onDeleteItem(item),
                onMarkLoss: () => _confirmMarkLoss(item),
              ),
          ] else if (widget.lossHistory.isEmpty)
            const EmptyCard(
              icon: Icons.history,
              title: 'No loss records yet',
              message:
                  'When seafood spoils, expires, or is used up, mark it from an active item to keep a history here.',
            )
          else
            ...widget.lossHistory.map(
              (entry) => _FreezerLossHistoryTile(entry: entry),
            ),
        ],
      ),
    );
  }

  PriceHistoryEntry? _linkedPriceHistory(FreezerItem item) {
    if (item.linkedPriceHistoryId != null) {
      for (final entry in widget.priceHistory) {
        if (entry.id == item.linkedPriceHistoryId) return entry;
      }
    }
    for (final entry in widget.priceHistory) {
      if (entry.freezerItemId == item.id) return entry;
    }
    return null;
  }

  void _openAddItemSheet(BuildContext context, {FreezerItem? existingItem}) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (context) => AddItemForm(
        existingItem: existingItem,
        linkedHistory: existingItem == null
            ? null
            : _linkedPriceHistory(existingItem),
        onSave: existingItem == null ? widget.onAddItem : widget.onUpdateItem,
      ),
    );
  }
}

class _FreezerLossHistoryTile extends StatelessWidget {
  const _FreezerLossHistoryTile({required this.entry});

  final FreezerHistoryEntry entry;

  @override
  Widget build(BuildContext context) {
    final reason = FreezerHistoryEntry.reasonLabel(entry.reason);
    final color = entry.reason == 'consumed'
        ? AppColors.teal
        : entry.reason == 'expired'
            ? AppColors.warning
            : AppColors.danger;

    return AppCard(
      margin: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: color.withValues(alpha: 0.35)),
            ),
            child: Text(
              reason,
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.w800,
                fontSize: 11,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  entry.species,
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    color: AppColors.ink,
                  ),
                ),
                Text(
                  WeightUnits.formatStockKg(entry.stockKg, entry.displayWeightUnit),
                  style: const TextStyle(color: AppColors.muted, fontSize: 12),
                ),
                if (entry.note.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      entry.note,
                      style: const TextStyle(color: AppColors.muted, fontSize: 12),
                    ),
                  ),
              ],
            ),
          ),
          Text(
            _formatLossDate(entry.recordedAt),
            style: const TextStyle(color: AppColors.muted, fontSize: 11),
          ),
        ],
      ),
    );
  }

  String _formatLossDate(DateTime date) {
    return '${date.day}/${date.month}/${date.year}';
  }
}

enum ExpiryInputMode { days, months, calendar }

class AddItemForm extends StatefulWidget {
  const AddItemForm({
    super.key,
    this.existingItem,
    this.linkedHistory,
    required this.onSave,
  });

  final FreezerItem? existingItem;
  final PriceHistoryEntry? linkedHistory;
  final ValueChanged<FreezerItem> onSave;

  @override
  State<AddItemForm> createState() => _AddItemFormState();
}

class _AddItemFormState extends State<AddItemForm> {
  late final TextEditingController _nameController;
  late final TextEditingController _weightController;
  late final TextEditingController _expiryAmountController;
  late final TextEditingController _priceController;
  late String _iconKey;
  String _weightUnit = 'g';
  late DateTime _purchaseDate;
  late ExpiryInputMode _expiryMode;
  DateTime? _expiryCalendarDate;
  String? _imagePath;
  final ImagePicker _imagePicker = ImagePicker();

  static DateTime _dateOnly(DateTime value) =>
      DateTime(value.year, value.month, value.day);

  static String _formatDate(DateTime date) {
    return '${date.day.toString().padLeft(2, '0')}/'
        '${date.month.toString().padLeft(2, '0')}/'
        '${date.year}';
  }

  DateTime get _bestBeforeDate {
    final purchase = _dateOnly(_purchaseDate);
    switch (_expiryMode) {
      case ExpiryInputMode.days:
        final days = int.tryParse(_expiryAmountController.text) ??
            FreezerService.defaultShelfLifeDays;
        return purchase.add(Duration(days: days.clamp(1, 3650)));
      case ExpiryInputMode.months:
        final months = int.tryParse(_expiryAmountController.text) ?? 1;
        return DateTime(
          purchase.year,
          purchase.month + months.clamp(1, 120),
          purchase.day,
        );
      case ExpiryInputMode.calendar:
        return _dateOnly(
          _expiryCalendarDate ??
              purchase.add(
                Duration(days: FreezerService.defaultShelfLifeDays),
              ),
        );
    }
  }

  @override
  void initState() {
    super.initState();
    final item = widget.existingItem;
    _iconKey = item?.iconKey ?? 'fish';
    _imagePath = item?.imagePath;
    _nameController = TextEditingController(text: item?.species ?? '');
    _weightUnit = item?.displayWeightUnit ?? 'g';
    _weightController = TextEditingController(
      text: item == null
          ? '500'
          : WeightUnits.fromKg(item.stockKg, _weightUnit).toStringAsFixed(
              _weightUnit == 'g' ? 0 : 2,
            ),
    );
    _purchaseDate = _dateOnly(item?.purchaseDate ?? DateTime.now());
    if (item != null) {
      final purchase = _dateOnly(item.purchaseDate);
      final best = _dateOnly(item.bestBeforeDate);
      _expiryCalendarDate = best;
      final shelfDays = best.difference(purchase).inDays.clamp(1, 3650);
      _expiryAmountController = TextEditingController(text: '$shelfDays');
      _expiryMode = ExpiryInputMode.days;
    } else {
      _expiryAmountController = TextEditingController(
        text: '${FreezerService.defaultShelfLifeDays}',
      );
      _expiryMode = ExpiryInputMode.days;
      _expiryCalendarDate =
          _purchaseDate.add(Duration(days: FreezerService.defaultShelfLifeDays));
    }
    String pricePrefill = '';
    if (item != null && item.pricePerKg > 0) {
      final linked = widget.linkedHistory;
      final total = linked?.totalPriceRm ??
          (linked != null
              ? linked.pricePerKg * (linked.quantityKg ?? item.stockKg)
              : item.pricePerKg * item.stockKg);
      if (total > 0) {
        pricePrefill = total.toStringAsFixed(2);
      }
    }
    _priceController = TextEditingController(text: pricePrefill);
    _priceController.addListener(() => setState(() {}));
    _expiryAmountController.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _nameController.dispose();
    _weightController.dispose();
    _expiryAmountController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  Future<void> _pickPurchaseDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _purchaseDate,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked == null) return;
    setState(() => _purchaseDate = _dateOnly(picked));
  }

  Future<void> _pickExpiryDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _expiryCalendarDate ?? _bestBeforeDate,
      firstDate: _purchaseDate,
      lastDate: _purchaseDate.add(const Duration(days: 3650)),
    );
    if (picked == null) return;
    setState(() => _expiryCalendarDate = _dateOnly(picked));
  }

  Future<void> _pickPhoto(ImageSource source) async {
    if (source == ImageSource.camera) {
      final status = await Permission.camera.request();
      if (!status.isGranted) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Camera permission is required to take a photo.'),
          ),
        );
        return;
      }
    }

    final image = await _imagePicker.pickImage(source: source, imageQuality: 85);
    if (image == null) return;

    final directory = await getApplicationDocumentsDirectory();
    final fileName = 'freezer_${DateTime.now().millisecondsSinceEpoch}.jpg';
    final saved = await File(image.path).copy('${directory.path}/$fileName');

    setState(() {
      _imagePath = saved.path;
    });
  }

  Future<void> _showVisualPicker() async {
    await showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Item Photo or Icon',
                  style: TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w900,
                    fontSize: 18,
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () {
                          Navigator.pop(context);
                          _pickPhoto(ImageSource.camera);
                        },
                        icon: const Icon(Icons.camera_alt_outlined),
                        label: const Text('Take Photo'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () {
                          Navigator.pop(context);
                          _pickPhoto(ImageSource.gallery);
                        },
                        icon: const Icon(Icons.photo_library_outlined),
                        label: const Text('Gallery'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                const Text(
                  'Or choose a seafood icon',
                  style: TextStyle(
                    color: AppColors.muted,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: SeafoodIconOptions.all.map((option) {
                    final selected = _iconKey == option.key;
                    return ChoiceChip(
                      selected: selected,
                      label: Text('${option.emoji} ${option.label}'),
                      onSelected: (_) {
                        setState(() {
                          _iconKey = option.key;
                          _imagePath = null;
                        });
                        Navigator.pop(context);
                      },
                    );
                  }).toList(),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _save() {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter an item name.')),
      );
      return;
    }
    final weightValue = double.tryParse(_weightController.text) ?? 0;
    if (weightValue <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a valid weight.')),
      );
      return;
    }
    final stockKg = WeightUnits.toKg(weightValue, _weightUnit);
    final totalPaid =
        double.tryParse(_priceController.text.replaceAll('RM', '').trim()) ?? 0;
    const normalizer = PriceNormalizer();
    final pricePerKg = totalPaid > 0 && stockKg > 0
        ? normalizer.normalizeFromWeight(
            totalPrice: totalPaid,
            weightValue: weightValue,
            unit: _weightUnit,
          )
        : 0.0;
    final bestBefore = _bestBeforeDate;
    if (!bestBefore.isAfter(_purchaseDate)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Expiry date must be after the purchase date.'),
        ),
      );
      return;
    }

    widget.onSave(
      FreezerItem(
        id: widget.existingItem?.id,
        species: name,
        stockKg: stockKg,
        purchaseDate: _purchaseDate,
        bestBeforeDate: bestBefore,
        pricePerKg: pricePerKg,
        iconKey: _iconKey,
        imagePath: _imagePath,
        displayWeightUnit: _weightUnit,
        linkedPriceHistoryId: widget.existingItem?.linkedPriceHistoryId,
      ),
    );
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 18,
        bottom: MediaQuery.of(context).viewInsets.bottom + 22,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                ),
                Text(
                  widget.existingItem == null ? 'Add Item' : 'Edit Item',
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Center(
              child: InkWell(
                onTap: _showVisualPicker,
                borderRadius: BorderRadius.circular(8),
                child: ItemVisualPreview(
                  iconKey: _iconKey,
                  imagePath: _imagePath,
                  size: 96,
                ),
              ),
            ),
            const SizedBox(height: 6),
            const Center(
              child: Text(
                'Tap to take photo or choose a seafood icon',
                style: TextStyle(color: AppColors.muted, fontSize: 10),
              ),
            ),
            const SizedBox(height: 18),
            FormFieldBox(
              label: 'ITEM NAME',
              hint: 'e.g. Fresh Squid',
              controller: _nameController,
            ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  flex: 2,
                  child: FormFieldBox(
                    label: 'WEIGHT',
                    hint: _weightUnit == 'kg' ? '0.5' : '500',
                    controller: _weightController,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: _weightUnit,
                    decoration: const InputDecoration(
                      labelText: 'UNIT',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    items: WeightUnits.options
                        .map(
                          (u) => DropdownMenuItem(value: u, child: Text(u)),
                        )
                        .toList(),
                    onChanged: (value) {
                      if (value == null) return;
                      setState(() => _weightUnit = value);
                    },
                  ),
                ),
              ],
            ),
            if (widget.existingItem != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  'Editing weight updates the linked price history (RM/kg recalculated from the same total paid when only weight changes).',
                  style: TextStyle(
                    color: AppColors.muted.withValues(alpha: 0.95),
                    fontSize: 10,
                    height: 1.35,
                  ),
                ),
              ),
            const SizedBox(height: 12),
            const Text(
              'PURCHASE DATE',
              style: TextStyle(
                color: AppColors.muted,
                fontSize: 10,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(height: 6),
            OutlinedButton.icon(
              onPressed: _pickPurchaseDate,
              icon: const Icon(Icons.calendar_today_outlined, size: 18),
              label: Text(_formatDate(_purchaseDate)),
            ),
            const SizedBox(height: 16),
            const Text(
              'EXPIRY',
              style: TextStyle(
                color: AppColors.muted,
                fontSize: 10,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(height: 8),
            SegmentedButton<ExpiryInputMode>(
              segments: const [
                ButtonSegment(
                  value: ExpiryInputMode.days,
                  label: Text('Days'),
                ),
                ButtonSegment(
                  value: ExpiryInputMode.months,
                  label: Text('Months'),
                ),
                ButtonSegment(
                  value: ExpiryInputMode.calendar,
                  label: Text('Date'),
                ),
              ],
              selected: {_expiryMode},
              onSelectionChanged: (selection) {
                setState(() {
                  _expiryMode = selection.first;
                  if (_expiryMode == ExpiryInputMode.calendar &&
                      _expiryCalendarDate == null) {
                    _expiryCalendarDate = _bestBeforeDate;
                  }
                });
              },
            ),
            const SizedBox(height: 10),
            if (_expiryMode == ExpiryInputMode.calendar)
              OutlinedButton.icon(
                onPressed: _pickExpiryDate,
                icon: const Icon(Icons.event_outlined, size: 18),
                label: Text(
                  'Expiry: ${_formatDate(_expiryCalendarDate ?? _bestBeforeDate)}',
                ),
              )
            else
              FormFieldBox(
                label: _expiryMode == ExpiryInputMode.days
                    ? 'DAYS UNTIL EXPIRY'
                    : 'MONTHS UNTIL EXPIRY',
                hint: _expiryMode == ExpiryInputMode.days
                    ? '${FreezerService.defaultShelfLifeDays}'
                    : '1',
                suffix: _expiryMode == ExpiryInputMode.days ? 'Days' : 'Months',
                controller: _expiryAmountController,
              ),
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.teal.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.teal.withValues(alpha: 0.35)),
              ),
              child: Text(
                'Expires on ${_formatDate(_bestBeforeDate)}',
                style: const TextStyle(
                  color: AppColors.ink,
                  fontWeight: FontWeight.w800,
                  fontSize: 13,
                ),
              ),
            ),
            Text(
              'Recommended: ${FreezerService.defaultShelfLifeDays} days for frozen seafood.',
              style: const TextStyle(color: AppColors.muted, fontSize: 10),
            ),
            const SizedBox(height: 18),
            FormFieldBox(
              label: 'TOTAL PAID (RM) (Optional)',
              hint: 'RM 0.00',
              controller: _priceController,
            ),
            Builder(
              builder: (context) {
                final total = double.tryParse(
                      _priceController.text.replaceAll('RM', '').trim(),
                    ) ??
                    0;
                final weightValue =
                    double.tryParse(_weightController.text) ?? 0;
                final stockKg = weightValue > 0
                    ? WeightUnits.toKg(weightValue, _weightUnit)
                    : 0.0;
                if (total <= 0 || stockKg <= 0) {
                  return const SizedBox.shrink();
                }
                final rmKg = total / stockKg;
                return Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    '≈ RM ${rmKg.toStringAsFixed(2)}/kg will be saved to Price History for ${_formatDate(_purchaseDate)}.',
                    style: const TextStyle(color: AppColors.muted, fontSize: 10),
                  ),
                );
              },
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              height: 52,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.teal,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                onPressed: _save,
                icon: const Icon(Icons.save_outlined),
                label: Text(
                  widget.existingItem == null
                      ? 'Save to Freezer'
                      : 'Update Item',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class ScanScreen extends StatelessWidget {
  const ScanScreen({
    super.key,
    required this.isScanning,
    required this.latestReceipt,
    required this.onScan,
  });

  final bool isScanning;
  final ParsedReceipt? latestReceipt;
  final VoidCallback onScan;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black,
      child: Column(
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(30),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: Colors.white70,
                        style: BorderStyle.solid,
                      ),
                    ),
                  ),
                  Positioned(
                    top: 12,
                    child: Column(
                      children: const [
                        Text(
                          'Scan Receipt',
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w900,
                            fontSize: 16,
                          ),
                        ),
                        SizedBox(height: 7),
                        Text(
                          'Align receipt within the frame',
                          style: TextStyle(color: Colors.white, fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                  if (latestReceipt != null)
                    Positioned(
                      bottom: 16,
                      child: Text(
                        '${latestReceipt!.items.length} items parsed',
                        style: const TextStyle(
                          color: AppColors.teal,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: 26),
            child: FloatingActionButton.large(
              heroTag: 'camera',
              backgroundColor: Colors.white,
              foregroundColor: Colors.black,
              onPressed: isScanning ? null : onScan,
              child: isScanning
                  ? const CircularProgressIndicator()
                  : const Icon(Icons.camera_alt_outlined),
            ),
          ),
        ],
      ),
    );
  }
}

class CompareScreen extends StatefulWidget {
  const CompareScreen({
    super.key,
    required this.history,
    required this.onSave,
    required this.onUpdate,
    required this.onDelete,
    this.latestReceipt,
  });

  final List<PriceHistoryEntry> history;
  final ValueChanged<PriceHistoryEntry> onSave;
  final void Function(PriceHistoryEntry entry, {bool syncFreezer}) onUpdate;
  final ValueChanged<PriceHistoryEntry> onDelete;
  final ParsedReceipt? latestReceipt;

  @override
  State<CompareScreen> createState() => _CompareScreenState();
}

class _CompareScreenState extends State<CompareScreen> {
  final _itemController = TextEditingController();
  final _dateController = TextEditingController();
  final _priceController = TextEditingController();
  final _weightController = TextEditingController();
  final _normalizer = const PriceNormalizer();
  String _weightUnit = 'g';
  ParsedReceipt? _appliedReceipt;

  @override
  void initState() {
    super.initState();
    _resetDateField(DateTime.now());
    _prefillFromReceipt(widget.latestReceipt);
  }

  @override
  void didUpdateWidget(covariant CompareScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.latestReceipt != oldWidget.latestReceipt &&
        widget.latestReceipt != null &&
        widget.latestReceipt != _appliedReceipt) {
      _prefillFromReceipt(widget.latestReceipt);
    }
  }

  void _resetDateField(DateTime date) {
    _dateController.text =
        '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';
  }

  void _prefillFromReceipt(ParsedReceipt? receipt) {
    if (receipt == null || receipt.items.isEmpty) return;
    final item = receipt.items.first;
    _appliedReceipt = receipt;
    _itemController.text = item.species;
    _resetDateField(receipt.purchaseDate);
    _priceController.text = item.totalPrice.toStringAsFixed(2);
    _weightController.text = (item.quantityKg * 1000).toStringAsFixed(0);
    _weightUnit = 'g';
    setState(() {});
  }

  double get _normalizedPrice {
    final price =
        double.tryParse(_priceController.text.replaceAll('RM', '').trim()) ?? 0;
    final weight = double.tryParse(_weightController.text) ?? 0;
    return _normalizer.normalizeFromWeight(
      totalPrice: price,
      weightValue: weight,
      unit: _weightUnit,
    );
  }

  DateTime? _parseDateField() {
    final parts = _dateController.text.split('/');
    if (parts.length == 2) {
      final day = int.tryParse(parts[0]);
      final month = int.tryParse(parts[1]);
      if (day != null && month != null) {
        return DateTime(DateTime.now().year, month, day);
      }
    }
    if (parts.length == 3) {
      final day = int.tryParse(parts[0]);
      final month = int.tryParse(parts[1]);
      final year = int.tryParse(parts[2]);
      if (day != null && month != null && year != null) {
        return DateTime(year, month, day);
      }
    }
    return null;
  }

  @override
  void dispose() {
    _itemController.dispose();
    _dateController.dispose();
    _priceController.dispose();
    _weightController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final matchingHistory = widget.history
        .where(
          (entry) =>
              entry.species.trim().toLowerCase() ==
              _itemController.text.trim().toLowerCase(),
        )
        .toList();
    final previousPrice = matchingHistory.isEmpty
        ? null
        : matchingHistory.first.pricePerKg;
    final priceDifference = previousPrice == null
        ? null
        : _normalizedPrice - previousPrice;
    final percentDifference = previousPrice == null || previousPrice == 0
        ? null
        : (priceDifference! / previousPrice) * 100;

    return ScreenScaffold(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const PageHeading(
            title: 'Price Normalizer',
            subtitle:
                'Compare seafood prices fairly by standardizing to price per KG.',
          ),
          const SizedBox(height: 14),
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: FormFieldBox(
                        label: 'ITEM NAME',
                        controller: _itemController,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FormFieldBox(
                        label: 'DATE',
                        controller: _dateController,
                        suffixIcon: Icons.calendar_today_outlined,
                      ),
                    ),
                  ],
                ),
                FormFieldBox(
                  label: 'ITEM PRICE (RM)',
                  prefix: 'RM ',
                  controller: _priceController,
                ),
                Row(
                  children: [
                    Expanded(
                      flex: 2,
                      child: FormFieldBox(
                        label: 'WEIGHT',
                        controller: _weightController,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        key: ValueKey(_weightUnit),
                        initialValue: _weightUnit,
                        decoration: const InputDecoration(
                          labelText: 'UNIT',
                          border: OutlineInputBorder(),
                          isDense: true,
                        ),
                        items: const [
                          DropdownMenuItem(value: 'g', child: Text('g')),
                          DropdownMenuItem(value: 'kg', child: Text('kg')),
                          DropdownMenuItem(value: 'lb', child: Text('lb')),
                        ],
                        onChanged: (value) {
                          if (value == null) return;
                          setState(() => _weightUnit = value);
                        },
                      ),
                    ),
                  ],
                ),
                SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.teal,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    onPressed: () => setState(() {}),
                    icon: const Icon(Icons.calculate_outlined),
                    label: const Text('Calculate RM/kg'),
                  ),
                ),
                const SizedBox(height: 16),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: AppColors.teal,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    children: [
                      const Text(
                        'Normalized Price',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'RM ${_normalizedPrice.toStringAsFixed(2)}/kg',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 32,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                if (previousPrice != null)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF1EF),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0xFFFFDCD8)),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          priceDifference! >= 0
                              ? Icons.trending_up
                              : Icons.trending_down,
                          color: priceDifference >= 0
                              ? AppColors.danger
                              : AppColors.teal,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            '${priceDifference >= 0 ? 'Higher' : 'Lower'} by RM ${priceDifference.abs().toStringAsFixed(2)} (${percentDifference!.abs().toStringAsFixed(1)}%) compared with last record',
                            style: const TextStyle(
                              color: AppColors.ink,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.navyDark,
                    ),
                    onPressed: () {
                      final species = _itemController.text.trim();
                      if (species.isEmpty) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Please enter a seafood item name.'),
                          ),
                        );
                        return;
                      }
                      final weight = double.tryParse(_weightController.text) ?? 0;
                      final quantityKg =
                          weight > 0 ? WeightUnits.toKg(weight, _weightUnit) : null;
                      final totalPrice = double.tryParse(
                            _priceController.text.replaceAll('RM', '').trim(),
                          ) ??
                          0;
                      widget.onSave(
                        PriceHistoryEntry(
                          species: species,
                          pricePerKg: _normalizedPrice,
                          recordedAt: _parseDateField() ?? DateTime.now(),
                          quantityKg: quantityKg,
                          weightValue: weight > 0 ? weight : null,
                          weightUnit: _weightUnit,
                          totalPriceRm: totalPrice > 0 ? totalPrice : null,
                        ),
                      );
                    },
                    icon: const Icon(Icons.save_outlined),
                    label: const Text('Save to History'),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          PriceHistoryCard(
            entries: widget.history,
            onUpdate: widget.onUpdate,
            onDelete: widget.onDelete,
          ),
        ],
      ),
    );
  }
}

class PriceHistoryCard extends StatelessWidget {
  const PriceHistoryCard({
    super.key,
    required this.entries,
    required this.onUpdate,
    required this.onDelete,
  });

  final List<PriceHistoryEntry> entries;
  final void Function(PriceHistoryEntry entry, {bool syncFreezer}) onUpdate;
  final ValueChanged<PriceHistoryEntry> onDelete;

  @override
  Widget build(BuildContext context) {
    final groupedEntries = <String, List<PriceHistoryEntry>>{};
    for (final entry in entries) {
      final key = entry.species.trim().toLowerCase();
      groupedEntries.putIfAbsent(key, () => []).add(entry);
    }
    for (final list in groupedEntries.values) {
      list.sort((a, b) => b.recordedAt.compareTo(a.recordedAt));
    }

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.history, color: AppColors.teal, size: 19),
              SizedBox(width: 8),
              Text(
                'Price History',
                style: TextStyle(
                  color: AppColors.ink,
                  fontSize: 17,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          if (groupedEntries.isEmpty)
            const Text(
              'No saved prices yet.',
              style: TextStyle(color: AppColors.muted),
            ),
          for (final itemEntries in groupedEntries.values)
            Container(
              margin: const EdgeInsets.only(bottom: 10),
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.line),
                borderRadius: BorderRadius.circular(8),
              ),
              child: ExpansionTile(
                tilePadding: const EdgeInsets.symmetric(horizontal: 14),
                childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
                title: Text(
                  itemEntries.first.species,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                subtitle: Text(
                  '${itemEntries.length} record(s) | Latest: ${_formatDate(itemEntries.first.recordedAt)}',
                  style: const TextStyle(color: AppColors.muted, fontSize: 12),
                ),
                trailing: Text(
                  'RM\n${itemEntries.first.pricePerKg.toStringAsFixed(2)}/kg',
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                    color: AppColors.teal,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                children: [
                  for (final entry in itemEntries)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 7),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _formatDate(entry.recordedAt),
                                  style: const TextStyle(
                                    color: AppColors.ink,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                if (entry.quantityKg != null)
                                  Text(
                                    WeightUnits.formatQuantity(
                                      entry.quantityKg,
                                      entry.weightUnit,
                                    ),
                                    style: const TextStyle(
                                      color: AppColors.muted,
                                      fontSize: 11,
                                    ),
                                  ),
                                if (entry.totalPriceRm != null)
                                  Text(
                                    'Paid RM ${entry.totalPriceRm!.toStringAsFixed(2)}',
                                    style: const TextStyle(
                                      color: AppColors.muted,
                                      fontSize: 11,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          Text(
                            'RM ${entry.pricePerKg.toStringAsFixed(2)}/kg',
                            style: const TextStyle(color: AppColors.ink),
                          ),
                          IconButton(
                            tooltip: 'Edit',
                            onPressed: () => _editEntry(context, entry),
                            icon: const Icon(
                              Icons.edit_outlined,
                              size: 18,
                              color: AppColors.teal,
                            ),
                          ),
                          IconButton(
                            tooltip: 'Delete',
                            onPressed: () => _confirmDelete(context, entry),
                            icon: const Icon(
                              Icons.delete_outline,
                              size: 18,
                              color: AppColors.danger,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _confirmDelete(
    BuildContext context,
    PriceHistoryEntry entry,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete price record?'),
        content: Text(
          'Remove ${entry.species} on ${_formatDate(entry.recordedAt)}?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed == true) onDelete(entry);
  }

  Future<void> _editEntry(
    BuildContext context,
    PriceHistoryEntry entry,
  ) async {
    final normalizer = const PriceNormalizer();
    final nameController = TextEditingController(text: entry.species);
    final totalController = TextEditingController(
      text: (entry.totalPriceRm ??
              (entry.pricePerKg * (entry.quantityKg ?? 0)))
          .toStringAsFixed(2),
    );
    final weightController = TextEditingController(
      text: entry.weightValue != null
          ? entry.weightValue!.toStringAsFixed(entry.weightUnit == 'g' ? 0 : 2)
          : (entry.quantityKg != null
              ? WeightUnits.fromKg(entry.quantityKg!, entry.weightUnit)
                  .toStringAsFixed(entry.weightUnit == 'g' ? 0 : 2)
              : ''),
    );
    var weightUnit = entry.weightUnit;
    final dateController = TextEditingController(
      text:
          '${entry.recordedAt.day.toString().padLeft(2, '0')}/${entry.recordedAt.month.toString().padLeft(2, '0')}/${entry.recordedAt.year}',
    );
    var syncFreezer = entry.freezerItemId != null;

    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) {
          final weight = double.tryParse(weightController.text) ?? 0;
          final total =
              double.tryParse(totalController.text.replaceAll('RM', '').trim()) ??
                  0;
          final previewPerKg = weight > 0
              ? normalizer.normalizeFromWeight(
                  totalPrice: total,
                  weightValue: weight,
                  unit: weightUnit,
                )
              : entry.pricePerKg;

          return AlertDialog(
            title: const Text('Edit price record'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: nameController,
                    decoration: const InputDecoration(labelText: 'Seafood name'),
                  ),
                  TextField(
                    controller: totalController,
                    decoration: const InputDecoration(
                      labelText: 'Total paid (RM)',
                    ),
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                  ),
                  Row(
                    children: [
                      Expanded(
                        flex: 2,
                        child: TextField(
                          controller: weightController,
                          decoration: const InputDecoration(labelText: 'Weight'),
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          value: weightUnit,
                          decoration: const InputDecoration(labelText: 'Unit'),
                          items: WeightUnits.options
                              .map(
                                (u) =>
                                    DropdownMenuItem(value: u, child: Text(u)),
                              )
                              .toList(),
                          onChanged: (v) {
                            if (v == null) return;
                            setDialogState(() => weightUnit = v);
                          },
                        ),
                      ),
                    ],
                  ),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'RM ${previewPerKg.toStringAsFixed(2)}/kg',
                      style: const TextStyle(
                        color: AppColors.teal,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  TextField(
                    controller: dateController,
                    decoration:
                        const InputDecoration(labelText: 'Date (DD/MM/YYYY)'),
                  ),
                  if (entry.freezerItemId != null)
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      value: syncFreezer,
                      onChanged: (v) =>
                          setDialogState(() => syncFreezer = v ?? false),
                      title: const Text(
                        'Also update virtual freezer item',
                        style: TextStyle(fontSize: 13),
                      ),
                    ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Save'),
              ),
            ],
          );
        },
      ),
    );

    if (saved != true) {
      nameController.dispose();
      totalController.dispose();
      weightController.dispose();
      dateController.dispose();
      return;
    }

    final species = nameController.text.trim();
    if (species.isEmpty) return;

    final parts = dateController.text.split('/');
    DateTime recordedAt = entry.recordedAt;
    if (parts.length == 3) {
      final day = int.tryParse(parts[0]);
      final month = int.tryParse(parts[1]);
      final year = int.tryParse(parts[2]);
      if (day != null && month != null && year != null) {
        recordedAt = DateTime(year, month, day);
      }
    }

    final weight = double.tryParse(weightController.text) ?? 0;
    final total =
        double.tryParse(totalController.text.replaceAll('RM', '').trim()) ?? 0;
    final quantityKg = weight > 0 ? WeightUnits.toKg(weight, weightUnit) : null;
    final pricePerKg = weight > 0 && total > 0
        ? normalizer.normalizeFromWeight(
            totalPrice: total,
            weightValue: weight,
            unit: weightUnit,
          )
        : entry.pricePerKg;

    onUpdate(
      PriceHistoryEntry(
        id: entry.id,
        species: species,
        pricePerKg: pricePerKg,
        recordedAt: recordedAt,
        quantityKg: quantityKg,
        weightValue: weight > 0 ? weight : null,
        weightUnit: weightUnit,
        totalPriceRm: total > 0 ? total : entry.totalPriceRm,
        freezerItemId: entry.freezerItemId,
      ),
      syncFreezer: syncFreezer,
    );

    nameController.dispose();
    totalController.dispose();
    weightController.dispose();
    dateController.dispose();
  }
}

class RecipesScreen extends StatefulWidget {
  const RecipesScreen({
    super.key,
    required this.userId,
    required this.freezerItems,
  });

  final String userId;
  final List<FreezerItem> freezerItems;

  @override
  State<RecipesScreen> createState() => _RecipesScreenState();
}

class _RecipesScreenState extends State<RecipesScreen> {
  final RecipeSuggestionService _recipeService = RecipeSuggestionService();
  late Future<RecipeSuggestResult> _recipeFuture;
  bool _isRefreshing = false;
  String? _ingredientFilter;

  void _loadRecipes() {
    setState(() {
      _recipeFuture = _recipeService.suggestRecipes(widget.freezerItems);
    });
  }

  Future<void> _refreshRecipes() async {
    setState(() => _isRefreshing = true);
    _loadRecipes();
    try {
      await _recipeFuture;
    } finally {
      if (mounted) setState(() => _isRefreshing = false);
    }
  }

  @override
  void initState() {
    super.initState();
    _recipeFuture = _recipeService.suggestRecipes(widget.freezerItems);
  }

  @override
  void didUpdateWidget(covariant RecipesScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final oldKey = oldWidget.freezerItems
        .map((item) => '${item.id}|${item.species}|${item.daysRemaining}')
        .join(';');
    final newKey = widget.freezerItems
        .map((item) => '${item.id}|${item.species}|${item.daysRemaining}')
        .join(';');
    if (oldKey != newKey) {
      _loadRecipes();
    }
  }

  @override
  Widget build(BuildContext context) {
    return ScreenScaffold(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF5DC0AE), Color(0xFF2F3C95)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '🍽️ Meal Ideas',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        'Recipes matched to what is in your freezer',
                        style: TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                IconButton.filled(
                  style: IconButton.styleFrom(
                    backgroundColor: Colors.white24,
                  ),
                  onPressed: _isRefreshing ? null : _refreshRecipes,
                  icon: _isRefreshing
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.refresh, color: Colors.white),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.navy,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => RecipeAiChefScreen(
                      userId: widget.userId,
                      freezerItems: widget.freezerItems
                          .map(
                            (item) => FreezerItemPayload(
                              species: item.species,
                              stockKg: item.stockKg,
                              daysRemaining: item.daysRemaining,
                            ),
                          )
                          .toList(),
                    ),
                  ),
                );
              },
              icon: const Icon(Icons.chat_bubble_outline, color: Colors.white),
              label: const Text(
                'Ask AI Recipe Chef',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
          const SizedBox(height: 14),
          if (widget.freezerItems.isNotEmpty) ...[
            Text(
              'Filter by ingredient',
              style: TextStyle(
                color: AppColors.muted.withValues(alpha: 0.9),
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: FilterChip(
                      label: const Text('All'),
                      selected: _ingredientFilter == null,
                      onSelected: (_) => setState(() => _ingredientFilter = null),
                    ),
                  ),
                  for (final item in widget.freezerItems)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: FilterChip(
                        label: Text(item.species),
                        selected: _ingredientFilter == item.species,
                        onSelected: (on) => setState(
                          () => _ingredientFilter = on ? item.species : null,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],
          FutureBuilder<RecipeSuggestResult>(
            future: _recipeFuture,
            builder: (context, snapshot) {
              if (widget.freezerItems.isEmpty) {
                return const EmptyCard(
                  icon: Icons.restaurant_menu_outlined,
                  title: 'No ingredients yet',
                  message:
                      'Add freezer items first so we can show recipes you can cook.',
                );
              }
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const AppCard(
                  child: Center(child: CircularProgressIndicator()),
                );
              }

              final result = snapshot.data ??
                  const RecipeSuggestResult(recipes: [], usedApi: false);
              final visible = result.recipes
                  .where(
                    (r) => _ingredientFilter == null
                        ? r.matchesAnyFreezerItem(widget.freezerItems)
                        : r.matchesIngredientFilter(_ingredientFilter),
                  )
                  .toList();

              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (result.usedApi)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Text(
                        _ingredientFilter == null
                            ? '${visible.length} recipe(s) for your freezer — tap an ingredient to narrow further.'
                            : '${visible.length} recipe(s) for $_ingredientFilter',
                        style: const TextStyle(color: AppColors.muted, fontSize: 12),
                      ),
                    )
                  else if (result.message != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Text(
                        result.message!,
                        style: const TextStyle(
                          color: AppColors.warning,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  if (visible.isEmpty)
                    const AppCard(
                      child: Text(
                        'No recipes match this ingredient. Try All or another item from your freezer.',
                        style: TextStyle(color: AppColors.muted, fontSize: 13),
                      ),
                    )
                  else
                    for (final recipe in visible) RecipeCard(recipe: recipe),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class RecipeCard extends StatelessWidget {
  const RecipeCard({super.key, required this.recipe});

  final RecipeSuggestion recipe;

  Widget _heroImage({required double height, required BorderRadius radius}) {
    final url = recipe.imageUrl;
    if (url != null && url.isNotEmpty) {
      return ClipRRect(
        borderRadius: radius,
        child: Image.network(
          url,
          height: height,
          width: double.infinity,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => _emojiHero(height: height, radius: radius),
        ),
      );
    }
    return _emojiHero(height: height, radius: radius);
  }

  Widget _emojiHero({required double height, required BorderRadius radius}) {
    return Container(
      height: height,
      decoration: BoxDecoration(
        borderRadius: radius,
        gradient: LinearGradient(
          colors: recipe.imageColors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Center(
        child: Text(
          recipe.imageEmoji,
          style: TextStyle(fontSize: height * 0.45),
        ),
      ),
    );
  }

  void _openRecipe(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (context) {
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.82,
          minChildSize: 0.5,
          maxChildSize: 0.95,
          builder: (context, scrollController) {
            return ListView(
              controller: scrollController,
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
              children: [
                Center(
                  child: Container(
                    width: 42,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.line,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                _heroImage(
                  height: 180,
                  radius: BorderRadius.circular(12),
                ),
                const SizedBox(height: 16),
                Text(
                  recipe.title,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  recipe.searchKeyword != null
                      ? 'Matched ingredient: ${recipe.searchKeyword} · from your ${recipe.basedOn}'
                      : 'Based on your ${recipe.basedOn}',
                  style: const TextStyle(color: AppColors.muted),
                ),
                if (recipe.source == 'ai')
                  const Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: Text(
                      'AI-generated recipe',
                      style: TextStyle(
                        color: AppColors.teal,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  )
                else if (recipe.source == 'themealdb')
                  const Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: Text(
                      'Recipe database (TheMealDB)',
                      style: TextStyle(
                        color: AppColors.muted,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    const Icon(Icons.schedule, size: 16, color: AppColors.muted),
                    const SizedBox(width: 5),
                    Text('${recipe.minutes} min'),
                    const SizedBox(width: 18),
                    const Icon(
                      Icons.local_fire_department_outlined,
                      size: 16,
                      color: AppColors.warning,
                    ),
                    const SizedBox(width: 5),
                    Text(recipe.difficulty),
                  ],
                ),
                const SizedBox(height: 20),
                const Text(
                  'Ingredients',
                  style: TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 8),
                if (recipe.ingredients.isEmpty)
                  const Text(
                    'Ingredient list not available for this recipe.',
                    style: TextStyle(color: AppColors.muted, fontSize: 13),
                  )
                else
                  ...recipe.ingredients.map((line) {
                    final fromFreezer = recipe.ingredientFromFreezer(line);
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            fromFreezer
                                ? Icons.check_circle
                                : Icons.circle_outlined,
                            size: 18,
                            color: fromFreezer
                                ? AppColors.teal
                                : AppColors.muted,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              line,
                              style: TextStyle(
                                color: AppColors.ink,
                                height: 1.35,
                                fontWeight: fromFreezer
                                    ? FontWeight.w800
                                    : FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                    );
                  }),
                if (recipe.ingredients
                    .any((line) => recipe.ingredientFromFreezer(line)))
                  Padding(
                    padding: const EdgeInsets.only(top: 4, bottom: 8),
                    child: Text(
                      'Items marked with ✓ match seafood in your freezer.',
                      style: TextStyle(
                        color: AppColors.teal.withValues(alpha: 0.9),
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                const SizedBox(height: 16),
                const Text(
                  'Steps',
                  style: TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 10),
                for (var i = 0; i < recipe.steps.length; i++)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        CircleAvatar(
                          radius: 14,
                          backgroundColor: AppColors.teal,
                          child: Text(
                            '${i + 1}',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            recipe.steps[i],
                            style: const TextStyle(
                              color: AppColors.ink,
                              height: 1.45,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppCard(
      margin: const EdgeInsets.only(bottom: 16),
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Stack(
            children: [
              _heroImage(
                height: 150,
                radius: const BorderRadius.vertical(top: Radius.circular(8)),
              ),
              Positioned(
                left: 12,
                top: 12,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE8FFF8),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    recipe.searchKeyword != null
                        ? '${recipe.searchKeyword} · ${recipe.basedOn}'
                        : 'Based on your ${recipe.basedOn}',
                    style: const TextStyle(
                      color: Color(0xFF27685F),
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  recipe.title,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                if (recipe.ingredients.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  const Text(
                    'Ingredients',
                    style: TextStyle(
                      color: AppColors.muted,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: recipe.ingredients.take(6).map((line) {
                      final fromFreezer = recipe.ingredientFromFreezer(line);
                      return Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 5,
                        ),
                        decoration: BoxDecoration(
                          color: fromFreezer
                              ? const Color(0xFFE8FFF8)
                              : const Color(0xFFF3F5F9),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: fromFreezer
                                ? AppColors.teal.withValues(alpha: 0.4)
                                : AppColors.line,
                          ),
                        ),
                        child: Text(
                          line,
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: fromFreezer
                                ? FontWeight.w800
                                : FontWeight.w600,
                            color: fromFreezer
                                ? const Color(0xFF27685F)
                                : AppColors.ink,
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  if (recipe.ingredients.length > 6)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        '+ ${recipe.ingredients.length - 6} more — tap View Recipe',
                        style: const TextStyle(
                          color: AppColors.muted,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                ],
                const SizedBox(height: 14),
                Row(
                  children: [
                    const Icon(
                      Icons.schedule,
                      size: 16,
                      color: AppColors.muted,
                    ),
                    const SizedBox(width: 5),
                    Text(
                      '${recipe.minutes} min',
                      style: const TextStyle(color: AppColors.muted),
                    ),
                    const SizedBox(width: 18),
                    const Icon(
                      Icons.local_fire_department_outlined,
                      size: 16,
                      color: AppColors.warning,
                    ),
                    const SizedBox(width: 5),
                    Text(
                      recipe.difficulty,
                      style: const TextStyle(color: AppColors.muted),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    onPressed: () => _openRecipe(context),
                    child: const Text('View Recipe'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class ScreenScaffold extends StatelessWidget {
  const ScreenScaffold({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 98),
      children: [child],
    );
  }
}

class PageHeading extends StatelessWidget {
  const PageHeading({super.key, required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            color: AppColors.ink,
            fontSize: 22,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 5),
        Text(
          subtitle,
          style: const TextStyle(color: AppColors.muted, height: 1.35),
        ),
      ],
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle({
    super.key,
    required this.title,
    this.action,
    this.onAction,
  });

  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: const TextStyle(
              color: AppColors.ink,
              fontSize: 16,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        if (action != null)
          TextButton(
            onPressed: onAction,
            child: Text(action!, style: const TextStyle(color: AppColors.teal)),
          ),
      ],
    );
  }
}

class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.margin = EdgeInsets.zero,
  });

  final Widget child;
  final EdgeInsets padding;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: margin,
      padding: padding,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.line),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F000000),
            offset: Offset(0, 3),
            blurRadius: 8,
          ),
        ],
      ),
      child: child,
    );
  }
}

class EmptyCard extends StatelessWidget {
  const EmptyCard({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        children: [
          Icon(icon, color: AppColors.teal, size: 34),
          const SizedBox(height: 10),
          Text(
            title,
            style: const TextStyle(
              color: AppColors.ink,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted),
          ),
        ],
      ),
    );
  }
}

class SeafoodTile extends StatelessWidget {
  const SeafoodTile({super.key, required this.item});

  final FreezerItem item;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(10),
      child: Row(
        children: [
          ItemVisualPreview(
            iconKey: item.iconKey,
            imagePath: item.imagePath,
            size: 58,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _shortName(item.species),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  WeightUnits.formatStockKg(
                    item.stockKg,
                    item.displayWeightUnit,
                  ),
                  style: const TextStyle(color: AppColors.muted, fontSize: 12),
                ),
              ],
            ),
          ),
          ExpiryPill(days: item.daysRemaining),
        ],
      ),
    );
  }
}

class FreezerTile extends StatelessWidget {
  const FreezerTile({
    super.key,
    required this.item,
    required this.onEdit,
    required this.onDelete,
    required this.onMarkLoss,
  });

  final FreezerItem item;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onMarkLoss;

  @override
  Widget build(BuildContext context) {
    final expired = item.daysRemaining < 0;
    final progress = expired
        ? 0.1
        : (1 - (item.daysRemaining.clamp(0, 7) / 7)).clamp(0.1, 1.0);
    final color = expired
        ? AppColors.danger
        : item.daysRemaining <= 1
            ? AppColors.danger
            : item.daysRemaining <= 3
                ? AppColors.warning
                : AppColors.teal;

    return AppCard(
      margin: const EdgeInsets.only(bottom: 14),
      child: Row(
        children: [
          ItemVisualPreview(
            iconKey: item.iconKey,
            imagePath: item.imagePath,
            size: 72,
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _shortName(item.species),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
                Text(
                  WeightUnits.formatStockKg(
                    item.stockKg,
                    item.displayWeightUnit,
                  ),
                  style: const TextStyle(color: AppColors.muted, fontSize: 12),
                ),
                if (expired)
                  const Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: Text(
                      'Past expiry — mark as spoiled or used',
                      style: TextStyle(
                        color: AppColors.danger,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: LinearProgressIndicator(
                        value: progress.toDouble(),
                        backgroundColor: color.withValues(alpha: 0.15),
                        color: color,
                        minHeight: 4,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      expired ? 'Expired' : '${item.daysRemaining}d left',
                      style: TextStyle(
                        color: color,
                        fontWeight: FontWeight.w800,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Column(
            children: [
              IconButton(
                onPressed: onMarkLoss,
                tooltip: 'Record spoilage or use',
                icon: Icon(
                  Icons.report_outlined,
                  color: expired ? AppColors.danger : const Color(0xFFFF7A1A),
                  size: 20,
                ),
              ),
              IconButton(
                onPressed: onEdit,
                icon: const Icon(
                  Icons.edit_outlined,
                  color: Color(0xFF9AA4B2),
                  size: 20,
                ),
              ),
              IconButton(
                onPressed: onDelete,
                icon: const Icon(
                  Icons.delete_outline,
                  color: Color(0xFFC4CBD6),
                  size: 20,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class SeafoodThumb extends StatelessWidget {
  const SeafoodThumb({super.key, required this.label, this.size = 58});

  final String label;
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = label.toLowerCase().contains('prawn')
        ? const [Color(0xFFE9C46A), Color(0xFF264653)]
        : label.toLowerCase().contains('squid')
        ? const [Color(0xFF9AD5CA), Color(0xFF435B66)]
        : const [Color(0xFFFFB199), Color(0xFF0F766E)];

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: colors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(8),
      ),
      child: const Icon(Icons.set_meal_outlined, color: Colors.white, size: 30),
    );
  }
}

class ExpiryPill extends StatelessWidget {
  const ExpiryPill({super.key, required this.days});

  final int days;

  @override
  Widget build(BuildContext context) {
    final expired = days < 0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: expired ? const Color(0xFFFFEBEE) : const Color(0xFFFFF7EE),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: expired ? const Color(0xFFFFCDD2) : const Color(0xFFFFE2C3),
        ),
      ),
      child: Row(
        children: [
          Icon(
            expired ? Icons.error_outline : Icons.schedule,
            color: expired ? AppColors.danger : AppColors.warning,
            size: 14,
          ),
          const SizedBox(width: 4),
          Text(
            expired ? 'Expired' : '${days}d',
            style: TextStyle(
              color: expired ? AppColors.danger : AppColors.warning,
              fontWeight: FontWeight.w900,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class QuickActionCard extends StatefulWidget {
  const QuickActionCard({
    super.key,
    required this.label,
    required this.icon,
    required this.color,
    required this.onTap,
    this.accentColor,
  });

  final String label;
  final IconData icon;
  final Color color;
  final Color? accentColor;
  final VoidCallback onTap;

  @override
  State<QuickActionCard> createState() => _QuickActionCardState();
}

class _QuickActionCardState extends State<QuickActionCard> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final accent = widget.accentColor ?? widget.color;
    return GestureDetector(
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) => setState(() => _pressed = false),
      onTapCancel: () => setState(() => _pressed = false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _pressed ? 0.96 : 1,
        duration: const Duration(milliseconds: 120),
        child: Container(
          height: 96,
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [widget.color, accent],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(14),
            boxShadow: [
              BoxShadow(
                color: widget.color.withValues(alpha: 0.35),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(widget.icon, color: Colors.white, size: 20),
              ),
              const Spacer(),
              Text(
                widget.label,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SearchBox extends StatelessWidget {
  const SearchBox({super.key});

  @override
  Widget build(BuildContext context) {
    return TextField(
      decoration: InputDecoration(
        prefixIcon: const Icon(Icons.search, color: Color(0xFF9AA4B2)),
        hintText: 'Search items...',
        hintStyle: const TextStyle(color: Color(0xFF9AA4B2)),
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(vertical: 12),
        enabledBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: AppColors.line),
          borderRadius: BorderRadius.circular(8),
        ),
        focusedBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: AppColors.teal),
          borderRadius: BorderRadius.circular(8),
        ),
      ),
    );
  }
}

class FormFieldBox extends StatelessWidget {
  const FormFieldBox({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.prefix,
    this.suffix,
    this.suffixIcon,
    this.obscureText = false,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final String? prefix;
  final String? suffix;
  final IconData? suffixIcon;
  final bool obscureText;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: AppColors.muted,
              fontSize: 11,
              fontWeight: FontWeight.w900,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 7),
          TextField(
            controller: controller,
            obscureText: obscureText,
            onChanged: (_) => (context as Element).markNeedsBuild(),
            decoration: InputDecoration(
              hintText: hint,
              prefixText: prefix,
              suffixText: suffix,
              suffixIcon: suffixIcon == null
                  ? null
                  : Icon(suffixIcon, size: 18),
              filled: true,
              fillColor: const Color(0xFFFAFBFC),
              enabledBorder: OutlineInputBorder(
                borderSide: const BorderSide(color: AppColors.line),
                borderRadius: BorderRadius.circular(8),
              ),
              focusedBorder: OutlineInputBorder(
                borderSide: const BorderSide(color: AppColors.teal),
                borderRadius: BorderRadius.circular(8),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class BottomNavBar extends StatelessWidget {
  const BottomNavBar({
    super.key,
    required this.selectedIndex,
    required this.onSelect,
  });

  final int selectedIndex;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    final items = [
      _NavItem(Icons.home_outlined, 'Home'),
      _NavItem(Icons.ac_unit_outlined, 'Freezer'),
      _NavItem(Icons.calculate_outlined, 'Compare'),
      _NavItem(Icons.dinner_dining_outlined, 'Recipes'),
    ];

    return BottomAppBar(
      color: Colors.white,
      elevation: 10,
      height: 72,
      shape: const CircularNotchedRectangle(),
      notchMargin: 8,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: List.generate(items.length, (index) {
          final selected = selectedIndex == index;
          final item = items[index];
          return Expanded(
            child: InkWell(
              onTap: () => onSelect(index),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    item.icon,
                    color: selected ? AppColors.teal : const Color(0xFF9AA4B2),
                    size: 21,
                  ),
                  const SizedBox(height: 3),
                  Text(
                    item.label,
                    style: TextStyle(
                      color: selected
                          ? AppColors.teal
                          : const Color(0xFF9AA4B2),
                      fontSize: 10,
                      fontWeight: selected ? FontWeight.w900 : FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          );
        }),
      ),
    );
  }
}

class _NavItem {
  const _NavItem(this.icon, this.label);

  final IconData icon;
  final String label;
}

class SeafoodIconOption {
  const SeafoodIconOption(this.key, this.label, this.emoji, this.icon);

  final String key;
  final String label;
  final String emoji;
  final IconData icon;
}

class SeafoodIconOptions {
  static const all = [
    SeafoodIconOption('fish', 'Fish', '🐟', Icons.phishing_rounded),
    SeafoodIconOption('prawn', 'Prawn', '🦐', Icons.set_meal_outlined),
    SeafoodIconOption('crab', 'Crab', '🦀', Icons.bubble_chart_outlined),
    SeafoodIconOption('squid', 'Squid', '🦑', Icons.water_outlined),
    SeafoodIconOption('shellfish', 'Shellfish', '🐚', Icons.spa_outlined),
  ];

  static SeafoodIconOption? find(String key) {
    for (final option in all) {
      if (option.key == key) return option;
    }
    return null;
  }
}

class ItemVisualPreview extends StatelessWidget {
  const ItemVisualPreview({
    super.key,
    required this.iconKey,
    this.imagePath,
    this.size = 72,
  });

  final String iconKey;
  final String? imagePath;
  final double size;

  @override
  Widget build(BuildContext context) {
    final file = imagePath == null ? null : File(imagePath!);
    if (file != null && file.existsSync()) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.file(file, width: size, height: size, fit: BoxFit.cover),
      );
    }

    final option = SeafoodIconOptions.find(iconKey) ?? SeafoodIconOptions.all.first;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            AppColors.teal.withValues(alpha: 0.85),
            AppColors.navy,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(option.emoji, style: TextStyle(fontSize: size * 0.34)),
          if (size >= 72)
            Icon(option.icon, color: Colors.white70, size: size * 0.22),
        ],
      ),
    );
  }
}

class ReceiptReviewSheet extends StatelessWidget {
  const ReceiptReviewSheet({super.key, required this.receipt});

  final ParsedReceipt receipt;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Review scanned receipt',
            style: TextStyle(
              color: AppColors.ink,
              fontSize: 20,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Purchase date: ${_formatDate(receipt.purchaseDate)} · Expiry recommendation: ${FreezerService.defaultShelfLifeDays} days',
            style: const TextStyle(color: AppColors.muted, fontSize: 12),
          ),
          const SizedBox(height: 14),
          for (final item in receipt.items)
            Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.line),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.species,
                          style: const TextStyle(
                            color: AppColors.ink,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          '${item.quantityKg.toStringAsFixed(2)} kg',
                          style: const TextStyle(color: AppColors.muted),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    'RM ${item.totalPrice.toStringAsFixed(2)}',
                    style: const TextStyle(
                      color: AppColors.teal,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: const Text('Cancel'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: const Text('Add to Freezer'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

String _shortName(String value) {
  return value.length <= 14 ? value : '${value.substring(0, 12)}...';
}

String _formatDate(DateTime date) {
  return '${date.year.toString().padLeft(4, '0')}-'
      '${date.month.toString().padLeft(2, '0')}-'
      '${date.day.toString().padLeft(2, '0')}';
}
