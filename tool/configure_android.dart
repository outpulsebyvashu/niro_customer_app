// Runs in CI right after `flutter create`: adds the permissions Niro needs and the app name.
import 'dart:io';

void main() {
  final f = File('android/app/src/main/AndroidManifest.xml');
  var s = f.readAsStringSync();
  const perms = '''
    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.CAMERA"/>
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
''';
  if (!s.contains('android.permission.CAMERA')) {
    s = s.replaceFirst('<application', '$perms    <application');
  }
  s = s.replaceFirst(RegExp(r'android:label="[^"]*"'), 'android:label="Niro"');
  f.writeAsStringSync(s);

  // mobile_scanner and geolocator need a recent Android minSdk.
  for (final name in ['android/app/build.gradle.kts', 'android/app/build.gradle']) {
    final g = File(name);
    if (!g.existsSync()) continue;
    var t = g.readAsStringSync();
    t = t.replaceAll('minSdk = flutter.minSdkVersion', 'minSdk = 23').replaceAll('minSdkVersion flutter.minSdkVersion', 'minSdkVersion 23');
    g.writeAsStringSync(t);
  }
}
