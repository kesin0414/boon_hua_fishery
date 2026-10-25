import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_cropper/image_cropper.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';

import 'services/recipe_suggestion_service.dart';
import 'services/seafood_identify_service.dart';
import 'theme/app_colors.dart';
import 'models/freezer_item.dart';

class SeafoodIdentifyScreen extends StatefulWidget {
  const SeafoodIdentifyScreen({super.key});

  @override
  State<SeafoodIdentifyScreen> createState() => _SeafoodIdentifyScreenState();
}

class _SeafoodIdentifyScreenState extends State<SeafoodIdentifyScreen> {
  final _picker = ImagePicker();
  final _identifyService = SeafoodIdentifyService();
  final _recipeService = RecipeSuggestionService();

  File? _photo;
  bool _busy = false;
  String? _error;
  SeafoodIdentifyResult? _result;
  List<RecipeSuggestion> _recipes = const [];
  bool _loadingRecipes = false;

  Future<void> _pick(ImageSource source) async {
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

    final image = await _picker.pickImage(
      source: source,
      imageQuality: 92,
      maxWidth: 2400,
      preferredCameraDevice: CameraDevice.rear,
    );
    if (image == null) return;

    final cropped = await _cropPhoto(image.path);
    if (cropped == null) return;

    setState(() {
      _photo = cropped;
      _error = null;
      _result = null;
      _recipes = const [];
    });
  }

  Future<File?> _cropPhoto(String sourcePath) async {
    try {
      // Avoid racing the camera activity teardown on Android.
      await Future<void>.delayed(const Duration(milliseconds: 350));
      final cropped = await ImageCropper().cropImage(
        sourcePath: sourcePath,
        compressFormat: ImageCompressFormat.jpg,
        compressQuality: 88,
        maxWidth: 1600,
        maxHeight: 1600,
        uiSettings: [
          AndroidUiSettings(
            toolbarTitle: 'Crop seafood',
            toolbarColor: AppColors.navy,
            toolbarWidgetColor: Colors.white,
            activeControlsWidgetColor: AppColors.teal,
            initAspectRatio: CropAspectRatioPreset.original,
            lockAspectRatio: false,
            hideBottomControls: false,
            aspectRatioPresets: const [
              CropAspectRatioPreset.original,
              CropAspectRatioPreset.ratio4x3,
              CropAspectRatioPreset.square,
            ],
          ),
          IOSUiSettings(
            title: 'Crop seafood',
            doneButtonTitle: 'Use',
            cancelButtonTitle: 'Cancel',
            aspectRatioLockEnabled: false,
            aspectRatioPresets: const [
              CropAspectRatioPreset.original,
              CropAspectRatioPreset.ratio4x3,
              CropAspectRatioPreset.square,
            ],
          ),
        ],
      );
      if (cropped == null) return null;
      return File(cropped.path);
    } catch (_) {
      // Fall back to the uncropped capture if the crop UI fails.
      return File(sourcePath);
    }
  }

  Future<void> _recrop() async {
    final photo = _photo;
    if (photo == null || _busy) return;
    final cropped = await _cropPhoto(photo.path);
    if (cropped == null) return;
    setState(() {
      _photo = cropped;
      _error = null;
      _result = null;
      _recipes = const [];
    });
  }

