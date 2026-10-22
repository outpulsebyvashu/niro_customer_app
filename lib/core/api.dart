import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Where the Niro server lives. All four web apps and this app share one server and one database.
const String kApiBase = String.fromEnvironment('API_BASE', defaultValue: 'https://niro.cards');

class ApiError implements Exception {
  final String message;
  final int status;
  ApiError(this.message, this.status);
  @override
  String toString() => message;
}

typedef Json = Map<String, dynamic>;

class Api {
  String? token;

  Map<String, String> get _headers => {
        'content-type': 'application/json',
        if (token != null) 'authorization': 'Bearer $token',
      };

  Future<dynamic> _send(String method, String path, [Object? body]) async {
    final req = http.Request(method, Uri.parse('$kApiBase$path'));
    req.headers.addAll(_headers);
    if (body != null) req.body = jsonEncode(body);
    http.StreamedResponse res;
    try {
      res = await req.send().timeout(const Duration(seconds: 25));
    } catch (_) {
      throw ApiError('No connection. Check your internet and try again.', 0);
    }
    final text = await res.stream.bytesToString();
    dynamic data;
    try {
      data = text.isEmpty ? null : jsonDecode(text);
    } catch (_) {
      data = null;
    }
    if (res.statusCode >= 400) {
      final msg = (data is Map && data['error'] is String) ? data['error'] as String : 'Something went wrong. Try again.';
      throw ApiError(msg, res.statusCode);
    }
    return data;
  }

  Future<Json> getJson(String path) async => (await _send('GET', path)) as Json;
  Future<Json> postJson(String path, [Object? body]) async => ((await _send('POST', path, body ?? <String, dynamic>{})) ?? <String, dynamic>{}) as Json;
  Future<Json> patchJson(String path, Object body) async => ((await _send('PATCH', path, body)) ?? <String, dynamic>{}) as Json;
  Future<Json> putJson(String path, Object body) async => ((await _send('PUT', path, body)) ?? <String, dynamic>{}) as Json;
  Future<Json> deleteJson(String path) async => ((await _send('DELETE', path)) ?? <String, dynamic>{}) as Json;

  /// Live connection: the server tells us the moment a card is scanned or stamped. Reconnects by itself until cancelled.
  Stream<Json> live() {
    late StreamController<Json> controller;
    var stop = false;
    http.Client? client;
    Future<void> run() async {
      while (!stop && token != null) {
        client = http.Client();
        try {
          final req = http.Request('GET', Uri.parse('$kApiBase/api/live'));
          req.headers['authorization'] = 'Bearer $token';
          req.headers['accept'] = 'text/event-stream';
          final res = await client!.send(req);
          var event = '';
          await for (final line in res.stream.transform(utf8.decoder).transform(const LineSplitter())) {
            if (stop) break;
            if (line.startsWith('event:')) {
              event = line.substring(6).trim();
            } else if (line.startsWith('data:') && event == 'live') {
              try {
                final m = jsonDecode(line.substring(5).trim());
                if (m is Map<String, dynamic> && !controller.isClosed) controller.add(m);
              } catch (_) {}
              event = '';
            }
          }
        } catch (_) {
          // network hiccup: try again below
        } finally {
          client?.close();
        }
        if (!stop) await Future<void>.delayed(const Duration(milliseconds: 1500));
      }
    }

    controller = StreamController<Json>(
      onListen: () {
        run();
      },
      onCancel: () {
        stop = true;
        client?.close();
      },
    );
    return controller.stream;
  }
}

/// Who is signed in, and which parts of Niro they can use.
class Session {
  final Api api = Api();
  Json? me;
  bool ready = false;
  bool isStaff = false;
  bool isAdmin = false;
  List<Json> jobs = <Json>[];
  final List<void Function()> _listeners = <void Function()>[];

  bool get signedIn => me != null;
  String get name => (me?['name'] as String?) ?? '';

  void listen(void Function() f) => _listeners.add(f);
  void unlisten(void Function() f) => _listeners.remove(f);
  void _notify() {
    for (final f in List<void Function()>.from(_listeners)) {
      f();
    }
  }

  Future<void> init() async {
    final p = await SharedPreferences.getInstance();
    api.token = p.getString('token');
    if (api.token != null) {
      try {
        await refresh();
      } on ApiError catch (e) {
        if (e.status == 401) await _clear();
      }
    }
    ready = true;
    _notify();
  }

  Future<void> refresh() async {
    me = await api.getJson('/api/me');
    isAdmin = me?['is_admin'] == true;
    try {
      final j = await api.getJson('/api/staff/me');
      jobs = ((j['jobs'] as List?) ?? <dynamic>[]).cast<Json>();
    } catch (_) {
      jobs = <Json>[];
    }
    isStaff = jobs.isNotEmpty;
    _notify();
  }

  Future<void> requestOtp(String phone, String name) async {
    await api.postJson('/api/auth/request-otp', {'phone': phone, 'name': name});
  }

  Future<void> verify(String phone, String code) async {
    final r = await api.postJson('/api/auth/verify', {'phone': phone, 'code': code});
    api.token = r['token'] as String?;
    final p = await SharedPreferences.getInstance();
    if (api.token != null) await p.setString('token', api.token!);
    await refresh();
  }

  Future<void> logout() async {
    try {
      await api.postJson('/api/auth/logout');
    } catch (_) {}
    await _clear();
    _notify();
  }

  Future<void> _clear() async {
    api.token = null;
    me = null;
    isStaff = false;
    isAdmin = false;
    jobs = <Json>[];
    final p = await SharedPreferences.getInstance();
    await p.remove('token');
  }

  Future<void> afterDelete() async {
    await _clear();
    _notify();
  }
}

final Session session = Session();
