import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../core/api.dart';
import '../core/pixelate.dart';
import '../core/ui.dart';

/// The Client (cafe owner / manager) part of Niro.
class ClientHome extends StatefulWidget {
  const ClientHome({super.key});
  @override
  State<ClientHome> createState() => _ClientHomeState();
}

class _ClientHomeState extends State<ClientHome> {
  Map<String, dynamic>? data;
  String? error;
  int cur = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await session.api.getJson('/api/partner/cafes');
      if (mounted) setState(() {
        data = d;
        error = null;
        final n = (d['cafes'] as List).length;
        if (cur >= n) cur = 0;
      });
    } on ApiError catch (e) {
      if (mounted && data == null) setState(() => error = e.message);
    }
  }

  List<Map<String, dynamic>> get cafes => ((data?['cafes'] as List?) ?? []).cast<Map<String, dynamic>>();

  @override
  Widget build(BuildContext context) {
    if (data == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Client')),
        body: Center(child: error == null ? const CircularProgressIndicator(strokeWidth: 2) : Column(mainAxisSize: MainAxisSize.min, children: [Text(error!), TextButton(onPressed: _load, child: const Text('Try again'))])),
      );
    }
    if (cafes.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Client'), actions: [IconButton(icon: const Icon(Icons.logout), onPressed: () => session.logout())]),
        body: ListView(children: [
          const Empty('You do not manage a cafe yet.\nAdd yours and we will approve it shortly.'),
          Padding(padding: const EdgeInsets.symmetric(horizontal: 32), child: FilledButton(onPressed: _addCafe, child: const Text('Add my cafe'))),
        ]),
      );
    }
    final c = cafes[cur];
    return DefaultTabController(
      length: 6,
      child: Scaffold(
        appBar: AppBar(
          title: cafes.length > 1
              ? DropdownButton<int>(
                  value: cur,
                  underline: const SizedBox(),
                  items: [for (var i = 0; i < cafes.length; i++) DropdownMenuItem(value: i, child: Text('${cafes[i]['name']}'))],
                  onChanged: (v) => setState(() => cur = v ?? 0),
                )
              : Text('${c['name']}'),
          actions: [
            IconButton(icon: const Icon(Icons.add_business_outlined), tooltip: 'Add cafe', onPressed: _addCafe),
            IconButton(icon: const Icon(Icons.logout), onPressed: () => session.logout()),
          ],
          bottom: const TabBar(isScrollable: true, tabs: [Tab(text: 'Overview'), Tab(text: 'Offers'), Tab(text: 'Staff'), Tab(text: 'Customers'), Tab(text: 'Payroll'), Tab(text: 'Details')]),
        ),
        body: TabBarView(children: [
          _Overview(c: c, reload: _load),
          _Offers(c: c, reload: _load),
          _Staff(c: c, reload: _load),
          _Customers(key: ValueKey('cu${c['id']}'), cafeId: c['id'] as String),
          _Payroll(key: ValueKey('pa${c['id']}'), cafeId: c['id'] as String),
          _Details(key: ValueKey('de${c['id']}'), c: c, reload: _load),
        ]),
      ),
    );
  }

  Future<void> _addCafe() async {
    final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const _AddCafe()));
    if (ok == true) {
      await _load();
      if (mounted) toast(context, 'Sent for approval. It goes live once Niro approves it.');
    }
  }
}

class _Overview extends StatelessWidget {
  final Map<String, dynamic> c;
  final Future<void> Function() reload;
  const _Overview({required this.c, required this.reload});
  @override
  Widget build(BuildContext context) {
    final s = (c['stats'] as Map).cast<String, dynamic>();
    return RefreshIndicator(
      onRefresh: reload,
      child: ListView(padding: const EdgeInsets.all(16), children: [
        if (c['is_active'] != 1 && c['is_active'] != true) const Card(child: ListTile(leading: Icon(Icons.hourglass_empty), title: Text('Waiting for approval'), subtitle: Text('Customers can find your cafe once Niro approves it.'))),
        StatGrid([Stat('Members', s['members']), Stat('Stamps today', s['stamps_today']), Stat('Stamps this week', s['stamps_week']), Stat('Rewards given', s['rewards_redeemed'])]),
      ]),
    );
  }
}

