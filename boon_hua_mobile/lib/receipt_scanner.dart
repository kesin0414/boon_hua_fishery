import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';
import 'package:image_cropper/image_cropper.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';

import 'models/freezer_item.dart';
import 'models/price_history_entry.dart';
import 'data/seafood_catalog.dart';
import 'services/receipt_ai_ocr_service.dart';
import 'theme/app_colors.dart';

class ReceiptItem {
  const ReceiptItem({
    required this.species,
    required this.quantityKg,
    required this.totalPrice,
    required this.pricePerKg,
    this.confidence = 1.0,
  });

  final String species;
  final double quantityKg;
  final double totalPrice;
  final double pricePerKg;
  /// Evidence-based parse confidence 0–1 (RM/unit/catalog/math — not a random score).
  final double confidence;

  ReceiptItem copyWith({
    String? species,
    double? quantityKg,
    double? totalPrice,
    double? pricePerKg,
    double? confidence,
  }) {
    return ReceiptItem(
      species: species ?? this.species,
      quantityKg: quantityKg ?? this.quantityKg,
      totalPrice: totalPrice ?? this.totalPrice,
      pricePerKg: pricePerKg ?? this.pricePerKg,
      confidence: confidence ?? this.confidence,
    );
  }
}

class ParsedReceipt {
  const ParsedReceipt({
    required this.rawText,
    required this.purchaseDate,
    required this.items,
    this.focusedItemIndex = 0,
  });

  final String rawText;
  final DateTime purchaseDate;
  final List<ReceiptItem> items;
  /// Item index used to prefill Compare after scan (last edited/selected in review).
  final int focusedItemIndex;

  double get totalAmount {
    return items.fold(0, (sum, item) => sum + item.totalPrice);
  }

  /// Average evidence-based parse confidence (0–1) across line items.
  double get parseConfidence {
    if (items.isEmpty) return 0;
    return items.map((i) => i.confidence).reduce((a, b) => a + b) / items.length;
  }

