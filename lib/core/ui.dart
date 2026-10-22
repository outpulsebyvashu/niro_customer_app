import 'dart:async';

import 'package:flutter/material.dart';

import 'api.dart';

const Color kInk = Color(0xFF111111);
const Color kPaper = Color(0xFFF6F4F0);

ThemeData niroTheme() {
  final base = ColorScheme.fromSeed(seedColor: kInk, brightness: Brightness.light, surface: Colors.white);
  return ThemeData(
    useMaterial3: true,
    colorScheme: base.copyWith(primary: kInk, onPrimary: Colors.white),
    scaffoldBackgroundColor: kPaper,
    appBarTheme: const AppBarTheme(backgroundColor: kPaper, elevation: 0, foregroundColor: kInk, centerTitle: false),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: kInk,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: const EdgeInsets.symmetric(vertical: 6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
    ),
  );
}

Color hexColor(Object? h, [Color fallback = Colors.black]) {
  if (h is! String || !RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(h)) return fallback;
  return Color(int.parse('FF${h.substring(1)}', radix: 16));
}

String toHex(Color c) {
  String two(double v) => (v * 255).round().clamp(0, 255).toRadixString(16).padLeft(2, '0');
  return '#${two(c.r)}${two(c.g)}${two(c.b)}';
}

void toast(BuildContext c, String m) {
  if (!c.mounted) return;
  ScaffoldMessenger.of(c)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(m), behavior: SnackBarBehavior.floating));
}

/// Runs an API call. On failure shows the server's message and returns null.
Future<T?> guard<T>(BuildContext c, Future<T> f) async {
  try {
    return await f;
  } on ApiError catch (e) {
    toast(c, e.message);
    return null;
  } catch (_) {
    toast(c, 'Something went wrong. Try again.');
    return null;
  }
}

Future<bool> confirm(BuildContext c, String title, String body, [String yes = 'Yes']) async {
  final r = await showDialog<bool>(
    context: c,
    builder: (_) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(c, true), child: Text(yes)),
      ],
    ),
  );
  return r == true;
}

/// Asks for one line of text.
Future<String?> askText(BuildContext c, String title, {String hint = '', String initial = '', TextInputType type = TextInputType.text}) async {
  final ctl = TextEditingController(text: initial);
  final r = await showDialog<String>(
    context: c,
    builder: (_) => AlertDialog(
      title: Text(title),
      content: TextField(controller: ctl, autofocus: true, keyboardType: type, decoration: InputDecoration(hintText: hint)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(c, ctl.text.trim()), child: const Text('OK')),
      ],
    ),
  );
  return (r == null || r.isEmpty) ? null : r;
}

class Pill extends StatelessWidget {
  final String text;
  final Color? color;
  const Pill(this.text, {super.key, this.color});
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: (color ?? kInk).withValues(alpha: .08), borderRadius: BorderRadius.circular(99)),
        child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color ?? kInk)),
      );
}

class Stat extends StatelessWidget {
  final String label;
  final Object? value;
  const Stat(this.label, this.value, {super.key});
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${value ?? 0}', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
            const SizedBox(height: 2),
            Text(label, style: const TextStyle(fontSize: 12, color: Colors.black54)),
          ]),
        ),
      );
}

class StatGrid extends StatelessWidget {
  final List<Stat> stats;
  const StatGrid(this.stats, {super.key});
  @override
  Widget build(BuildContext context) => GridView.count(
        crossAxisCount: 2,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        childAspectRatio: 2.1,
        mainAxisSpacing: 4,
        crossAxisSpacing: 8,
        children: stats,
      );
}

class Empty extends StatelessWidget {
  final String text;
  const Empty(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(32),
        child: Center(child: Text(text, textAlign: TextAlign.center, style: const TextStyle(color: Colors.black54))),
      );
}

/// Loads data, shows it, and refreshes quietly on a timer (and on demand). Pull down to refresh.
class Loader<T> extends StatefulWidget {
  final Future<T> Function() load;
  final Widget Function(BuildContext, T, Future<void> Function() reload) builder;
  final Duration? every;
  final Stream<Json>? live;
  const Loader({super.key, required this.load, required this.builder, this.every, this.live});
  @override
  State<Loader<T>> createState() => _LoaderState<T>();
}