class _Offers extends StatelessWidget {
  final Map<String, dynamic> c;
  final Future<void> Function() reload;
  const _Offers({required this.c, required this.reload});
  @override
  Widget build(BuildContext context) {
    final offers = (c['offers'] as List).cast<Map<String, dynamic>>();
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final t = await askText(context, 'New offer', hint: 'e.g. Buy 1 get 1 on Fridays');
          if (t == null || !context.mounted) return;
          final r = await guard(context, session.api.postJson('/api/cafes/${c['id']}/offers', {'title': t}));
          if (r != null) await reload();
        },
        icon: const Icon(Icons.add),
        label: const Text('Offer'),
      ),
      body: offers.isEmpty
          ? const Empty('No offers running.')
          : ListView(padding: const EdgeInsets.all(16), children: [
              for (final o in offers)
                Card(
                  child: ListTile(
                    title: Text('${o['title']}'),
                    subtitle: o['ends_at'] == null ? null : Text('Ends ${o['ends_at']}'),
                    trailing: IconButton(
                      icon: const Icon(Icons.delete_outline),
                      onPressed: () async {
                        final r = await guard(context, session.api.deleteJson('/api/cafes/${c['id']}/offers/${o['id']}'));
                        if (r != null) await reload();
                      },
                    ),
                  ),
                ),
            ]),
    );
  }
}

class _Staff extends StatelessWidget {
  final Map<String, dynamic> c;
  final Future<void> Function() reload;
  const _Staff({required this.c, required this.reload});
  @override
  Widget build(BuildContext context) {
    final staff = (c['staff'] as List).cast<Map<String, dynamic>>();
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _add(context),
        icon: const Icon(Icons.person_add_alt),
        label: const Text('Add staff'),
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        for (final s in staff)
          Card(
            child: ListTile(
              title: Text('${s['name'] ?? s['phone']}'),
              subtitle: Text('${s['phone']} · ₹${s['hourly_rate']}/hr${s['clocked_in_since'] != null ? ' · working now' : ''}'),
              leading: Pill('${s['role']}'),
              trailing: s['role'] == 'owner'
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.person_remove_outlined),
                      onPressed: () async {
                        if (!await confirm(context, 'Remove ${s['name'] ?? 'this person'}?', 'They will no longer be able to stamp cards.', 'Remove')) return;
                        if (!context.mounted) return;
                        final r = await guard(context, session.api.deleteJson('/api/cafes/${c['id']}/staff/${s['id']}'));
                        if (r != null) await reload();
                      },
                    ),
            ),
          ),
      ]),
    );
  }

  Future<void> _add(BuildContext context) async {
    final phone = TextEditingController(), rate = TextEditingController(text: '0');
    var role = 'staff';
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (ctx, set) => AlertDialog(
          title: const Text('Add staff'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(hintText: 'Mobile number')),
            const SizedBox(height: 8),
            TextField(controller: rate, keyboardType: TextInputType.number, decoration: const InputDecoration(hintText: 'Hourly rate (₹)')),
            const SizedBox(height: 8),
            DropdownButton<String>(value: role, isExpanded: true, items: const [DropdownMenuItem(value: 'staff', child: Text('Staff')), DropdownMenuItem(value: 'manager', child: Text('Manager'))], onChanged: (v) => set(() => role = v ?? 'staff')),
          ]),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Add'))],
        ),
      ),
    );
    if (ok != true || !context.mounted) return;
    final r = await guard(context, session.api.postJson('/api/cafes/${c['id']}/staff', {'phone': phone.text.trim(), 'role': role, 'hourly_rate': num.tryParse(rate.text) ?? 0}));
    if (r != null) await reload();
  }
}

