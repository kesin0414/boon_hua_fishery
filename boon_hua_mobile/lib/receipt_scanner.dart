import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';

import 'models/freezer_item.dart';
import 'models/price_history_entry.dart';

class ReceiptItem {
  const ReceiptItem({
    required this.species,
    required this.quantityKg,
    required this.totalPrice,
    required this.pricePerKg,
  });

  final String species;
  final double quantityKg;
  final double totalPrice;
  final double pricePerKg;
}

class ParsedReceipt {
  const ParsedReceipt({
    required this.rawText,
    required this.purchaseDate,
    required this.items,
  });

  final String rawText;
  final DateTime purchaseDate;
  final List<ReceiptItem> items;

  double get totalAmount {
    return items.fold(0, (sum, item) => sum + item.totalPrice);
  }
}

class ScanResult {
  const ScanResult({
    this.receipt,
    this.errorMessage,
    this.cancelled = false,
  });

  final ParsedReceipt? receipt;
  final String? errorMessage;
  final bool cancelled;

  bool get isSuccess => receipt != null && receipt!.items.isNotEmpty;
}

class ReceiptParser {
  ReceiptParser({PriceNormalizer normalizer = const PriceNormalizer()})
    : _normalizer = normalizer;

  final PriceNormalizer _normalizer;

  static const _seafoodHints = [
    'fish',
    'prawn',
    'shrimp',
    'squid',
    'sotong',
    'crab',
    'salmon',
    'tuna',
    'mackerel',
    'tilapia',
    'clam',
    'mussel',
    'lobster',
    'cuttle',
    'ikan',
    'udang',
    'ketam',
  ];

  ParsedReceipt parse(String rawText) {
    final lines = rawText
        .split(RegExp(r'\r?\n'))
        .map((line) => line.trim())
        .where((line) => line.isNotEmpty)
        .toList();

    final items = <ReceiptItem>[];
    final seen = <String>{};

    for (final line in lines) {
      final item = _parseLine(line);
      if (item == null) continue;
      final key = item.species.toLowerCase();
      if (seen.add(key)) items.add(item);
    }

    if (items.isEmpty) {
      final fallback = _parseLooseBlocks(rawText);
      for (final item in fallback) {
        final key = item.species.toLowerCase();
        if (seen.add(key)) items.add(item);
      }
    }

    return ParsedReceipt(
      rawText: rawText,
      purchaseDate: _extractDate(rawText) ?? DateTime.now(),
      items: items,
    );
  }

  List<ReceiptItem> _parseLooseBlocks(String text) {
    final items = <ReceiptItem>[];
    final pricePattern = RegExp(
      r'(?:RM\s*)?([0-9]+(?:\.[0-9]{1,2})?)',
      caseSensitive: false,
    );
    final weightPattern = RegExp(
      r'([0-9]+(?:\.[0-9]+)?)\s*(kg|kgs|g|gram|grams)\b',
      caseSensitive: false,
    );

    for (final line in text.split(RegExp(r'\r?\n'))) {
      final trimmed = line.trim();
      if (trimmed.length < 4) continue;
      final lower = trimmed.toLowerCase();
      if (!_looksLikeSeafoodLine(lower)) continue;

      final prices = pricePattern
          .allMatches(trimmed)
          .map((m) => double.tryParse(m.group(1)!))
          .whereType<double>()
          .toList();
      if (prices.isEmpty) continue;

      final weightMatch = weightPattern.firstMatch(trimmed);
      double quantityKg = 1;
      if (weightMatch != null) {
        final amount = double.tryParse(weightMatch.group(1)!) ?? 1;
        final unit = weightMatch.group(2)!.toLowerCase();
        quantityKg = unit.startsWith('g') ? amount / 1000 : amount;
      }

      final species = _extractSpeciesName(trimmed);
      if (species.isEmpty) continue;

      final totalPrice = prices.last;
      items.add(
        ReceiptItem(
          species: species,
          quantityKg: quantityKg,
          totalPrice: totalPrice,
          pricePerKg: _normalizer.calculatePricePerKg(
            totalPrice: totalPrice,
            quantityKg: quantityKg,
          ),
        ),
      );
    }
    return items;
  }