  ParsedReceipt copyWith({
    String? rawText,
    DateTime? purchaseDate,
    List<ReceiptItem>? items,
    int? focusedItemIndex,
  }) {
    return ParsedReceipt(
      rawText: rawText ?? this.rawText,
      purchaseDate: purchaseDate ?? this.purchaseDate,
      items: items ?? this.items,
      focusedItemIndex: focusedItemIndex ?? this.focusedItemIndex,
    );
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

  static final _seafoodHints = SeafoodCatalog.ocrHints;

  /// Build a [ParsedReceipt] from `/receipt/ocr` Gemini JSON.
  static ParsedReceipt parsedReceiptFromAiJson(Map<String, dynamic> json) {
    final parser = ReceiptParser();
    final rawText = (json['rawText'] as String?)?.trim() ?? '';
    final purchaseDate = _parseAiPurchaseDate(json['purchaseDate']) ?? DateTime.now();
    final items = <ReceiptItem>[];
    for (final row in (json['items'] as List<dynamic>? ?? const [])) {
      if (row is! Map) continue;
      final map = Map<String, dynamic>.from(row);
      final species = (map['species'] as String?)?.trim() ?? '';
      if (species.length < 2) continue;
      final quantityKg = (map['quantityKg'] as num?)?.toDouble() ?? 0;
      final totalPrice = (map['totalPrice'] as num?)?.toDouble() ?? 0;
      var pricePerKg = (map['pricePerKg'] as num?)?.toDouble() ?? 0;
      if (quantityKg <= 0 && totalPrice <= 0) continue;
      final qty = quantityKg > 0 ? quantityKg : 1.0;
      if (pricePerKg <= 0) {
        pricePerKg = const PriceNormalizer().calculatePricePerKg(
          totalPrice: totalPrice,
          quantityKg: qty,
        );
      }
      final total = totalPrice > 0 ? totalPrice : pricePerKg * qty;
      final modelConfidence = (map['confidence'] as num?)?.toDouble();
      // Evidence from AI rawText + field consistency (never a flat 0.9).
      final evidenceSource = rawText.isNotEmpty
          ? rawText
          : '$species ${qty}kg RM$total';
      items.add(
        ReceiptItem(
          species: species,
          quantityKg: qty,
          totalPrice: total,
          pricePerKg: pricePerKg,
          confidence: parser._scoreItemConfidence(
            species: species,
            quantityKg: qty,
            totalPrice: total,
            pricePerKg: pricePerKg,
            sourceText: evidenceSource,
            modelConfidence: modelConfidence,
            fromAiVision: true,
          ),
        ),
      );
    }
    return ParsedReceipt(
      rawText: rawText.isNotEmpty ? rawText : jsonEncode(json),
      purchaseDate: purchaseDate,
      items: items,
    );
  }

  static DateTime? _parseAiPurchaseDate(dynamic value) {
    if (value == null) return null;
    final text = '$value'.trim();
    if (text.isEmpty) return null;
    final iso = DateTime.tryParse(text);
    if (iso != null) return DateTime(iso.year, iso.month, iso.day);
    final dmy = RegExp(r'^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})$').firstMatch(text);
    if (dmy != null) {
      final day = int.tryParse(dmy.group(1)!);
      final month = int.tryParse(dmy.group(2)!);
      var year = int.tryParse(dmy.group(3)!);
      if (day == null || month == null || year == null) return null;
      if (year < 100) year += 2000;
      return DateTime(year, month, day);
    }
    return null;
  }

  ParsedReceipt parse(String rawText) {
    final normalizedText = _normalizeOcrText(rawText);
    final lines = normalizedText
        .split(RegExp(r'\r?\n'))
        .map((line) => line.trim())
        .where((line) => line.isNotEmpty)
        .toList();

    final items = <ReceiptItem>[];
    final groupedLines = _groupMultilineEntries(lines);

    for (final line in groupedLines) {
      // One OCR line may contain two seafood rows — parse each window separately.
      for (final item in _parseAllItemsInChunk(line)) {
        _addOrMergeDuplicateSpecies(items, item);
      }
    }

    if (items.isEmpty) {
      final fallback = _parseLooseBlocks(normalizedText);
      for (final item in fallback) {
        _addOrMergeDuplicateSpecies(items, item);
      }
    }

    // Multi-row / out-of-order notes: one window per species so kg+RM stay on the right row.
    final keywordItems = _parseItemsBySpeciesWindows(normalizedText);
    for (final item in keywordItems) {
      final key = item.species.trim().toLowerCase();
      final already = items.any((e) {
        final existing = e.species.trim().toLowerCase();
        return existing == key ||
            existing.contains(key) ||
            key.contains(existing);
      });
      if (already) continue;
      items.add(item);
    }

    return ParsedReceipt(
      rawText: normalizedText,
      purchaseDate: _extractDate(normalizedText) ?? DateTime.now(),
      items: items,
    );
  }

  static const _weightUnitPattern =
      r'(?:kg|kgs|kilo|kilos|kilogram|kilograms|g|gram|grams)';

  static final _monthNames = <String, int>{
    'jan': 1,
    'january': 1,
    'januari': 1,
    'feb': 2,
    'february': 2,
    'februari': 2,
    'mar': 3,
    'mac': 3,
    'march': 3,
    'apr': 4,
    'april': 4,
    'may': 5,
    'mei': 5,
    'jun': 6,
    'june': 6,
    'jul': 7,
    'july': 7,
    'julai': 7,
    'aug': 8,
    'agos': 8,
    'ogos': 8,
    'august': 8,
    'sep': 9,
    'sept': 9,
    'september': 9,
    'oct': 10,
    'okt': 10,
    'october': 10,
    'oktober': 10,
    'nov': 11,
    'november': 11,
    'dec': 12,
    'dis': 12,
    'december': 12,
    'disember': 12,
  };

  /// Map common OCR letter/digit confusions inside a year token (e.g. J202s → 2026).
  String _repairOcrYearToken(String raw) {
    var year = raw.replaceFirst(RegExp(r'^[^0-9]+'), '');
    year = year
        .replaceAll(RegExp(r'[Oo]'), '0')
        .replaceAll(RegExp(r'[Il|]'), '1')
        .replaceAll(RegExp(r'[Zz]'), '2')
        .replaceAll(RegExp(r'[Bb]'), '8');
    // Trailing handwritten 6 is often read as s/S/g/G.
    year = year.replaceFirst(RegExp(r'[sSgG]$'), '6');
    year = year.replaceAll(RegExp(r'[Ss]'), '5');
    return year;
  }

  /// Fixes common OCR spacing and symbol issues from photos of handwritten notes,
  /// including blurry stakeholder receipts (split "k g", "R M", letter/number mix-ups).
  String _normalizeOcrText(String text) {
    var normalized = text.replaceAll('\r\n', '\n');
    normalized = normalized.replaceAllMapped(
      RegExp(r'\bR\s*M\s*', caseSensitive: false),
      (_) => 'RM',
    );
    // Decimal comma → dot (14,00 / 1,5kg / RM22,50). Allow unit glued on (1,5kg).
    normalized = normalized.replaceAllMapped(
      RegExp(r'(\d+),(\d{1,2})(?=\D|$)'),
      (match) => '${match.group(1)}.${match.group(2)}',
    );
    // RM35-Oo / RM35.Oo / RM35 Oo → RM35.00 (cents read as letters).
    normalized = normalized.replaceAllMapped(
      RegExp(r'(RM\s*\d+)[\-\s.]+[oO0]{2}\b'),
      (match) => '${match.group(1)}.00',
    );
    normalized = normalized.replaceAllMapped(
      RegExp(r'(RM\s*\d+)[\-\s.]([oO0\d])([oO0\d])\b'),
      (match) {
        String dig(String c) =>
            RegExp(r'[oO]').hasMatch(c) ? '0' : c;
        return '${match.group(1)}.${dig(match.group(2)!)}${dig(match.group(3)!)}';
      },
    );
    normalized = normalized.replaceAllMapped(
      RegExp(r'\b([A-Za-z]{2,})0([A-Za-z]{2,})\b'),
      (match) => '${match.group(1)}o${match.group(2)}',
    );
    // Trailing O/o after digits → 0 (RM2O → RM20).
    normalized = normalized.replaceAllMapped(
      RegExp(
        r'(\d+(?:\.\d+)?)[oO](?=\s|(?:kg|kgs|g|gram|grams|RM|/|x|@)\b|$)',
        caseSensitive: false,
      ),
      (match) => '${match.group(1)}0',
    );
    // O between digits → 0 (2O5 → 205).
    normalized = normalized.replaceAllMapped(
      RegExp(r'(\d)[oO](\d)'),
      (match) => '${match.group(1)}0${match.group(2)}',
    );
    normalized = normalized.replaceAllMapped(
      RegExp(r'(\d)[lI|](?=\s*(?:kg|kgs|g|gram|grams)\b)', caseSensitive: false),
      (match) => '${match.group(1)}1',
    );
    normalized = normalized.replaceAllMapped(
      RegExp(r'(^|\s)[lI|](?=\s*(?:kg|kgs)\b)', caseSensitive: false),
      (match) => '${match.group(1)}1',
    );
    normalized = normalized.replaceAllMapped(
      RegExp(r'(\d+(?:\.\d+)?)\s*k\s*g\b', caseSensitive: false),
      (match) => '${match.group(1)}kg',
    );
    normalized = normalized.replaceAllMapped(
      RegExp(r'(\d+(?:\.\d+)?)\s*(?:kq|k9)\b', caseSensitive: false),
      (match) => '${match.group(1)}kg',
    );
    // Grams unit misread: 700q / 700Q → 700g
    normalized = normalized.replaceAllMapped(
      RegExp(r'(\d+(?:\.\d+)?)\s*[qQ]\b'),
      (match) => '${match.group(1)}g',
    );
    // Corrupted year after day/month: "25/10 J202s" / "25/10/J202s" → 25/10/2026
    // Only when the year token still has letters (skip clean ISO 2026-10-25).
    normalized = normalized.replaceAllMapped(
      RegExp(
        r'(?<!\d)(\d{1,2})[/\-](\d{1,2})(?:[/\-\s]+)((?:[A-Za-z]\d[A-Za-z0-9]{1,3})|(?:\d{2,4}[A-Za-z]))\b',
      ),
      (match) {
        final day = match.group(1)!;
        final month = match.group(2)!;
        final repaired = _repairOcrYearToken(match.group(3)!);
        final yearValue = int.tryParse(repaired);
        if (yearValue == null) return match.group(0)!;
        final year = yearValue < 100 ? 2000 + yearValue : yearValue;
        if (year < 2000 || year > 2100) return match.group(0)!;
        return '$day/$month/$year';
      },
    );
    // Soften labeled handwritten fields so keywords stay findable in any order.
    normalized = normalized.replaceAllMapped(
      RegExp(
        r'\b(?:item|species|nama|name|fish|ikan)\s*[:\-]\s*',
        caseSensitive: false,
      ),
      (_) => '',
    );
    normalized = normalized.replaceAllMapped(
      RegExp(
        r'\b(?:weight|berat|qty|quantity|wt)\s*[:\-]\s*',
        caseSensitive: false,
      ),
      (_) => '',
    );
    normalized = normalized.replaceAllMapped(
      RegExp(
        r'\b(?:price|harga|amount|total|cost)\s*[:\-]\s*',
        caseSensitive: false,
      ),
      (_) => '',
    );
    normalized = normalized.replaceAllMapped(
      RegExp(r'[@x×]\s*(?=RM|\d)', caseSensitive: false),
      (_) => '@ ',
    );
    return normalized;
  }

  double? _parseNumber(String? raw) {
    if (raw == null) return null;
    return double.tryParse(raw.trim().replaceAll(',', '.'));
  }

  /// Keyword extract: weight from unit (kg/g/…), price from RM — any order.
  /// [requireRm] is true for handwritten notes (price always tagged RM).
  ({double quantityKg, double totalPrice, double? unitPrice})? _extractWeightAndPrice(
    String line, {
    bool requireRm = false,
  }) {
    final text = _stripAllDates(line.trim());
    if (text.isEmpty) return null;

    final weightMatch = RegExp(
      '(\\d+(?:\\.\\d+)?)\\s*($_weightUnitPattern)\\b',
      caseSensitive: false,
    ).firstMatch(text);
    if (weightMatch == null) return null;

    final rawQty = _parseNumber(weightMatch.group(1));
    if (rawQty == null || rawQty <= 0) return null;

    final unitToken = weightMatch.group(2)!.toLowerCase();
    final quantityKg =
        (unitToken == 'g' || unitToken == 'gram' || unitToken == 'grams')
            ? rawQty / 1000
            : rawQty;

    // Strip weight first so its digits are never read as money.
    var moneyText = text.replaceRange(weightMatch.start, weightMatch.end, ' ');
    moneyText = moneyText
        .replaceAll(RegExp(r'[@x×]\s*', caseSensitive: false), ' ')
        .replaceAll(
          RegExp(r'/\s*$_weightUnitPattern\b', caseSensitive: false),
          ' ',
        )
        .replaceAll(
          RegExp(r'\bper\s*$_weightUnitPattern\b', caseSensitive: false),
          ' ',
        );
    moneyText = moneyText.replaceAll(RegExp(r'\s+'), ' ').trim();

    final rmAmounts = RegExp(
      r'RM\s*(\d+(?:\.\d{1,2})?)',
      caseSensitive: false,
    )
        .allMatches(moneyText)
        .map((m) => _parseNumber(m.group(1)))
        .whereType<double>()
        .where((n) => n > 0)
        .toList();

    final isPerKg = RegExp(
      r'(?:/|per)\s*(?:kg|kgs|kilo)\b',
      caseSensitive: false,
    ).hasMatch(text);

    double? totalPrice;
    double? unitPrice;

    if (rmAmounts.isNotEmpty) {
      if (rmAmounts.length >= 2) {
        unitPrice = rmAmounts.first;
        totalPrice = rmAmounts.last;
      } else if (isPerKg) {
        unitPrice = rmAmounts.first;
        totalPrice = unitPrice * quantityKg;
      } else {
        totalPrice = rmAmounts.first;
      }
    } else if (!requireRm) {
      final bareAmounts = RegExp(r'(?<![A-Za-z/])(\d+(?:\.\d{1,2})?)(?!\d)')
          .allMatches(moneyText)
          .map((m) => _parseNumber(m.group(1)))
          .whereType<double>()
          .where((n) => n > 0)
          .toList();
      if (bareAmounts.length >= 2) {
        final first = bareAmounts.first;
        final last = bareAmounts.last;
        final product = first * quantityKg;
        if ((product - last).abs() <= 0.05 ||
            (last > 0 && (product - last).abs() / last <= 0.02)) {
          unitPrice = first;
          totalPrice = last;
        } else if ((product - first).abs() <= 0.05) {
          unitPrice = last;
          totalPrice = first;
        } else {
          totalPrice = bareAmounts.reduce((a, b) => a > b ? a : b);
        }
      } else if (bareAmounts.isNotEmpty) {
        if (isPerKg) {
          unitPrice = bareAmounts.first;
          totalPrice = unitPrice * quantityKg;
        } else {
          totalPrice = bareAmounts.last;
        }
      }
    }

    if (totalPrice == null || totalPrice <= 0) return null;

    return (
      quantityKg: quantityKg,
      totalPrice: totalPrice,
      unitPrice: unitPrice,
    );
  }

  /// Strips list numbers and any dates before line parsing.
  String _normalizeLine(String line) {
    var cleaned = line.trim();
    cleaned = cleaned.replaceFirst(RegExp(r'^\d+[\.\)\-:]\s*'), '');
    cleaned = cleaned.replaceFirst(RegExp(r'^[-•*]\s*'), '');
    cleaned = _stripAllDates(cleaned);
    return cleaned.trim();
  }

  /// Removes date tokens anywhere in text (handwritten order is free-form).
  String _stripAllDates(String text) {
    var cleaned = text;
    cleaned = cleaned.replaceAll(
      RegExp(
        r'\b(?:date|tarikh)\s*[:.\-]?\s*',
        caseSensitive: false,
      ),
      ' ',
    );
    cleaned = cleaned.replaceAll(
      RegExp(
        r'\b\d{1,2}\s+(?:jan(?:uari)?|feb(?:ruari)?|mac|mar(?:ch)?|apr(?:il)?|may|mei|jun(?:e)?|jul(?:y|ai)?|aug(?:ust)?|agos|ogos|sep(?:t(?:ember)?)?|oct(?:ober)?|okt(?:ober)?|nov(?:ember)?|dec(?:ember)?|dis(?:ember)?)\.?\s+\d{2,4}\b',
        caseSensitive: false,
      ),
      ' ',
    );
    cleaned = cleaned.replaceAll(
      RegExp(r'\b\d{4}[./\-]\d{1,2}[./\-]\d{1,2}\b'),
      ' ',
    );
    cleaned = cleaned.replaceAll(
      RegExp(r'\b\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}\b'),
      ' ',
    );
    cleaned = cleaned.replaceAll(
      RegExp(r'\b\d{1,2}\.\d{1,2}\.\d{2,4}\b'),
      ' ',
    );
    cleaned = cleaned.replaceAll(
      RegExp(r'\b\d{1,2}[/\-]\d{1,2}\b'),
      ' ',
    );
    return cleaned.replaceAll(RegExp(r'\s+'), ' ').trim();
  }

  bool _isDateOnlyLine(String line) {
    final trimmed = line.trim();
    if (RegExp(r'^(?:date|tarikh)\s*[:.\-]?', caseSensitive: false)
        .hasMatch(trimmed)) {
      return true;
    }
    // Do not treat money like 7.00 / 98.00 as dates (dot decimals).
    if (RegExp(r'^\d+\.\d{2}$').hasMatch(trimmed)) {
      return false;
    }
    if (RegExp(r'^\d{1,2}[/\-]\d{1,2}(?:[/\-]\d{2,4})?$').hasMatch(trimmed)) {
      return true;
    }
    // Dot-separated dates need a year (25.10.2026), not money decimals.
    if (RegExp(r'^\d{1,2}\.\d{1,2}\.\d{2,4}$').hasMatch(trimmed)) {
      return true;
    }
    if (RegExp(r'^\d{4}[./\-]\d{1,2}[./\-]\d{1,2}$').hasMatch(trimmed)) {
      return true;
    }
    final monthNamePattern = _monthNames.keys.join('|');
    return RegExp(
      '^(?:date|tarikh)?\\s*[:.\\-]?\\s*\\d{1,2}\\s+(?:$monthNamePattern)\\.?\\s+\\d{2,4}\$',
      caseSensitive: false,
    ).hasMatch(trimmed);
  }

  /// Wet-market receipts often split species, weight, and price across lines
  /// (any order: name / kg|g / RM).
  List<String> _groupMultilineEntries(List<String> lines) {
    final result = <String>[];
    final buffer = <String>[];

    void flush() {
      if (buffer.isEmpty) return;
      result.add(buffer.join(' '));
      buffer.clear();
    }

    bool isContinuableFigure(String line) {
      if (_looksLikePriceWeightLine(line) || _looksLikeInvoiceFigureLine(line)) {
        return true;
      }
      // Bare invoice money column (7.00 / 98.00) with no unit or RM.
      return RegExp(r'^(?:RM\s*)?\d+(?:\.\d{1,2})?$', caseSensitive: false)
          .hasMatch(line.trim());
    }

    for (final line in lines) {
      if (_isReceiptMetadataLine(line) || _isDateOnlyLine(line)) {
        flush();
        continue;
      }

      if (_parseLine(line) != null && _hasInvoiceAmount(line)) {
        flush();
        result.add(line);
        continue;
      }

      // Complete handwritten line already has name + unit + RM.
      if (_parseLine(line) != null) {
        flush();
        result.add(line);
        continue;
      }

      if (_looksLikeNameOnlyLine(line)) {
        flush();
        buffer.add(line);
        continue;
      }

      if (buffer.isNotEmpty && isContinuableFigure(line)) {
        buffer.add(line);
        final joined = buffer.join(' ');
        final invoiceReady =
            _parseInvoiceLine(joined) != null && _hasInvoiceAmount(joined);
        final noteReady = _extractWeightAndPrice(joined, requireRm: true) != null &&
            _extractSpeciesName(joined).length >= 3;
        if (invoiceReady || noteReady) {
          flush();
        }
        continue;
      }

      flush();
      if (line.trim().isNotEmpty) result.add(line);
    }

    flush();
    return result;
  }

  bool _isReceiptMetadataLine(String line) {
    final lower = line.toLowerCase();
    const markers = [
      'total',
      'subtotal',
      'tax',
      'change',
      'cash',
      'thank',
      'invoice',
      'item code',
      'description',
      'price/unit',
      'price / unit',
      'discount',
      'amount',
      'malaysian ringgit',
      'maybank',
      'authorised',
      'authorized',
      'goods sold',
      'notes',
      'attn',
      'terms',
      'page',
      'boon hua',
      'pasar borong',
      'batu caves',
      'email',
      'your ref',
      'fax',
      'date',
      'tarikh',
      'tel',
      'phone',
      'trading',
    ];
    return markers.any(lower.contains);
  }

  /// Qty / unit price / amount columns printed under the Boon Hua invoice table.
  bool _looksLikeInvoiceFigureLine(String line) {
    final trimmed = line.trim();
    return RegExp(
      r'^(?:RM\s*)?\d+(?:\.\d+)?(?:\s*(?:kg|kgs))?$',
      caseSensitive: false,
    ).hasMatch(trimmed);
  }

  /// True when an invoice row includes the Amount column, not only Price/Unit.
  bool _hasInvoiceAmount(String line) {
    final prepared = _prepareInvoiceText(line);
    return RegExp(
      r'[A-Za-z].+\s+\d+(?:\.\d+)?\s*(?:kg|kgs)\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?',
      caseSensitive: false,
    ).hasMatch(prepared);
  }

  String _prepareInvoiceText(String line) {
    var text = line.trim();
    text = text.replaceFirst(RegExp(r'^\d{1,3}\s+(?=[A-Za-z])'), '');
    text = text.replaceFirst(RegExp(r'^[A-Z]{2,}[0-9]{2,}\s+', caseSensitive: false), '');
    text = text.replaceAll(RegExp(r'\bRM\s*', caseSensitive: false), '');
    return text.replaceAll(RegExp(r'\s+'), ' ').trim();
  }

  /// Printed invoice row: Description, Qty KG, Price/Unit, optional Discount, Amount.
  ReceiptItem? _parseInvoiceLine(String line) {
    final prepared = _prepareInvoiceText(line);
    final match = RegExp(
      r'^([A-Za-z][A-Za-z ]+?)\s+(\d+(?:\.\d+)?)\s*(?:kg|kgs)\s+(\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?(?:\s+(\d+(?:\.\d+)?))?$',
      caseSensitive: false,
    ).firstMatch(prepared);
    if (match == null) return null;

    final species = match.group(1)!.trim();
    if (species.length < 3 || _isReceiptMetadataLine(species)) return null;
    final quantityKg = _parseNumber(match.group(2)) ?? 0;
    final firstMoney = _parseNumber(match.group(3)) ?? 0;
    final secondMoney = _parseNumber(match.group(4));
    final thirdMoney = _parseNumber(match.group(5));
    if (quantityKg <= 0) return null;

    // RM22 has no word-boundary after RM (digit follows), so do not use \bRM\b.
    final hadRinggit = RegExp(r'\bRM\s*\d', caseSensitive: false).hasMatch(line);
    double totalPrice;
    double unitPrice;
    if (thirdMoney != null) {
      // Qty · Price/Unit · Amount
      unitPrice = firstMoney;
      totalPrice = thirdMoney;
    } else if (secondMoney != null) {
      unitPrice = firstMoney;
      totalPrice = secondMoney;
      // Prefer amount that matches qty × unit when OCR swaps columns.
      final product = unitPrice * quantityKg;
      if ((product - secondMoney).abs() > 0.05 &&
          (product - firstMoney).abs() <= 0.05) {
        unitPrice = secondMoney;
        totalPrice = firstMoney;
      }
    } else if (!hadRinggit && firstMoney > 0) {
      // Invoice qty + unit only (no Amount column) → total = unit × kg.
      unitPrice = firstMoney;
      totalPrice = firstMoney * quantityKg;
    } else {
      // Single RM amount with weight is a notepad-style total, not invoice unit×qty.
      return null;
    }
    if (totalPrice <= 0) return null;

    final ppk = unitPrice > 0
        ? unitPrice
        : _normalizer.calculatePricePerKg(
            totalPrice: totalPrice,
            quantityKg: quantityKg,
          );
    return ReceiptItem(
      species: species,
      quantityKg: quantityKg,
      totalPrice: totalPrice,
      pricePerKg: ppk,
      confidence: _scoreItemConfidence(
        species: species,
        quantityKg: quantityKg,
        totalPrice: totalPrice,
        pricePerKg: ppk,
        sourceText: line,
        invoiceStructured: true,
      ),
    );
  }

  bool _looksLikeNameOnlyLine(String line) {
    final cleaned = _normalizeLine(line);
    if (cleaned.isEmpty || _parseLine(line) != null) return false;
    if (_isReceiptMetadataLine(cleaned)) return false;
    if (RegExp(r'[0-9]').hasMatch(cleaned)) return false;
    // Species name alone (invoice wrap / notepad split) — letters only.
    return RegExp(r'^[a-zA-Z ]{3,}$').hasMatch(cleaned.trim());
  }

  bool _looksLikePriceWeightLine(String line) {
    final hasRm = RegExp(r'\bRM\s*\d', caseSensitive: false).hasMatch(line);
    final hasWeight = RegExp(
      '\\d+(?:\\.\\d+)?\\s*$_weightUnitPattern\\b',
      caseSensitive: false,
    ).hasMatch(line);
    return hasRm || hasWeight;
  }

  /// Same species twice on one receipt: merge weight and total, recalc RM/kg.
  void _addOrMergeDuplicateSpecies(List<ReceiptItem> items, ReceiptItem item) {
    final key = item.species.trim().toLowerCase();
    final index = items.indexWhere(
      (existing) => existing.species.trim().toLowerCase() == key,
    );
    if (index < 0) {
      items.add(item);
      return;
    }

    final existing = items[index];
    final mergedQty = existing.quantityKg + item.quantityKg;
    final mergedTotal = existing.totalPrice + item.totalPrice;
    items[index] = ReceiptItem(
      species: existing.species,
      quantityKg: mergedQty,
      totalPrice: mergedTotal,
      pricePerKg: _normalizer.calculatePricePerKg(
        totalPrice: mergedTotal,
        quantityKg: mergedQty,
      ),
      confidence: ((existing.confidence + item.confidence) / 2).clamp(0.0, 1.0),
    );
  }

  /// Parse one or more seafood rows from a chunk (single line or grouped lines).
  List<ReceiptItem> _parseAllItemsInChunk(String chunk) {
    final windowed = _parseItemsBySpeciesWindows(chunk);
    if (windowed.length >= 2) return windowed;

    final single = _parseLine(chunk);
    if (single != null) {
      // Prefer windowed item when it matches the same species (better field binding).
      if (windowed.length == 1 &&
          windowed.first.species.toLowerCase().contains(
                single.species.toLowerCase().split(' ').first,
              )) {
        return windowed;
      }
      return [single];
    }
    return windowed;
  }

  /// Pair each species with the kg + RM that fall in its text window (row),
  /// so a 2-line note does not steal the other row's price/weight.
  List<ReceiptItem> _parseItemsBySpeciesWindows(String text) {
    final cleaned = _stripAllDates(text);
    if (cleaned.trim().length < 4) return const [];

    final speciesHits = _findSpeciesHits(cleaned);
    if (speciesHits.isEmpty) return const [];

    speciesHits.sort((a, b) => a.start.compareTo(b.start));

    final items = <ReceiptItem>[];
    for (var i = 0; i < speciesHits.length; i++) {
      final species = speciesHits[i];
      // Row window: after previous species name → before next species name.
      final windowStart = i == 0 ? 0 : speciesHits[i - 1].end;
      final windowEnd = i == speciesHits.length - 1
          ? cleaned.length
          : speciesHits[i + 1].start;
      final rowWindow = cleaned.substring(
        windowStart.clamp(0, cleaned.length),
        windowEnd.clamp(0, cleaned.length),
      );
      // Prefer kg/RM after this species name so the previous row's figures are ignored.
      final afterName = cleaned.substring(
        species.start.clamp(0, cleaned.length),
        windowEnd.clamp(0, cleaned.length),
      );

      final extracted = _extractWeightAndPrice(afterName, requireRm: true) ??
          _extractWeightAndPrice(rowWindow, requireRm: true);
      if (extracted == null) continue;

      final evidence = afterName.trim().isNotEmpty ? afterName : rowWindow;
      final ppk = extracted.unitPrice ??
          _normalizer.calculatePricePerKg(
            totalPrice: extracted.totalPrice,
            quantityKg: extracted.quantityKg,
          );
      items.add(
        ReceiptItem(
          species: species.name,
          quantityKg: extracted.quantityKg,
          totalPrice: extracted.totalPrice,
          pricePerKg: ppk,
          confidence: _scoreItemConfidence(
            species: species.name,
            quantityKg: extracted.quantityKg,
            totalPrice: extracted.totalPrice,
            pricePerKg: ppk,
            sourceText: evidence,
            keywordScattered: true,
          ),
        ),
      );
    }

    // Single unknown species with one weight + one RM in the whole note.
    if (items.isEmpty && speciesHits.length == 1) {
      final extracted = _extractWeightAndPrice(cleaned, requireRm: true);
      if (extracted != null) {
        final species = speciesHits.first.name;
        final ppk = extracted.unitPrice ??
            _normalizer.calculatePricePerKg(
              totalPrice: extracted.totalPrice,
              quantityKg: extracted.quantityKg,
            );
        items.add(
          ReceiptItem(
            species: species,
            quantityKg: extracted.quantityKg,
            totalPrice: extracted.totalPrice,
            pricePerKg: ppk,
            confidence: _scoreItemConfidence(
              species: species,
              quantityKg: extracted.quantityKg,
              totalPrice: extracted.totalPrice,
              pricePerKg: ppk,
              sourceText: cleaned,
              keywordScattered: true,
            ),
          ),
        );
      }
    }

    return items;
  }

  List<({int start, int end, String name})> _findSpeciesHits(String cleaned) {
    final speciesHits = <({int start, int end, String name})>[];
    final lower = cleaned.toLowerCase();
    final hints = [..._seafoodHints]
      ..sort((a, b) => b.length.compareTo(a.length));
    final usedRanges = <(int, int)>[];
    for (final hint in hints) {
      if (hint.length < 3) continue;
      var from = 0;
      while (true) {
        final idx = lower.indexOf(hint, from);
        if (idx < 0) break;
        final end = idx + hint.length;
        final overlaps = usedRanges.any((r) => idx < r.$2 && end > r.$1);
        if (!overlaps) {
          final rawName = cleaned.substring(idx, end).trim();
          speciesHits.add((
            start: idx,
            end: end,
            name: _titleCaseSpecies(rawName),
          ));
          usedRanges.add((idx, end));
        }
        from = end;
      }
    }

    if (speciesHits.isEmpty) {
      final nameGuess = _extractSpeciesName(cleaned);
      if (nameGuess.isNotEmpty) {
        speciesHits.add((start: 0, end: nameGuess.length.clamp(0, cleaned.length), name: nameGuess));
      }
    }
    return speciesHits;
  }

  String _titleCaseSpecies(String raw) {
    return raw
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .map((p) => p[0].toUpperCase() + p.substring(1).toLowerCase())
        .join(' ');
  }

  List<ReceiptItem> _parseLooseBlocks(String text) {
    final items = <ReceiptItem>[];

    for (final line in text.split(RegExp(r'\r?\n'))) {
      final trimmed = _normalizeLine(line.trim());
      if (trimmed.length < 4) continue;
      final lower = trimmed.toLowerCase();
      if (!_looksLikeSeafoodLine(lower) && !_looksLikeSeafoodLine(line.toLowerCase())) {
        continue;
      }

      final extracted = _extractWeightAndPrice(trimmed, requireRm: true);
      if (extracted == null) continue;

      final species = _extractSpeciesName(trimmed);
      if (species.isEmpty) continue;

      final quantityKg = extracted.quantityKg;
      final totalPrice = extracted.totalPrice;
      final ppk = extracted.unitPrice ??
          _normalizer.calculatePricePerKg(
            totalPrice: totalPrice,
            quantityKg: quantityKg,
          );
      items.add(
        ReceiptItem(
          species: species,
          quantityKg: quantityKg,
          totalPrice: totalPrice,
          pricePerKg: ppk,
          confidence: _scoreItemConfidence(
            species: species,
            quantityKg: quantityKg,
            totalPrice: totalPrice,
            pricePerKg: ppk,
            sourceText: trimmed,
            keywordScattered: true,
          ),
        ),
      );
    }
    return items;
  }

  bool _looksLikeSeafoodLine(String lower) {
    if (_isReceiptMetadataLine(lower)) return false;
    if (_seafoodHints.any(lower.contains)) return true;
    final withoutDate = _stripAllDates(lower).toLowerCase();
    if (_seafoodHints.any(withoutDate.contains)) return true;
    // Unknown species OK when weight unit + RM keywords are present (any order).
    final hasWeight = RegExp(
      '\\d+(?:\\.\\d+)?\\s*$_weightUnitPattern\\b',
      caseSensitive: false,
    ).hasMatch(withoutDate);
    final hasRm = RegExp(r'\bRM\s*\d', caseSensitive: false).hasMatch(withoutDate);
    if (hasWeight && hasRm) {
      final nameGuess = withoutDate
          .replaceAll(RegExp(r'[^a-zA-Z ]'), ' ')
          .replaceAll(RegExp(r'\s+'), ' ')
          .trim();
      return nameGuess.length >= 3;
    }
    return false;
  }

  String _extractSpeciesName(String line) {
    var cleaned = _normalizeLine(line);
    cleaned = cleaned.replaceAll(
      RegExp(
        '[0-9]+(?:\\.[0-9]+)?\\s*$_weightUnitPattern\\b',
        caseSensitive: false,
      ),
      ' ',
    );
    cleaned = cleaned.replaceAll(
      RegExp(r'RM\s*[0-9]+(?:\.[0-9]{1,2})?', caseSensitive: false),
      ' ',
    );
    cleaned = cleaned.replaceAll(
      RegExp(r'[0-9]+(?:\.[0-9]{1,2})?', caseSensitive: false),
      ' ',
    );
    cleaned = cleaned
        .replaceAll(
          RegExp(
            '\\b(?:$_weightUnitPattern|rm|per|item|species|weight|berat|price|harga)\\b',
            caseSensitive: false,
          ),
          ' ',
        )
        .replaceAll(RegExp(r'[@x×/]'), ' ')
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
    final invoiceItem = _parseInvoiceLine(line);
    if (invoiceItem != null) return invoiceItem;

    final normalized = _normalizeLine(line.trim());
    if (normalized.isEmpty) return null;

    // Handwritten wet-market notes: find unit weight + RM price by keyword, any order.
    final extracted = _extractWeightAndPrice(normalized, requireRm: true);
    if (extracted == null) return null;

    final species = _extractSpeciesName(normalized);
    if (species.isEmpty) return null;
    if (!_looksLikeSeafoodLine(species.toLowerCase()) &&
        !_looksLikeSeafoodLine(normalized.toLowerCase()) &&
        species.split(' ').length == 1 &&
        species.length < 4) {
      return null;
    }

    final quantityKg = extracted.quantityKg;
    final totalPrice = extracted.totalPrice;
    if (quantityKg <= 0 || totalPrice <= 0) return null;

    final ppk = extracted.unitPrice ??
        _normalizer.calculatePricePerKg(
          totalPrice: totalPrice,
          quantityKg: quantityKg,
        );
    return ReceiptItem(
      species: species,
      quantityKg: quantityKg,
      totalPrice: totalPrice,
      pricePerKg: ppk,
      confidence: _scoreItemConfidence(
        species: species,
        quantityKg: quantityKg,
        totalPrice: totalPrice,
        pricePerKg: ppk,
        sourceText: normalized,
      ),
    );
  }

  /// Confidence from real parse evidence (keywords + math), not a fixed random score.
  double _scoreItemConfidence({
    required String species,
    required double quantityKg,
    required double totalPrice,
    required double pricePerKg,
    required String sourceText,
    bool invoiceStructured = false,
    bool keywordScattered = false,
    bool fromAiVision = false,
    double? modelConfidence,
  }) {
    var score = 0.28;
    final hasRm = RegExp(r'\bRM\s*\d', caseSensitive: false).hasMatch(sourceText) ||
        RegExp(r'\bMYR\b', caseSensitive: false).hasMatch(sourceText);
    final hasWeightUnit = RegExp(
      '\\d+(?:\\.\\d+)?\\s*$_weightUnitPattern\\b',
      caseSensitive: false,
    ).hasMatch(sourceText);
    final speciesKey = species.toLowerCase();
    final inCatalog = _seafoodHints.any(
      (h) => speciesKey.contains(h) || h == speciesKey,
    );

    if (hasRm) score += 0.18;
    if (hasWeightUnit) score += 0.18;
    if (inCatalog) score += 0.14;
    if (species.trim().length >= 3) score += 0.06;
    if (quantityKg > 0) score += 0.04;
    if (totalPrice > 0) score += 0.04;

    if (quantityKg > 0 && pricePerKg > 0 && totalPrice > 0) {
      final expected = pricePerKg * quantityKg;
      final relErr = (expected - totalPrice).abs() /
          (totalPrice > 0.01 ? totalPrice : expected);
      if (relErr <= 0.02) {
        score += 0.12;
      } else if (relErr <= 0.08) {
        score += 0.05;
      } else {
        score -= 0.1;
      }
    }

    if (invoiceStructured) score += 0.08;
    if (keywordScattered) score -= 0.04;
    if (fromAiVision) score += 0.06;

    if (modelConfidence != null) {
      final model = modelConfidence.clamp(0.0, 1.0);
      // Blend so UI % reflects both model readability and field evidence.
      score = (score * 0.55) + (model * 0.45);
    }

    return score.clamp(0.0, 1.0);
  }

  DateTime? _extractDate(String text) {
    DateTime? tryBuild(int? day, int? month, int? yearValue) {
      if (day == null || month == null || yearValue == null) return null;
      if (day < 1 || day > 31 || month < 1 || month > 12) return null;
      final year = yearValue < 100 ? 2000 + yearValue : yearValue;
      if (year < 2000 || year > 2100) return null;
      try {
        return DateTime(year, month, day);
      } catch (_) {
        return null;
      }
    }

    final monthNamePattern = _monthNames.keys.join('|');

    // Labeled: Date / Tarikh + numeric
    final labeledNumeric = RegExp(
      r'(?:date|tarikh)\s*[:.\-]?\s*(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})',
      caseSensitive: false,
    ).firstMatch(text);
    if (labeledNumeric != null) {
      final built = tryBuild(
        int.tryParse(labeledNumeric.group(1)!),
        int.tryParse(labeledNumeric.group(2)!),
        int.tryParse(labeledNumeric.group(3)!),
      );
      if (built != null) return built;
    }

    // Labeled: Date / Tarikh + day month-name year
    final labeledNamed = RegExp(
      '(?:date|tarikh)\\s*[:.\\-]?\\s*(\\d{1,2})\\s+($monthNamePattern)\\.?\\s+(\\d{2,4})',
      caseSensitive: false,
    ).firstMatch(text);
    if (labeledNamed != null) {
      final month = _monthNames[labeledNamed.group(2)!.toLowerCase()];
      final built = tryBuild(
        int.tryParse(labeledNamed.group(1)!),
        month,
        int.tryParse(labeledNamed.group(3)!),
      );
      if (built != null) return built;
    }

    // 25 Oct 2026 / 25 Oktober 2026
    final named = RegExp(
      '(\\d{1,2})\\s+($monthNamePattern)\\.?\\s+(\\d{2,4})',
      caseSensitive: false,
    ).firstMatch(text);
    if (named != null) {
      final month = _monthNames[named.group(2)!.toLowerCase()];
      final built = tryBuild(
        int.tryParse(named.group(1)!),
        month,
        int.tryParse(named.group(3)!),
      );
      if (built != null) return built;
    }

    // ISO-ish: 2026-10-25 / 2026/10/25 / 2026.10.25
    final iso = RegExp(r'\b(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})\b').firstMatch(text);
    if (iso != null) {
      final built = tryBuild(
        int.tryParse(iso.group(3)!),
        int.tryParse(iso.group(2)!),
        int.tryParse(iso.group(1)!),
      );
      if (built != null) return built;
    }

    // DMY: 25/10/2026, 25-10-26, 25.10.2026
    final dmy = RegExp(r'\b(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})\b').firstMatch(text);
    if (dmy != null) {
      final built = tryBuild(
        int.tryParse(dmy.group(1)!),
        int.tryParse(dmy.group(2)!),
        int.tryParse(dmy.group(3)!),
      );
      if (built != null) return built;
    }

    // Short DM: 16/6 or 16-6 or 16.6
    final shortDate = RegExp(r'\b(\d{1,2})[./\-](\d{1,2})\b').firstMatch(text);
    if (shortDate != null) {
      final built = tryBuild(
        int.tryParse(shortDate.group(1)!),
        int.tryParse(shortDate.group(2)!),
        DateTime.now().year,
      );
      if (built != null) return built;
    }
    return null;
  }
}

class FreezerService {
  static const defaultShelfLifeDays = 30;