class _LoaderState<T> extends State<Loader<T>> {
  T? data;
  String? error;
  Timer? timer;
  StreamSubscription<Json>? sub;

  @override
  void initState() {
    super.initState();
    reload();
    if (widget.every != null) timer = Timer.periodic(widget.every!, (_) => reload());
    sub = widget.live?.listen((_) => reload());
  }

  @override
  void dispose() {
    timer?.cancel();
    sub?.cancel();
    super.dispose();
  }

  Future<void> reload() async {
    try {
      final d = await widget.load();
      if (mounted) setState(() {
        data = d;
        error = null;
      });
    } on ApiError catch (e) {
      if (mounted && data == null) setState(() => error = e.message);
    } catch (_) {
      if (mounted && data == null) setState(() => error = 'Something went wrong.');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (data != null) return RefreshIndicator(onRefresh: reload, child: widget.builder(context, data as T, reload));
    if (error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(error!, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: reload, child: const Text('Try again')),
          ]),
        ),
      );
    }
    return const Center(child: CircularProgressIndicator(strokeWidth: 2));
  }
}

/// Pixel-art card design, drawn from {w, h, p[], d}.
class PixelArt extends StatelessWidget {
  final Map<String, dynamic> art;
  const PixelArt(this.art, {super.key});
  @override
  Widget build(BuildContext context) => CustomPaint(painter: _ArtPainter(art), size: Size.infinite);
}

class _ArtPainter extends CustomPainter {
  final Map<String, dynamic> art;
  _ArtPainter(this.art);
  @override
  void paint(Canvas canvas, Size size) {
    final w = (art['w'] as num).toInt(), h = (art['h'] as num).toInt();
    final pal = (art['p'] as List).map((e) => hexColor(e)).toList();
    final d = art['d'] as String;
    final sx = size.width / w, sy = size.height / h;
    final paint = Paint()..isAntiAlias = false;
    for (var i = 0; i < d.length && i < w * h; i++) {
      final idx = int.tryParse(d[i], radix: 16) ?? 0;
      paint.color = pal[idx.clamp(0, pal.length - 1)];
      canvas.drawRect(Rect.fromLTWH((i % w) * sx, (i ~/ w) * sy, sx + 0.6, sy + 0.6), paint);
    }
  }

  @override
  bool shouldRepaint(covariant _ArtPainter old) => old.art != art;
}

/// A loyalty card, drawn in the cafe's own colours.
class LoyaltyCard extends StatelessWidget {
  final Map<String, dynamic> cafe;
  final int stamps;
  final VoidCallback? onTap;
  const LoyaltyCard({super.key, required this.cafe, required this.stamps, this.onTap});

  @override
  Widget build(BuildContext context) {
    final brand = (cafe['brand'] as Map?)?.cast<String, dynamic>() ?? <String, dynamic>{};
    final bg = hexColor(brand['bg'], kInk), ink = hexColor(brand['ink'], Colors.white), acc = hexColor(brand['acc'], Colors.white);
    final goal = (cafe['stamp_goal'] as num?)?.toInt() ?? 8;
    final art = brand['art'];
    return GestureDetector(
      onTap: onTap,
      child: AspectRatio(
        aspectRatio: 1.65,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(22),
          child: Stack(fit: StackFit.expand, children: [
            Container(color: bg),
            if (art is Map<String, dynamic>) Opacity(opacity: .9, child: PixelArt(art)),
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                gradient: art is Map
                    ? LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.transparent, bg.withValues(alpha: .85)])
                    : null,
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${cafe['name'] ?? ''}', style: TextStyle(color: ink, fontSize: 20, fontWeight: FontWeight.w800)),
                if (cafe['area'] != null) Text('${cafe['area']}', style: TextStyle(color: ink.withValues(alpha: .7), fontSize: 12)),
                const Spacer(),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  for (var i = 0; i < goal; i++)
                    Container(
                      width: 22,
                      height: 22,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: i < stamps ? acc : Colors.transparent,
                        border: Border.all(color: acc, width: 1.6),
                      ),
                    ),
                ]),
                const SizedBox(height: 8),
                Text('$stamps / $goal  ·  ${cafe['reward_text'] ?? ''}', style: TextStyle(color: ink, fontSize: 12, fontWeight: FontWeight.w600)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}