class _Customers extends StatelessWidget {
  final String cafeId;
  const _Customers({super.key, required this.cafeId});
  @override
  Widget build(BuildContext context) {
    return Loader<Map<String, dynamic>>(
      load: () => session.api.getJson('/api/cafes/$cafeId/customers'),
      every: const Duration(seconds: 20),
      builder: (ctx, d, reload) {
        final list = ((d['customers'] as List?) ?? []).cast<Map<String, dynamic>>();
        if (list.isEmpty) return ListView(children: const [Empty('No customers yet.')]);
        return ListView(padding: const EdgeInsets.all(16), children: [
          for (final u in list)
            Card(
              child: ListTile(
                title: Text('${u['name']}'),
                subtitle: Text('•••• ${u['last4']} · ${u['stamps']} stamps · ${u['rewards_redeemed']} rewards'),
                trailing: Text(_ago(u['last_visit'] ?? u['joined_at']), style: const TextStyle(fontSize: 12, color: Colors.black54)),
              ),
            ),
        ]);
      },
    );
  }
}

String _ago(Object? iso) {
  final t = DateTime.tryParse('$iso');
  if (t == null) return '';
  final d = DateTime.now().difference(t);
  if (d.inMinutes < 1) return 'now';
  if (d.inHours < 1) return '${d.inMinutes}m';
  if (d.inDays < 1) return '${d.inHours}h';
  return '${d.inDays}d';
}

class _Payroll extends StatelessWidget {
  final String cafeId;
  const _Payroll({super.key, required this.cafeId});
  @override
  Widget build(BuildContext context) {
    final t = DateTime.now();
    String iso(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    final from = iso(DateTime(t.year, t.month, 1)), to = iso(t);
    return Loader<Map<String, dynamic>>(
      load: () => session.api.getJson('/api/cafes/$cafeId/payroll?from=$from&to=$to'),
      builder: (ctx, d, reload) {
        final rows = ((d['rows'] as List?) ?? []).cast<Map<String, dynamic>>();
        return ListView(padding: const EdgeInsets.all(16), children: [
          Text('This month ($from to $to)', style: const TextStyle(color: Colors.black54)),
          if (rows.isEmpty) const Empty('No shifts recorded.'),
          for (final r in rows)
            Card(
              child: ListTile(
                title: Text('${r['name'] ?? r['phone']}'),
                subtitle: Text('${r['hours']} hours × ₹${r['hourly_rate']}'),
                trailing: Text('₹${r['pay']}', style: const TextStyle(fontWeight: FontWeight.w800)),
              ),
            ),
        ]);
      },
    );
  }
}

class _Details extends StatefulWidget {
  final Map<String, dynamic> c;
  final Future<void> Function() reload;
  const _Details({super.key, required this.c, required this.reload});
  @override
  State<_Details> createState() => _DetailsState();
}

class _DetailsState extends State<_Details> {
  late final name = TextEditingController(text: '${widget.c['name']}');
  late final area = TextEditingController(text: '${widget.c['area'] ?? ''}');
  late final reward = TextEditingController(text: '${widget.c['reward_text']}');
  late final goal = TextEditingController(text: '${widget.c['stamp_goal']}');
  late final opens = TextEditingController(text: '${widget.c['opens'] ?? ''}');
  late final closes = TextEditingController(text: '${widget.c['closes'] ?? ''}');
  late Map<String, dynamic> brand = {...(widget.c['brand'] as Map).cast<String, dynamic>()};
  static const swatches = ['#111111', '#ffffff', '#3b2418', '#c8a165', '#1f6f50', '#d9534f', '#2d5da1', '#f4b942', '#e8d9c4'];