  List<FreezerItem> createItemsFromReceipt(ParsedReceipt receipt) {
    return receipt.items.map((item) {
      final species = SeafoodCatalog.resolveSpeciesName(item.species);
      final category = SeafoodCatalog.resolveCategory(species);
      return FreezerItem(
        species: species,
        stockKg: item.quantityKg,
        purchaseDate: receipt.purchaseDate,
        bestBeforeDate: receipt.purchaseDate.add(
          const Duration(days: defaultShelfLifeDays),
        ),
        pricePerKg: item.pricePerKg,
        iconKey: SeafoodCatalog.iconKeyForCategory(category),
        category: category,
      );
    }).toList();
  }
}

class ReceiptScanner {
  ReceiptScanner({
    ImagePicker? imagePicker,
    TextRecognizer? textRecognizer,
    ReceiptParser? parser,
    ReceiptAiOcrService? aiOcrService,
  }) : _imagePicker = imagePicker ?? ImagePicker(),
       _textRecognizer =
           textRecognizer ??
           TextRecognizer(script: TextRecognitionScript.latin),
       _parser = parser ?? ReceiptParser(),
       _aiOcr = aiOcrService ?? ReceiptAiOcrService();

  final ImagePicker _imagePicker;
  final TextRecognizer _textRecognizer;
  final ReceiptParser _parser;
  final ReceiptAiOcrService _aiOcr;

