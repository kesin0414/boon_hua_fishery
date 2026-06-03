import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:boon_hua_mobile/main.dart';

void main() {
  testWidgets('Boon Hua auth and dashboard load', (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: AuthScreen()));

    expect(find.text('Boon Hua Fishery'), findsOneWidget);
    expect(find.text('Login'), findsWidgets);
  });
}
