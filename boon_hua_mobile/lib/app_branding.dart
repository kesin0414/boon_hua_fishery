import 'package:flutter/material.dart';

/// Brand colours shared by logo and splash screens.
class BrandColors {
  static const navy = Color(0xFF2F3C95);
  static const navyDark = Color(0xFF07164A);
  static const teal = Color(0xFF5DC0AE);
}

/// App logo — fills the frame (cover) inside a rounded square with brand gradient fallback.
class AppLogo extends StatelessWidget {
  const AppLogo({
    super.key,
    this.size = 88,
    this.borderRadius = 22,
    this.showShadow = true,
  });

  final double size;
  final double borderRadius;
  final bool showShadow;

  static const _asset = 'assets/app_icon.png';

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(borderRadius);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: radius,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [BrandColors.navy, BrandColors.navyDark],
        ),
        boxShadow: showShadow
            ? const [
                BoxShadow(
                  color: Color(0x402F3C95),
                  blurRadius: 16,
                  offset: Offset(0, 6),
                ),
              ]
            : null,
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: Image.asset(
          _asset,
          width: size,
          height: size,
          fit: BoxFit.cover,
          alignment: Alignment.center,
          filterQuality: FilterQuality.high,
          errorBuilder: (_, __, ___) => _LogoFallback(size: size),
        ),
      ),
    );
  }
}

class _LogoFallback extends StatelessWidget {
  const _LogoFallback({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: BrandColors.navy,
      child: Icon(
        Icons.phishing_rounded,
        color: BrandColors.teal,
        size: size * 0.45,
      ),
    );
  }
}