  Widget _color(String key, String label) {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontSize: 12, color: Colors.black54)),
        const SizedBox(height: 4),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final h in swatches)
            GestureDetector(
              onTap: () => setState(() => brand[key] = h),
              child: Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(color: hexColor(h), shape: BoxShape.circle, border: Border.all(color: brand[key] == h ? Colors.blue : Colors.black26, width: brand[key] == h ? 3 : 1)),
              ),
            ),
        ]),
      ]),
    );
  }

  Future<void> _pickArt() async {
    final f = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 800);
    if (f == null) return;
    final art = pixelate(await f.readAsBytes());
    if (!mounted) return;
    if (art == null) {
      toast(context, 'Could not read that image');
      return;
    }
    setState(() => brand['art'] = art);
  }

  @override
  Widget build(BuildContext context) {
    final preview = {...widget.c, 'name': name.text, 'brand': brand, 'reward_text': reward.text, 'stamp_goal': int.tryParse(goal.text) ?? 8};
    return ListView(padding: const EdgeInsets.all(16), children: [
      LoyaltyCard(cafe: preview, stamps: 3),
      const SizedBox(height: 12),
      Row(children: [
        Expanded(child: OutlinedButton.icon(onPressed: _pickArt, icon: const Icon(Icons.image_outlined), label: Text(brand['art'] == null ? 'Upload design' : 'Change design'))),
        if (brand['art'] != null) TextButton(onPressed: () => setState(() => brand.remove('art')), child: const Text('Remove')),
      ]),
      const Padding(padding: EdgeInsets.only(top: 4), child: Text('Niro turns your picture into pixel art for the card.', style: TextStyle(fontSize: 12, color: Colors.black54))),
      _color('bg', 'Card colour'),
      _color('ink', 'Text colour'),
      _color('acc', 'Stamp colour'),
      const SizedBox(height: 12),
      for (final f in [(name, 'Cafe name'), (area, 'Area'), (reward, 'Reward'), (goal, 'Stamps for a reward'), (opens, 'Opens (HH:MM)'), (closes, 'Closes (HH:MM)')])
        Padding(padding: const EdgeInsets.only(top: 8), child: TextField(controller: f.$1, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: f.$2))),
      const SizedBox(height: 16),
      FilledButton(
        onPressed: () async {
          final r = await guard(context, session.api.patchJson('/api/cafes/${widget.c['id']}', {
            'name': name.text.trim(),
            'area': area.text.trim().isEmpty ? null : area.text.trim(),
            'reward_text': reward.text.trim(),
            'stamp_goal': int.tryParse(goal.text) ?? 8,
            'opens': opens.text.trim().isEmpty ? null : opens.text.trim(),
            'closes': closes.text.trim().isEmpty ? null : closes.text.trim(),
            'brand': {'bg': brand['bg'], 'ink': brand['ink'], 'acc': brand['acc'], 'pattern': brand['pattern'] ?? 'dots', if (brand['art'] != null) 'art': brand['art']},
          }));
          if (r != null) {
            await widget.reload();
            if (context.mounted) toast(context, 'Saved');
          }
        },
        child: const Text('Save changes'),
      ),
      const Padding(padding: EdgeInsets.only(top: 8), child: Text('The map location can only be moved by Niro.', style: TextStyle(fontSize: 12, color: Colors.black54))),
    ]);
  }
}

class _AddCafe extends StatefulWidget {
  const _AddCafe();
  @override
  State<_AddCafe> createState() => _AddCafeState();
}

class _AddCafeState extends State<_AddCafe> {
  final name = TextEditingController(), area = TextEditingController(), city = TextEditingController(text: 'Mysuru'), reward = TextEditingController(text: 'Free filter coffee');
  final lat = TextEditingController(), lng = TextEditingController();
  bool busy = false;

  @override
  Widget build(BuildContext context) {
    Widget f(TextEditingController c, String l, {TextInputType? t}) => Padding(padding: const EdgeInsets.only(bottom: 8), child: TextField(controller: c, keyboardType: t, decoration: InputDecoration(labelText: l)));
    return Scaffold(
      appBar: AppBar(title: const Text('Add your cafe')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        f(name, 'Cafe name'),
        f(area, 'Area'),
        f(city, 'City'),
        f(reward, 'Reward'),
        f(lat, 'Latitude', t: const TextInputType.numberWithOptions(decimal: true, signed: true)),
        f(lng, 'Longitude', t: const TextInputType.numberWithOptions(decimal: true, signed: true)),
        const Text('Tip: open your cafe in Google Maps, long-press the pin and copy the two numbers.', style: TextStyle(fontSize: 12, color: Colors.black54)),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: busy
              ? null
              : () async {
                  setState(() => busy = true);
                  final r = await guard(context, session.api.postJson('/api/cafes', {
                    'name': name.text.trim(),
                    'area': area.text.trim(),
                    'city': city.text.trim(),
                    'reward_text': reward.text.trim(),
                    'lat': double.tryParse(lat.text.trim()),
                    'lng': double.tryParse(lng.text.trim()),
                  }));
                  if (!mounted) return;
                  setState(() => busy = false);
                  if (r != null) Navigator.pop(context, true);
                },
          child: Text(busy ? 'Sending…' : 'Send for approval'),
        ),
      ]),
    );
  }
}