  Future<void> _identify() async {
    final photo = _photo;
    if (photo == null) return;

    setState(() {
      _busy = true;
      _error = null;
      _result = null;
      _recipes = const [];
    });

    try {
      final result = await _identifyService.identifyFromFile(photo);
      if (!mounted) return;
      setState(() => _result = result);
      await _loadRecipesFor(result.species);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _loadRecipesFor(String species) async {
    final name = species.trim();
    if (name.isEmpty || name.toLowerCase() == 'unknown seafood') return;

    setState(() => _loadingRecipes = true);
    try {
      final fakeItem = FreezerItem(
        species: name,
        stockKg: 0.5,
        purchaseDate: DateTime.now(),
        bestBeforeDate: DateTime.now().add(const Duration(days: 3)),
        pricePerKg: 0,
        iconKey: 'fish',
      );
      final suggest = await _recipeService.suggestRecipes([fakeItem]);
      if (!mounted) return;
      setState(() {
        _recipes = suggest.recipes
            .where((recipe) => recipe.matchesIngredientFilter(name))
            .take(4)
            .toList();
        if (_recipes.isEmpty) {
          _recipes = suggest.recipes.take(3).toList();
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _recipes = const []);
    } finally {
      if (mounted) setState(() => _loadingRecipes = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.page,
      appBar: AppBar(
        backgroundColor: AppColors.navy,
        foregroundColor: Colors.white,
        title: const Text(
          'Identify seafood',
          style: TextStyle(fontWeight: FontWeight.w900),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 28),
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF8E7),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFFFFE0A3)),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Preview feature — not fully developed yet',
                  style: TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w900,
                    fontSize: 14,
                  ),
                ),
                SizedBox(height: 8),
                Text(
                  'Results are not always 100% accurate. Use this as a helpful hint only, and confirm the seafood yourself before cooking.',
                  style: TextStyle(color: AppColors.ink, height: 1.4, fontSize: 13),
                ),
                SizedBox(height: 8),
                Text(
                  'Crop tightly around one seafood for better results — avoid mixed piles, ice glare, and blurry photos.',
                  style: TextStyle(color: AppColors.ink, height: 1.4, fontSize: 13),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            'Photo tips',
            style: TextStyle(
              color: AppColors.ink,
              fontWeight: FontWeight.w900,
              fontSize: 15,
            ),
          ),
          const SizedBox(height: 8),
          const _TipRow(icon: Icons.check_circle_outline, text: 'Crop so one clear fish, prawn, crab, or squid fills the frame'),
          const _TipRow(icon: Icons.cancel_outlined, text: 'No mixed pile of different seafood'),
          const _TipRow(icon: Icons.cancel_outlined, text: 'No strong ice glare or reflection'),
          const _TipRow(icon: Icons.cancel_outlined, text: 'No blurry or dark photos'),
          const SizedBox(height: 16),
          if (_photo != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: AspectRatio(
                aspectRatio: 4 / 3,
                child: Image.file(_photo!, fit: BoxFit.cover),
              ),
            )
          else
            Container(
              height: 180,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.line),
              ),
              child: const Center(
                child: Text(
                  'Take or choose a seafood photo',
                  style: TextStyle(color: AppColors.muted, fontWeight: FontWeight.w700),
                ),
              ),
            ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : () => _pick(ImageSource.camera),
                  icon: const Icon(Icons.photo_camera_outlined),
                  label: const Text('Camera'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : () => _pick(ImageSource.gallery),
                  icon: const Icon(Icons.photo_library_outlined),
                  label: const Text('Gallery'),
                ),
              ),
            ],
          ),
          if (_photo != null) ...[
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _busy ? null : _recrop,
                icon: const Icon(Icons.crop),
                label: const Text('Crop photo again'),
              ),
            ),
          ],
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: AppColors.teal),
              onPressed: _busy || _photo == null ? null : _identify,
              icon: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.search),
              label: Text(_busy ? 'Identifying…' : 'Identify seafood'),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 14),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF1EF),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFFFD0C8)),
              ),
              child: Text(
                _error!,
                style: const TextStyle(color: AppColors.danger, height: 1.35),
              ),
            ),
          ],
          if (_result != null) ...[
            const SizedBox(height: 18),
            _ResultCard(result: _result!),
            const SizedBox(height: 14),
            const Text(
              'What you can cook',
              style: TextStyle(
                color: AppColors.ink,
                fontWeight: FontWeight.w900,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 8),
            if (_result!.dishIdeas.isNotEmpty)
              ..._result!.dishIdeas.map(
                (dish) => Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.line),
                  ),
                  child: Text(
                    dish,
                    style: const TextStyle(
                      color: AppColors.ink,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            if (_loadingRecipes)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_recipes.isNotEmpty) ...[
              const SizedBox(height: 8),
              const Text(
                'Recipe ideas from Boon Hua',
                style: TextStyle(
                  color: AppColors.ink,
                  fontWeight: FontWeight.w900,
                  fontSize: 15,
                ),
              ),
              const SizedBox(height: 8),
              ..._recipes.map(
                (recipe) => Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.line),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${recipe.imageEmoji} ${recipe.title}',
                        style: const TextStyle(
                          color: AppColors.ink,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${recipe.minutes} min · ${recipe.difficulty}',
                        style: const TextStyle(color: AppColors.muted, fontSize: 12),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _TipRow extends StatelessWidget {
  const _TipRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final ok = icon == Icons.check_circle_outline;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: ok ? AppColors.teal : AppColors.danger),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(color: AppColors.ink, fontSize: 13, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

class _ResultCard extends StatelessWidget {
  const _ResultCard({required this.result});

  final SeafoodIdentifyResult result;

  @override
  Widget build(BuildContext context) {
    final pct = (result.confidence * 100).clamp(0, 100).toStringAsFixed(0);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Possible match',
            style: TextStyle(color: AppColors.muted, fontSize: 12, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            result.species,
            style: const TextStyle(
              color: AppColors.ink,
              fontSize: 20,
              fontWeight: FontWeight.w900,
            ),
          ),
          if (result.commonName.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              result.commonName,
              style: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w600),
            ),
          ],
          const SizedBox(height: 10),
          Text(
            'Confidence about $pct% · ${result.category}',
            style: const TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          Text(
            result.disclaimer,
            style: const TextStyle(color: AppColors.muted, height: 1.35, fontSize: 12),
          ),
          if (result.photoLooksPoor || result.qualityNote.isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF1EF),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                result.qualityNote.isNotEmpty
                    ? result.qualityNote
                    : 'Photo quality looks weak (mixed pile, ice glare, or blur). Try one clear seafood photo.',
                style: const TextStyle(color: AppColors.danger, fontSize: 12, height: 1.35),
              ),
            ),
          ],
          const SizedBox(height: 10),
          Text(
            result.statusNote,
            style: const TextStyle(
              color: AppColors.warning,
              fontSize: 12,
              fontWeight: FontWeight.w700,
              height: 1.35,
            ),
          ),
        ],
      ),
    );
  }
}