  bool _looksLikeSeafoodLine(String lower) {
    if (_seafoodHints.any(lower.contains)) return true;
    return RegExp(r'^[a-zA-Z ]{3,}$').hasMatch(lower) &&
        !lower.contains('total') &&
        !lower.contains('subtotal') &&
        !lower.contains('tax') &&
        !lower.contains('change');
  }

  String _extractSpeciesName(String line) {
    var cleaned = line
        .replaceAll(
          RegExp(
            r'(?:RM\s*)?[0-9]+(?:\.[0-9]{1,2})?',
            caseSensitive: false,
          ),
          ' ',
        )
        .replaceAll(
          RegExp(
            r'[0-9]+(?:\.[0-9]+)?\s*(?:kg|kgs|g|gram|grams)\b',
            caseSensitive: false,
          ),
          ' ',
        )
        .replaceAll(RegExp(r'[^a-zA-Z ]'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();

    if (cleaned.length < 3) return '';
    return cleaned
        .split(' ')
        .where((part) => part.length > 1)
        .take(4)
        .join(' ')
        .trim();
  }

  ReceiptItem? _parseLine(String line) {
    final patterns = [
      RegExp(
        r'^([A-Za-z][A-Za-z ]{1,30}?)\s+([0-9]+(?:\.[0-9]+)?)\s*(?:kg|kgs)\s+(?:RM\s*)?([0-9]+(?:\.[0-9]{1,2})?)$',
        caseSensitive: false,
      ),
      RegExp(
        r'^([A-Za-z][A-Za-z ]{1,30}?)\s+([0-9]+(?:\.[0-9]+)?)\s*(?:g|gram|grams)\s+(?:RM\s*)?([0-9]+(?:\.[0-9]{1,2})?)$',
        caseSensitive: false,
      ),
      RegExp(
        r'^([A-Za-z][A-Za-z ]{1,30}?)\s+(?:RM\s*)?([0-9]+(?:\.[0-9]{1,2})?)\s*/\s*kg$',
        caseSensitive: false,
      ),
      RegExp(
        r'^([A-Za-z][A-Za-z ]{1,30}?)\s+(?:RM\s*)?([0-9]+(?:\.[0-9]{1,2})?)$',
        caseSensitive: false,
      ),
    ];

    for (final pattern in patterns) {
      final match = pattern.firstMatch(line.trim());
      if (match == null) continue;

      final species = match.group(1)!.trim();
      if (!_looksLikeSeafoodLine(species.toLowerCase()) &&
          species.split(' ').length == 1 &&
          species.length < 4) {
        continue;
      }

      if (pattern.pattern.contains('/\\s*kg')) {
        final pricePerKg = double.tryParse(match.group(2)!) ?? 0;
        return ReceiptItem(
          species: species,
          quantityKg: 1,
          totalPrice: pricePerKg,
          pricePerKg: pricePerKg,
        );
      }

      if (pattern.pattern.contains('gram')) {
        final grams = double.tryParse(match.group(2)!) ?? 0;
        final totalPrice = double.tryParse(match.group(3)!) ?? 0;
        final quantityKg = grams / 1000;
        return ReceiptItem(
          species: species,
          quantityKg: quantityKg,
          totalPrice: totalPrice,
          pricePerKg: _normalizer.calculatePricePerKg(
            totalPrice: totalPrice,
            quantityKg: quantityKg,
          ),
        );
      }

      if (pattern.pattern.contains('kg')) {
        final quantityKg = double.tryParse(match.group(2)!) ?? 0;
        final totalPrice = double.tryParse(match.group(3)!) ?? 0;
        return ReceiptItem(
          species: species,
          quantityKg: quantityKg,
          totalPrice: totalPrice,
          pricePerKg: _normalizer.calculatePricePerKg(
            totalPrice: totalPrice,
            quantityKg: quantityKg,
          ),
        );
      }

      final totalPrice = double.tryParse(match.group(2)!) ?? 0;
      return ReceiptItem(
        species: species,
        quantityKg: 1,
        totalPrice: totalPrice,
        pricePerKg: totalPrice,
      );
    }

    return null;
  }

  DateTime? _extractDate(String text) {
    final patterns = [
      RegExp(r'(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})'),
      RegExp(r'(\d{4})[/-](\d{1,2})[/-](\d{1,2})'),
    ];

    for (final pattern in patterns) {
      final match = pattern.firstMatch(text);
      if (match == null) continue;

      if (pattern.pattern.startsWith(r'(\d{4})')) {
        final year = int.tryParse(match.group(1)!);
        final month = int.tryParse(match.group(2)!);
        final day = int.tryParse(match.group(3)!);
        if (year != null && month != null && day != null) {
          return DateTime(year, month, day);
        }
      } else {
        final day = int.tryParse(match.group(1)!);
        final month = int.tryParse(match.group(2)!);
        final yearValue = int.tryParse(match.group(3)!);
        if (day != null && month != null && yearValue != null) {
          final year = yearValue < 100 ? 2000 + yearValue : yearValue;
          return DateTime(year, month, day);
        }
      }
    }
    return null;
  }
}

class FreezerService {
  static const defaultShelfLifeDays = 30;

  List<FreezerItem> createItemsFromReceipt(ParsedReceipt receipt) {
    return receipt.items.map((item) {
      return FreezerItem(
        species: item.species,
        stockKg: item.quantityKg,
        purchaseDate: receipt.purchaseDate,
        bestBeforeDate: receipt.purchaseDate.add(
          const Duration(days: defaultShelfLifeDays),
        ),
        pricePerKg: item.pricePerKg,
        iconKey: _iconKeyForSpecies(item.species),
      );
    }).toList();
  }

  String _iconKeyForSpecies(String species) {
    final name = species.toLowerCase();
    if (name.contains('prawn') || name.contains('shrimp') || name.contains('udang')) {
      return 'prawn';
    }
    if (name.contains('crab') || name.contains('ketam')) {
      return 'crab';
    }
    if (name.contains('squid') || name.contains('sotong')) {
      return 'squid';
    }
    if (name.contains('clam') || name.contains('mussel') || name.contains('shell')) {
      return 'shellfish';
    }
    return 'fish';
  }
}

class ReceiptScanner {
  ReceiptScanner({
    ImagePicker? imagePicker,
    TextRecognizer? textRecognizer,
    ReceiptParser? parser,
  }) : _imagePicker = imagePicker ?? ImagePicker(),
       _textRecognizer =
           textRecognizer ??
           TextRecognizer(script: TextRecognitionScript.latin),
       _parser = parser ?? ReceiptParser();

  final ImagePicker _imagePicker;
  final TextRecognizer _textRecognizer;
  final ReceiptParser _parser;

  Future<ScanResult> scanReceipt() async {
    final permission = await Permission.camera.request();
    if (!permission.isGranted) {
      return const ScanResult(
        errorMessage:
            'Camera permission is required to scan receipts. Please allow camera access in settings.',
      );
    }

    final image = await _imagePicker.pickImage(
      source: ImageSource.camera,
      preferredCameraDevice: CameraDevice.rear,
      imageQuality: 85,
    );
    if (image == null) {
      return const ScanResult(cancelled: true);
    }

    try {
      final inputImage = InputImage.fromFilePath(image.path);
      final recognizedText = await _textRecognizer.processImage(inputImage);
      final raw = recognizedText.text.trim();

      if (raw.isEmpty) {
        return const ScanResult(
          errorMessage:
              'No text was detected on the receipt. Try better lighting and hold the receipt flat inside the frame.',
        );
      }

      final parsed = _parser.parse(raw);
      if (parsed.items.isEmpty) {
        return ScanResult(
          errorMessage:
              'Could not read seafood name, weight, or price from this receipt. You can add the item manually in Virtual Freezer.',
          receipt: parsed,
        );
      }

      return ScanResult(receipt: parsed);
    } catch (error) {
      return ScanResult(
        errorMessage: 'Receipt scan failed: $error',
      );
    }
  }

  void dispose() {
    _textRecognizer.close();
  }
}
