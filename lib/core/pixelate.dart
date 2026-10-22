import 'dart:typed_data';

import 'package:image/image.dart' as img;

/// Turns a picture into card pixel art: cropped to the card shape, shrunk to 56 x 34, reduced to 12 colours.
/// Returns {w, h, p: [hex colours], d: "hex digit per pixel"} or null if the file is not an image.
Map<String, dynamic>? pixelate(Uint8List bytes) {
  final src = img.decodeImage(bytes);
  if (src == null) return null;
  const w = 56, h = 34, k = 12;
  final scale = (w / src.width) > (h / src.height) ? w / src.width : h / src.height;
  final cw = (w / scale).round().clamp(1, src.width), ch = (h / scale).round().clamp(1, src.height);
  final cropped = img.copyCrop(src, x: (src.width - cw) ~/ 2, y: (src.height - ch) ~/ 2, width: cw, height: ch);
  final small = img.copyResize(cropped, width: w, height: h, interpolation: img.Interpolation.average);
  final px = <List<double>>[];
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      final p = small.getPixel(x, y);
      final a = p.a / 255.0;
      px.add([p.r * a + 255 * (1 - a), p.g * a + 255 * (1 - a), p.b * a + 255 * (1 - a)]);
    }
  }
  final n = px.length;
  final sorted = [...px]..sort((a, b) => (a[0] + a[1] + a[2]).compareTo(b[0] + b[1] + b[2]));
  final cen = <List<double>>[for (var i = 0; i < k; i++) [...sorted[((i + .5) * n / k).floor()]]];
  final as = List<int>.filled(n, 0);
  for (var it = 0; it < 8; it++) {
    final sum = List.generate(k, (_) => [0.0, 0.0, 0.0, 0.0]);
    for (var i = 0; i < n; i++) {
      var bi = 0;
      var bd = double.infinity;
      for (var j = 0; j < k; j++) {
        final dr = px[i][0] - cen[j][0], dg = px[i][1] - cen[j][1], db = px[i][2] - cen[j][2];
        final dd = dr * dr + dg * dg + db * db;
        if (dd < bd) {
          bd = dd;
          bi = j;
        }
      }
      as[i] = bi;
      sum[bi][0] += px[i][0];
      sum[bi][1] += px[i][1];
      sum[bi][2] += px[i][2];
      sum[bi][3]++;
    }
    for (var j = 0; j < k; j++) {
      if (sum[j][3] > 0) cen[j] = [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]];
    }
  }
  String hx(double v) => v.round().clamp(0, 255).toRadixString(16).padLeft(2, '0');
  return {
    'w': w,
    'h': h,
    'p': [for (final c in cen) '#${hx(c[0])}${hx(c[1])}${hx(c[2])}'],
    'd': as.map((v) => v.toRadixString(16)).join(),
  };
}
