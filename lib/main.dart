import 'package:flutter/material.dart';

import 'admin/admin.dart';
import 'client/client.dart';
import 'core/api.dart';
import 'core/ui.dart';
import 'customer/customer.dart';
import 'workforce/workforce.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const NiroApp());
}

class NiroApp extends StatefulWidget {
  const NiroApp({super.key});
  @override
  State<NiroApp> createState() => _NiroAppState();
}

class _NiroAppState extends State<NiroApp> {
  @override
  void initState() {
    super.initState();
    session.listen(_changed);
    session.init();
  }

  @override
  void dispose() {
    session.unlisten(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    Widget home;
    if (!session.ready) {
      home = const Scaffold(body: Center(child: CircularProgressIndicator(strokeWidth: 2)));
    } else if (!session.signedIn) {
      home = const LoginPage();
    } else {
      home = const HomeShell();
    }
    return MaterialApp(title: 'Niro', debugShowCheckedModeBanner: false, theme: niroTheme(), home: home);
  }
}

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final phone = TextEditingController();
  final name = TextEditingController();
  final code = TextEditingController();
  bool sent = false, busy = false;

  Future<void> _go() async {
    setState(() => busy = true);
    if (!sent) {
      final ok = await guard(context, session.requestOtp(phone.text.trim(), name.text.trim()).then((_) => true));
      if (ok == true) sent = true;
    } else {
      await guard(context, session.verify(phone.text.trim(), code.text.trim()));
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(24), children: [
          const SizedBox(height: 60),
          const Text('niro', style: TextStyle(fontSize: 54, fontWeight: FontWeight.w900, letterSpacing: -2)),
          const SizedBox(height: 6),
          const Text('One app for your cafe cards, your cafe, your team and the whole platform.', style: TextStyle(color: Colors.black54)),
          const SizedBox(height: 36),
          if (!sent) ...[
            TextField(controller: name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(hintText: 'Your name (new here?)')),
            const SizedBox(height: 10),
            TextField(controller: phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(hintText: 'Mobile number', prefixText: '+91  ')),
          ] else ...[
            Text('Code sent to ${phone.text}'),
            const SizedBox(height: 10),
            TextField(controller: code, keyboardType: TextInputType.number, autofocus: true, decoration: const InputDecoration(hintText: '6-digit code')),
          ],
          const SizedBox(height: 16),
          FilledButton(onPressed: busy ? null : _go, child: Text(busy ? 'Please wait…' : (sent ? 'Verify' : 'Send code'))),
          if (sent) TextButton(onPressed: () => setState(() => sent = false), child: const Text('Use a different number')),
        ]),
      ),
    );
  }
}

/// The signed-in app. Everyone is a customer; the other parts appear only if the account has that role.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int index = 0;

  @override
  Widget build(BuildContext context) {
    final modes = <(String, IconData, Widget)>[
      ('Customer', Icons.credit_card, const CustomerHome()),
      ('Client', Icons.storefront, const ClientHome()),
      if (session.isStaff) ('Workforce', Icons.qr_code_scanner, const WorkforceHome()),
      if (session.isAdmin) ('Admin', Icons.admin_panel_settings, const AdminHome()),
    ];
    if (index >= modes.length) index = 0;
    return Scaffold(
      body: IndexedStack(index: index, children: [for (final m in modes) m.$3]),
      bottomNavigationBar: modes.length < 2
          ? null
          : NavigationBar(
              selectedIndex: index,
              onDestinationSelected: (i) => setState(() => index = i),
              destinations: [for (final m in modes) NavigationDestination(icon: Icon(m.$2), label: m.$1)],
            ),
    );
  }
}
