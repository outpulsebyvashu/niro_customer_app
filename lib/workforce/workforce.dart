import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../core/api.dart';
import '../core/ui.dart';

class WorkforceHome extends StatefulWidget {
  const WorkforceHome({super.key});
  @override
  State<WorkforceHome> createState() => _WorkforceHomeState();
}

class _WorkforceHomeState extends State<WorkforceHome> {
  int job = 0;
  Map<String, dynamic>? card; // the scanned customer
  String? code;
  int qty = 1;
  int bump = 0; // refreshes the "today" list

  Map<String, dynamic>? get current {
    if (session.jobs.isEmpty) return null;
    return session.jobs[job.clamp(0, session.jobs.length - 1)];
  }

  Future<void> _lookup(String c) async {
    final r = await guard(context, session.api.getJson('/api/staff/card?code=${Uri.encodeComponent(c.trim())}'));
    if (r != null && mounted) {
      setState(() {
        card = r;
        code = c.trim();
        qty = 1;
      });
    }
  }

  Future<void> _scan() async {
    final c = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => const ScanPage()));
    if (c != null && c.isNotEmpty) await _lookup(c);
  }

  @override
  Widget build(BuildContext context) {
    final j = current;
    if (j == null) {
      return Scaffold(appBar: AppBar(title: const Text('Workforce')), body: const Empty('You are not added to any cafe yet. Ask your manager to add your number.'));
    }
    final since = j['clocked_in_since'] as String?;
    final cafeId = j['cafe_id'] as String;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Workforce'),
        actions: [
          if (session.jobs.length > 1)
            PopupMenuButton<int>(
              icon: const Icon(Icons.swap_horiz),
              onSelected: (i) => setState(() {
                job = i;
                card = null;
              }),
              itemBuilder: (_) => [for (var i = 0; i < session.jobs.length; i++) PopupMenuItem(value: i, child: Text('${session.jobs[i]['name']}'))],
            ),
          IconButton(icon: const Icon(Icons.logout), onPressed: () => session.logout()),
        ],
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Card(
          child: ListTile(
            title: Text('${j['name']}', style: const TextStyle(fontWeight: FontWeight.w800)),
            subtitle: Text(since == null ? 'Off shift' : 'On shift since ${_time(since)}'),
            trailing: FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(100, 40), backgroundColor: since == null ? kInk : Colors.red),
              onPressed: () async {
                final path = since == null ? '/api/staff/clock-in' : '/api/staff/clock-out';
                final r = await guard(context, session.api.postJson(path, {'cafe_id': cafeId}));
                if (r != null) {
                  await session.refresh();
                  if (mounted) setState(() {});
                }
              },
              child: Text(since == null ? 'Clock in' : 'Clock out'),
            ),
          ),
        ),
        const SizedBox(height: 8),
        FilledButton.icon(onPressed: _scan, icon: const Icon(Icons.qr_code_scanner), label: const Text('Scan customer QR')),
        TextButton(
          onPressed: () async {
            final c = await askText(context, 'Card code', hint: 'Type the code under the QR');
            if (c != null) await _lookup(c);
          },
          child: const Text('Enter code instead'),
        ),
        if (card != null) _CardPanel(card: card!, code: code!, qty: qty, onQty: (v) => setState(() => qty = v), onChanged: (c) => setState(() {
              card = c;
              bump++;
            }), reloadCard: () => _lookup(code!)),
        const Padding(padding: EdgeInsets.fromLTRB(4, 18, 4, 6), child: Text('Today', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
        Loader<Map<String, dynamic>>(
          key: ValueKey('$cafeId-$bump'),
          load: () => session.api.getJson('/api/staff/today?cafe_id=$cafeId'),
          every: const Duration(seconds: 20),
          builder: (ctx, d, reload) {
            final ev = ((d['events'] as List?) ?? []).cast<Map<String, dynamic>>();
            return Column(children: [
              Align(alignment: Alignment.centerLeft, child: Text('${d['stamps']} stamps given', style: const TextStyle(color: Colors.black54))),
              if (ev.isEmpty) const Empty('Nothing yet today.'),
              for (final e in ev)
                ListTile(
                  dense: true,
                  leading: Icon(e['kind'] == 'redeem' ? Icons.card_giftcard : Icons.add_circle_outline),
                  title: Text('${e['customer']}'),
                  subtitle: Text(e['kind'] == 'redeem' ? 'Reward' : '+${e['qty']}'),
                ),
            ]);
          },
        ),
      ]),
    );
  }

  String _time(String iso) {
    final t = DateTime.tryParse(iso)?.toLocal();
    if (t == null) return '';
    return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  }
}

class _CardPanel extends StatelessWidget {
  final Map<String, dynamic> card;
  final String code;
  final int qty;
  final ValueChanged<int> onQty;
  final ValueChanged<Map<String, dynamic>> onChanged;
  final Future<void> Function() reloadCard;
  const _CardPanel({required this.card, required this.code, required this.qty, required this.onQty, required this.onChanged, required this.reloadCard});

  @override
  Widget build(BuildContext context) {
    final goal = (card['stamp_goal'] as num).toInt();
    final stamps = (card['stamps'] as num).toInt();
    final full = stamps >= goal;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(children: [
          Text('${card['name']}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          Text('${card['cafe']}', style: const TextStyle(color: Colors.black54)),
          const SizedBox(height: 10),
          Text('$stamps / $goal stamps', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900)),
          Text('${card['reward_text']}', style: const TextStyle(color: Colors.black54)),
          const SizedBox(height: 12),
          if (full)
            FilledButton(
              onPressed: () async {
                final r = await guard(context, session.api.postJson('/api/staff/redeem', {'code': code}));
                if (r != null) {
                  toast(context, 'Reward given');
                  onChanged({...card, 'stamps': r['stamps']});
                }
              },
              child: const Text('Give reward'),
            )
          else ...[
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              IconButton(onPressed: qty > 1 ? () => onQty(qty - 1) : null, icon: const Icon(Icons.remove_circle_outline)),
              Text('$qty', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              IconButton(onPressed: qty < goal - stamps ? () => onQty(qty + 1) : null, icon: const Icon(Icons.add_circle_outline)),
            ]),
            FilledButton(
              onPressed: () async {
                final r = await guard(context, session.api.postJson('/api/staff/stamp', {'code': code, 'qty': qty}));
                if (r != null) {
                  toast(context, 'Stamped');
                  onChanged({...card, 'stamps': r['stamps']});
                }
              },
              child: Text('Add $qty stamp${qty == 1 ? '' : 's'}'),
            ),
          ],
        ]),
      ),
    );
  }
}

class ScanPage extends StatefulWidget {
  const ScanPage({super.key});
  @override
  State<ScanPage> createState() => _ScanPageState();
}

class _ScanPageState extends State<ScanPage> {
  bool done = false;
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan QR')),
      body: MobileScanner(
        onDetect: (BarcodeCapture cap) {
          if (done) return;
          for (final b in cap.barcodes) {
            final v = b.rawValue;
            if (v != null && v.isNotEmpty) {
              done = true;
              Navigator.pop(context, v);
              return;
            }
          }
        },
      ),
    );
  }
}
