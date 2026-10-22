import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/ui.dart';

class CustomerHome extends StatelessWidget {
  const CustomerHome({super.key});
  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('niro', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 26, letterSpacing: -1)),
          bottom: const TabBar(tabs: [Tab(text: 'Cards'), Tab(text: 'Nearby'), Tab(text: 'Profile')]),
        ),
        body: const TabBarView(children: [CardsTab(), NearbyTab(), ProfileTab()]),
      ),
    );
  }
}

Future<Map<String, dynamic>> _loadCards() => session.api.getJson('/api/memberships');

class CardsTab extends StatelessWidget {
  const CardsTab({super.key});
  @override
  Widget build(BuildContext context) {
    return Loader<Map<String, dynamic>>(
      load: _loadCards,
      every: const Duration(seconds: 8),
      live: session.api.live(),
      builder: (ctx, d, reload) {
        final cards = ((d['cards'] as List?) ?? []).cast<Map<String, dynamic>>();
        if (cards.isEmpty) {
          return ListView(children: const [Empty('No cards yet.\nOpen Nearby and join a cafe to get your first loyalty card.')]);
        }
        return ListView(padding: const EdgeInsets.all(16), children: [
          for (final c in cards)
            Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: LoyaltyCard(
                cafe: (c['cafe'] as Map).cast<String, dynamic>(),
                stamps: (c['stamps'] as num).toInt(),
                onTap: () => Navigator.push(ctx, MaterialPageRoute(builder: (_) => CardPage(card: c))),
              ),
            ),
        ]);
      },
    );
  }
}

/// One card: the QR code the cafe scans, live stamps and history.
class CardPage extends StatelessWidget {
  final Map<String, dynamic> card;
  const CardPage({super.key, required this.card});

  @override
  Widget build(BuildContext context) {
    final id = card['id'] as String;
    final cafe = (card['cafe'] as Map).cast<String, dynamic>();
    return Scaffold(
      appBar: AppBar(title: Text('${cafe['name']}')),
      body: Loader<Map<String, dynamic>>(
        load: () async {
          final all = await _loadCards();
          final mine = ((all['cards'] as List).cast<Map<String, dynamic>>()).firstWhere((x) => x['id'] == id, orElse: () => card);
          final h = await session.api.getJson('/api/memberships/$id/history');
          return {'card': mine, 'events': h['events']};
        },
        every: const Duration(milliseconds: 2500),
        live: session.api.live(),
        builder: (ctx, d, reload) {
          final c = (d['card'] as Map).cast<String, dynamic>();
          final events = ((d['events'] as List?) ?? []).cast<Map<String, dynamic>>();
          final goal = (cafe['stamp_goal'] as num).toInt();
          final stamps = (c['stamps'] as num).toInt();
          return ListView(padding: const EdgeInsets.all(16), children: [
            LoyaltyCard(cafe: cafe, stamps: stamps),
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(children: [
                  QrImageView(data: '${c['member_code']}', size: 210, backgroundColor: Colors.white),
                  const SizedBox(height: 6),
                  Text('${c['member_code']}', style: const TextStyle(letterSpacing: 2, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Text(stamps >= goal ? 'Reward ready. Show this at the counter.' : 'Show this at the counter to collect a stamp.',
                      textAlign: TextAlign.center, style: const TextStyle(color: Colors.black54)),
                ]),
              ),
            ),
            if (events.isNotEmpty) ...[
              const Padding(padding: EdgeInsets.fromLTRB(4, 12, 4, 4), child: Text('History', style: TextStyle(fontWeight: FontWeight.w800))),
              for (final e in events)
                ListTile(
                  dense: true,
                  leading: Icon(e['kind'] == 'redeem' ? Icons.card_giftcard : Icons.add_circle_outline),
                  title: Text(e['kind'] == 'redeem' ? 'Reward redeemed' : '+${e['qty']} stamp${e['qty'] == 1 ? '' : 's'}'),
                  subtitle: Text('${e['created_at']}'.replaceFirst('T', ' ').split('.').first),
                ),
            ],
            if (session.api.token != null && (session.me?['google_wallet'] == true))
              OutlinedButton.icon(
                icon: const Icon(Icons.account_balance_wallet_outlined),
                label: const Text('Add to Google Wallet'),
                onPressed: () async {
                  final r = await guard(ctx, session.api.getJson('/api/memberships/$id/wallet/google'));
                  final u = r?['url'] as String?;
                  if (u != null) await launchUrl(Uri.parse(u), mode: LaunchMode.externalApplication);
                },
              ),
            TextButton(
              onPressed: () async {
                if (!await confirm(ctx, 'Remove this card?', 'Your stamps at ${cafe['name']} will be lost.', 'Remove')) return;
                if (!ctx.mounted) return;
                final r = await guard(ctx, session.api.deleteJson('/api/memberships/$id'));
                if (r != null && ctx.mounted) Navigator.pop(ctx);
              },
              child: const Text('Remove card', style: TextStyle(color: Colors.red)),
            ),
          ]);
        },
      ),
    );
  }
}

class NearbyTab extends StatefulWidget {
  const NearbyTab({super.key});
  @override
  State<NearbyTab> createState() => _NearbyTabState();
}