  Future<ScanResult> scanReceipt({ImageSource source = ImageSource.camera}) async {
    if (source == ImageSource.camera) {
      final permission = await Permission.camera.request();
      if (!permission.isGranted) {
        return const ScanResult(
          errorMessage:
              'Camera permission is required to scan receipts. Please allow camera access in settings.',
        );
      }
    }

    final image = await _imagePicker.pickImage(
      source: source,
      preferredCameraDevice: CameraDevice.rear,
      imageQuality: 85,
      maxWidth: 1600,
    );
    if (image == null) {
      return const ScanResult(cancelled: true);
    }

    // Let the camera activity finish resuming before opening the cropper.
    await Future<void>.delayed(const Duration(milliseconds: 200));

    String imagePath = image.path;
    try {
      final croppedPath = await _cropReceiptPhoto(image.path);
      if (croppedPath == null) {
        return const ScanResult(cancelled: true);
      }
      imagePath = croppedPath;
    } catch (_) {
      // Crop UI can fail on some devices; continue OCR with the original photo.
      imagePath = image.path;
    }

    try {
      final inputImage = InputImage.fromFilePath(imagePath);
      final recognizedText = await _textRecognizer.processImage(inputImage);
      final raw = recognizedText.text.trim();
      final mlKitParsed = raw.isEmpty
          ? ParsedReceipt(
              rawText: '',
              purchaseDate: DateTime.now(),
              items: const [],
            )
          : _parser.parse(raw);

      // Fast path: local ML Kit when it already found solid items.
      // AI vision is only for empty / low-confidence handwriting (slower).
      const aiConfidenceThreshold = 0.72;
      final needsAi = mlKitParsed.items.isEmpty ||
          mlKitParsed.parseConfidence < aiConfidenceThreshold;

      ParsedReceipt parsed = mlKitParsed;
      String? aiError;
      if (needsAi) {
        try {
          final aiParsed = await _aiOcr.extractFromFile(
            File(imagePath),
            mlKitHint: raw.isEmpty ? null : raw,
          );
          if (aiParsed.items.isNotEmpty) {
            parsed = aiParsed;
          } else if (mlKitParsed.items.isEmpty &&
              aiParsed.rawText.trim().isNotEmpty) {
            parsed = aiParsed;
          }
        } catch (error) {
          aiError = '$error';
        }
      }

      if (parsed.items.isEmpty) {
        return ScanResult(
          errorMessage: aiError ??
              (parsed.rawText.trim().isEmpty
                  ? 'Could not read the handwriting. Crop tight to the note, use brighter light, write larger, or type the fields on the next screen.'
                  : 'Could not read seafood lines automatically. Review the detected text and edit the fields below.'),
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

  /// Opens the crop UI so the user can frame only the receipt before OCR.
  Future<String?> _cropReceiptPhoto(String sourcePath) async {
    final cropped = await ImageCropper().cropImage(
      sourcePath: sourcePath,
      compressFormat: ImageCompressFormat.jpg,
      compressQuality: 78,
      maxWidth: 1400,
      maxHeight: 1400,
      uiSettings: [
        AndroidUiSettings(
          toolbarTitle: 'Crop receipt',
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
          title: 'Crop receipt',
          doneButtonTitle: 'Scan',
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
    return cropped?.path;
  }

  void dispose() {
    _textRecognizer.close();
  }
}
