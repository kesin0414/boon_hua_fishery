import 'package:flutter_test/flutter_test.dart';
import 'package:boon_hua_mobile/receipt_scanner.dart';

void main() {
  final parser = ReceiptParser();

  test('parses numbered notepad list with short date', () {
    const raw = '''
16/6
1. Octopus 1kg RM20
2. Stingray 500g RM9
''';
    final result = parser.parse(raw);
    expect(result.items.length, 2);
    expect(result.items[0].species, 'Octopus');
    expect(result.items[0].quantityKg, 1);
    expect(result.items[0].totalPrice, 20);
    expect(result.items[1].species, 'Stingray');
    expect(result.items[1].quantityKg, 0.5);
    expect(result.items[1].totalPrice, 9);
    expect(result.purchaseDate.month, 6);
    expect(result.purchaseDate.day, 16);
  });

  test('parses single-line receipt with full date', () {
    const raw = '16/6/2026 Octopus 1kg RM20';
    final result = parser.parse(raw);
    expect(result.items.length, 1);
    expect(result.items.first.species, 'Octopus');
  });

  test('parses Boon Hua printed invoice 2601-021', () {
    const raw = '''
BOON HUA FISHERY
GERAI NO. B49, PASAR BORONG,
68100 BATU CAVES, SELANGOR
CHUNG HUAT TRADING (E50)
INVOICE : 2601-021
Date : 04/01/2026
No Item Code Description Qty Price/Unit Discount Amount
1 IBM001 Ikan Bara Merah 14.00 KG 7.00 98.00
2 KRP003 Kerisi Panjang C 20.00 KG 8.50 170.00
Malaysian Ringgit : TWO HUNDRED AND SIXTY EIGHT ONLY
Total (MYR) 268.00
''';
    final result = parser.parse(raw);
    expect(result.items.length, 2);
    expect(result.items[0].species, 'Ikan Bara Merah');
    expect(result.items[0].quantityKg, 14);
    expect(result.items[0].totalPrice, 98);
    expect(result.items[0].pricePerKg, 7);
    expect(result.items[1].species, 'Kerisi Panjang C');
    expect(result.items[1].quantityKg, 20);
    expect(result.items[1].totalPrice, 170);
    expect(result.items[1].pricePerKg, 8.5);
    expect(result.purchaseDate, DateTime(2026, 1, 4));
  });

  test('parses Boon Hua invoice when columns wrap onto extra lines', () {
    const raw = '''
Date : 04/01/2026
Ikan Bara Merah
14.00 KG
7.00
98.00
Kerisi Panjang C
20.00 KG
8.50
170.00
Total (MYR) 268.00
''';
    final result = parser.parse(raw);
    expect(result.items.length, 2);
    expect(result.items[0].species, 'Ikan Bara Merah');
    expect(result.items[0].quantityKg, 14);
    expect(result.items[0].totalPrice, 98);
    expect(result.items[1].totalPrice, 170);
  });


  test('parses blurry stakeholder note split across lines', () {
    final result = parser.parse('''
16/6
1. Oct0pus 1 k g R M 2O
2. Stingray
500 g
RM 9
''');
    expect(result.items.length, 2);
    expect(result.items[0].species.toLowerCase(), contains('oct'));
    expect(result.items[0].quantityKg, 1);
    expect(result.items[0].totalPrice, 20);
    expect(result.items[1].species, 'Stingray');
    expect(result.items[1].quantityKg, 0.5);
    expect(result.items[1].totalPrice, 9);
  });

  test('parses price before weight without confusing kg for price', () {
    final result = parser.parse('Octopus RM20 1kg');
    expect(result.items.length, 1);
    expect(result.items.first.species, 'Octopus');
    expect(result.items.first.quantityKg, 1);
    expect(result.items.first.totalPrice, 20);
    expect(result.items.first.pricePerKg, 20);
  });

  test('parses @ and x price layouts with grams', () {
    final result = parser.parse('''
Stingray 500g @ RM9
Tiger Prawn 2kg x RM40
''');
    expect(result.items.length, 2);
    expect(result.items[0].species, 'Stingray');
    expect(result.items[0].quantityKg, 0.5);
    expect(result.items[0].totalPrice, 9);
    expect(result.items[1].species, 'Tiger Prawn');
    expect(result.items[1].quantityKg, 2);
    expect(result.items[1].totalPrice, 40);
    expect(result.items[1].pricePerKg, 20);
  });

  test('parses decimal comma weight and money', () {
    final result = parser.parse('Ikan Bara Merah 1,5kg RM22,50');
    expect(result.items.length, 1);
    expect(result.items.first.quantityKg, 1.5);
    expect(result.items.first.totalPrice, 22.5);
    expect(result.items.first.pricePerKg, 15);
  });

  test('parses RM per kg with weight into total', () {
    final result = parser.parse('Kerisi 2kg RM8.50/kg');
    expect(result.items.length, 1);
    expect(result.items.first.quantityKg, 2);
    expect(result.items.first.totalPrice, 17);
    expect(result.items.first.pricePerKg, 8.5);
  });

  test('parses handwritten fields in any order', () {
    final result = parser.parse('RM20 1kg Octopus');
    expect(result.items.length, 1);
    expect(result.items.first.species, 'Octopus');
    expect(result.items.first.quantityKg, 1);
    expect(result.items.first.totalPrice, 20);
  });

  test('parses labeled handwritten note split across lines', () {
    final result = parser.parse('''
Tarikh: 25 Oktober 2026
Item: Stingray
Weight: 500g
Price: RM9
''');
    expect(result.items.length, 1);
    expect(result.items.first.species, 'Stingray');
    expect(result.items.first.quantityKg, 0.5);
    expect(result.items.first.totalPrice, 9);
    expect(result.purchaseDate, DateTime(2026, 10, 25));
  });

  test('reads multiple handwritten date formats', () {
    expect(
      parser.parse('25.10.2026 Octopus 1kg RM20').purchaseDate,
      DateTime(2026, 10, 25),
    );
    expect(
      parser.parse('2026-10-25 Octopus 1kg RM20').purchaseDate,
      DateTime(2026, 10, 25),
    );
    expect(
      parser.parse('Date: 16/6/26 Octopus 1kg RM20').purchaseDate,
      DateTime(2026, 6, 16),
    );
    expect(
      parser.parse('25 Oct 2026 Octopus 1kg RM20').purchaseDate,
      DateTime(2026, 10, 25),
    );
  });

  test('parses kilo unit as kilograms', () {
    final result = parser.parse('Tiger Prawn 2 kilo RM40');
    expect(result.items.length, 1);
    expect(result.items.first.quantityKg, 2);
    expect(result.items.first.totalPrice, 40);
  });

  test('recovers blurry OCR of crab note (g→q, year junk, RM cents as Oo)', () {
    // Written: 25/10/2026 Crab 700g RM35.00
    // Detected: 25/10 J202s Crab 700q RM35-Oo
    final result = parser.parse('25/10 J202s Crab 700q RM35-Oo');
    expect(result.items.length, 1);
    expect(result.items.first.species, 'Crab');
    expect(result.items.first.quantityKg, 0.7);
    expect(result.items.first.totalPrice, 35);
    expect(result.purchaseDate, DateTime(2026, 10, 25));
  });

  test('builds receipt from AI OCR JSON', () {
    final result = ReceiptParser.parsedReceiptFromAiJson({
      'purchaseDate': '2026-10-25',
      'rawText': '25/10/2026 Crab 700g RM35',
      'items': [
        {
          'species': 'Crab',
          'quantityKg': 0.7,
          'totalPrice': 35,
          'pricePerKg': 50,
          'confidence': 0.82,
        },
      ],
    });
    expect(result.items.length, 1);
    expect(result.items.first.species, 'Crab');
    expect(result.items.first.quantityKg, 0.7);
    expect(result.items.first.totalPrice, 35);
    expect(result.purchaseDate, DateTime(2026, 10, 25));
    expect(result.items.first.confidence, greaterThan(0.5));
    expect(result.items.first.confidence, lessThan(1.0));
  });

  test('pairs keywords when handwriting is not on one line', () {
    final result = parser.parse('''
25/10/2026
Crab
700g
RM35
''');
    expect(result.items.length, 1);
    expect(result.items.first.species.toLowerCase(), contains('crab'));
    expect(result.items.first.quantityKg, 0.7);
    expect(result.items.first.totalPrice, 35);
  });

  test('keeps two seafood rows with their own kg and RM on one OCR line', () {
    final result = parser.parse('Octopus 1kg RM20 Stingray 500g RM9');
    expect(result.items.length, 2);
    final octopus = result.items.firstWhere(
      (i) => i.species.toLowerCase().contains('octopus'),
    );
    final stingray = result.items.firstWhere(
      (i) => i.species.toLowerCase().contains('sting'),
    );
    expect(octopus.quantityKg, 1);
    expect(octopus.totalPrice, 20);
    expect(stingray.quantityKg, 0.5);
    expect(stingray.totalPrice, 9);
  });

  test('keeps two seafood rows when split across lines', () {
    final result = parser.parse('''
Octopus
1kg
RM20
Stingray
500g
RM9
''');
    expect(result.items.length, 2);
    expect(
      result.items.firstWhere((i) => i.species.toLowerCase().contains('octopus')).totalPrice,
      20,
    );
    expect(
      result.items.firstWhere((i) => i.species.toLowerCase().contains('sting')).quantityKg,
      0.5,
    );
  });

  test('confidence is higher when RM, unit, catalog and math agree', () {
    final strong = parser.parse('Crab 700g RM35');
    final weak = ReceiptParser.parsedReceiptFromAiJson({
      'purchaseDate': '',
      'rawText': 'xx',
      'items': [
        {
          'species': 'Foo',
          'quantityKg': 1,
          'totalPrice': 10,
          'pricePerKg': 99,
          'confidence': 0.2,
        },
      ],
    });
    expect(strong.items, isNotEmpty);
    expect(weak.items, isNotEmpty);
    expect(strong.items.first.confidence, greaterThan(weak.items.first.confidence));
  });
}