class _NearbyTabState extends State<NearbyTab> with AutomaticKeepAliveClientMixin {
  LatLng? here;
  List<Map<String, dynamic>> cafes = [];
  Set<String> joined = {};
  String? error;
  bool loading = true;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _find();
  }

  Future<void> _find() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        throw ApiError('Allow location to see cafes near you.', 0);
      }
      final p = await Geolocator.getCurrentPosition();
      here = LatLng(p.latitude, p.longitude);
      final r = await session.api.getJson('/api/cafes/nearby?lat=${p.latitude}&lng=${p.longitude}');
      final m = await session.api.getJson('/api/memberships');
      cafes = ((r['cafes'] as List?) ?? []).cast<Map<String, dynamic>>();
      joined = ((m['cards'] as List?) ?? []).map((c) => ((c as Map)['cafe'] as Map)['id'] as String).toSet();
    } on ApiError catch (e) {
      error = e.message;
    } catch (_) {
      error = 'Could not get your location.';
    }
    if (mounted) setState(() => loading = false);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (loading) return const Center(child: CircularProgressIndicator(strokeWidth: 2));
    if (error != null) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(error!),
          const SizedBox(height: 10),
          OutlinedButton(onPressed: _find, child: const Text('Try again')),
        ]),
      );
    }
    return Column(children: [
      SizedBox(
        height: 220,
        child: FlutterMap(
          options: MapOptions(initialCenter: here!, initialZoom: 15),
          children: [
            TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'cards.niro.app'),
            MarkerLayer(markers: [
              Marker(point: here!, width: 20, height: 20, child: Container(decoration: BoxDecoration(color: Colors.blue, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3)))),
              for (final c in cafes)
                Marker(point: LatLng((c['lat'] as num).toDouble(), (c['lng'] as num).toDouble()), width: 34, height: 34, child: const Icon(Icons.location_on, color: kInk, size: 34)),
            ]),
          ],
        ),
      ),
      Expanded(
        child: RefreshIndicator(
          onRefresh: _find,
          child: cafes.isEmpty
              ? ListView(children: const [Empty('No Niro cafes nearby yet.')])
              : ListView(padding: const EdgeInsets.all(12), children: [
                  for (final c in cafes)
                    Card(
                      child: ListTile(
                        title: Text('${c['name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text('${c['area'] ?? c['city']} · ${_dist(c['distance_m'])}\n${c['reward_text']} after ${c['stamp_goal']} stamps'),
                        isThreeLine: true,
                        trailing: joined.contains(c['id'])
                            ? const Pill('Joined')
                            : FilledButton(
                                style: FilledButton.styleFrom(minimumSize: const Size(70, 38)),
                                onPressed: () async {
                                  final r = await guard(context, session.api.postJson('/api/cafes/${c['id']}/join', {}));
                                  if (r != null && mounted) {
                                    setState(() => joined.add(c['id'] as String));
                                    toast(context, 'Card added. Find it in Cards.');
                                  }
                                },
                                child: const Text('Join'),
                              ),
                      ),
                    ),
                ]),
        ),
      ),
    ]);
  }

  String _dist(Object? m) {
    final n = (m as num?)?.toInt() ?? 0;
    return n < 1000 ? '$n m' : '${(n / 1000).toStringAsFixed(1)} km';
  }
}

class ProfileTab extends StatelessWidget {
  const ProfileTab({super.key});
  @override
  Widget build(BuildContext context) {
    final me = session.me ?? {};
    return ListView(padding: const EdgeInsets.all(16), children: [
      Card(
        child: ListTile(
          title: Text(session.name.isEmpty ? 'Add your name' : session.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
          subtitle: Text('${me['phone'] ?? ''}'),
          trailing: const Icon(Icons.edit_outlined),
          onTap: () async {
            final n = await askText(context, 'Your name', initial: session.name);
            if (n == null || !context.mounted) return;
            final r = await guard(context, session.api.patchJson('/api/me', {'name': n}));
            if (r != null) await session.refresh();
          },
        ),
      ),
      Card(
        child: Column(children: [
          ListTile(
            leading: const Icon(Icons.support_agent),
            title: const Text('Contact support'),
            onTap: () async {
              final m = await askText(context, 'How can we help?');
              if (m == null || !context.mounted) return;
              final r = await guard(context, session.api.postJson('/api/support', {'message': m}));
              if (r != null && context.mounted) toast(context, 'Sent. We will get back to you.');
            },
          ),
          ListTile(
            leading: const Icon(Icons.logout),
            title: const Text('Sign out'),
            onTap: () => session.logout(),
          ),
          ListTile(
            leading: const Icon(Icons.delete_outline, color: Colors.red),
            title: const Text('Delete my account', style: TextStyle(color: Colors.red)),
            onTap: () async {
              if (!await confirm(context, 'Delete account?', 'All your cards and data will be erased. This cannot be undone.', 'Delete')) return;
              if (!context.mounted) return;
              final r = await guard(context, session.api.deleteJson('/api/me'));
              if (r != null) await session.afterDelete();
            },
          ),
        ]),
      ),
    ]);
  }
}
