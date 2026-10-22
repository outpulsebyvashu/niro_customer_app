import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/ui.dart';

/// The Admin part of Niro: the whole platform at a glance.
class AdminHome extends StatelessWidget {
  const AdminHome({super.key});
  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 5,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Admin'),
          actions: [IconButton(icon: const Icon(Icons.logout), onPressed: () => session.logout())],
          bottom: const TabBar(isScrollable: true, tabs: [Tab(text: 'Overview'), Tab(text: 'Users'), Tab(text: 'Staff'), Tab(text: 'Cafes'), Tab(text: 'Support')]),
        ),
        body: const TabBarView(children: [_Overview(), _Users(), _StaffList(), _Cafes(), _Support()]),
      ),
    );
  }
}

class _Overview extends StatelessWidget {
  const _Overview();
  @override
  Widget build(BuildContext context) {
    return Loader<Map<String, dynamic>>(
      load: () => session.api.getJson('/api/admin/overview'),
      every: const Duration(seconds: 20),
      builder: (ctx, d, reload) => ListView(padding: const EdgeInsets.all(16), children: [
        StatGrid([
          Stat('Users', d['users']),
          Stat('Customers', d['customers']),
          Stat('Clients', d['clients']),
          Stat('Staff', d['staff']),
          Stat('Working now', d['working_now']),
          Stat('Live cafes', d['cafes_live']),
          Stat('Pending cafes', d['cafes_pending']),
          Stat('Cards', d['cards']),
          Stat('Stamps today', d['stamps_today']),
          Stat('Rewards given', d['rewards_redeemed']),
          Stat('Open support', d['support_open']),
        ]),
      ]),
    );
  }
}

class _Users extends StatefulWidget {
  const _Users();
  @override
  State<_Users> createState() => _UsersState();
}

class _UsersState extends State<_Users> {
  String q = '';
  String filter = 'all';
  @override
  Widget build(BuildContext context) {
    return Loader<Map<String, dynamic>>(
      load: () => session.api.getJson('/api/admin/users'),
      every: const Duration(seconds: 30),
      builder: (ctx, d, reload) {
        var list = ((d['users'] as List?) ?? []).cast<Map<String, dynamic>>();
        list = list.where((u) {
          if (filter == 'clients' && (u['is_client'] ?? 0) == 0) return false;
          if (filter == 'staff' && (u['is_staff'] ?? 0) == 0) return false;
          if (filter == 'customers' && (u['cards'] ?? 0) == 0) return false;
          final s = '${u['name']} ${u['phone']} ${u['email']}'.toLowerCase();
          return s.contains(q.toLowerCase());
        }).toList();
        return ListView(padding: const EdgeInsets.all(16), children: [
          TextField(onChanged: (v) => setState(() => q = v), decoration: const InputDecoration(hintText: 'Search name or number', prefixIcon: Icon(Icons.search))),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            for (final f in ['all', 'customers', 'clients', 'staff']) ChoiceChip(label: Text(f), selected: filter == f, onSelected: (_) => setState(() => filter = f)),
          ]),
          const SizedBox(height: 8),
          Text('${list.length} people', style: const TextStyle(color: Colors.black54)),
          for (final u in list)
            Card(
              child: ListTile(
                title: Text('${u['name'] ?? '(no name)'}'),
                subtitle: Text('${u['phone']} · ${u['cards']} cards${u['jobs'] != null ? '\n${u['jobs']}' : ''}'),
                isThreeLine: u['jobs'] != null,
              ),
            ),
        ]);
      },
    );
  }
}

class _StaffList extends StatelessWidget {
  const _StaffList();
  @override
  Widget build(BuildContext context) {
    return Loader<Map<String, dynamic>>(
      load: () => session.api.getJson('/api/admin/staff'),
      every: const Duration(seconds: 20),
      builder: (ctx, d, reload) {
        final list = ((d['staff'] as List?) ?? []).cast<Map<String, dynamic>>();
        if (list.isEmpty) return ListView(children: const [Empty('No staff yet.')]);
        return ListView(padding: const EdgeInsets.all(16), children: [
          for (final s in list)
            Card(
              child: ListTile(
                leading: Pill('${s['role']}'),
                title: Text('${s['name'] ?? s['phone']}'),
                subtitle: Text('${s['cafe']} · ${s['phone']}'),
                trailing: s['clocked_in_since'] != null ? const Pill('working', color: Colors.green) : null,
              ),
            ),
        ]);
      },
    );
  }
}

class _Cafes extends StatelessWidget {
  const _Cafes();
  @override
  Widget build(BuildContext context) {
    return Loader<Map<String, dynamic>>(
      load: () => session.api.getJson('/api/admin/cafes'),
      every: const Duration(seconds: 30),
      builder: (ctx, d, reload) {
        final list = ((d['cafes'] as List?) ?? []).cast<Map<String, dynamic>>();
        return ListView(padding: const EdgeInsets.all(16), children: [
          for (final c in list)
            Card(
              child: ListTile(
                title: Text('${c['name']}'),
                subtitle: Text('${c['area'] ?? c['city']} · ${c['members']} members'),
                leading: Pill(c['is_active'] == 1 ? 'live' : 'pending', color: c['is_active'] == 1 ? Colors.green : Colors.orange),
                trailing: PopupMenuButton<String>(
                  onSelected: (v) async {
                    if (v == 'delete') {
                      if (!await confirm(ctx, 'Delete ${c['name']}?', 'Its cards, offers and staff are removed for good.', 'Delete')) return;
                      if (!ctx.mounted) return;
                      final r = await guard(ctx, session.api.deleteJson('/api/admin/cafes/${c['id']}'));
                      if (r != null) await reload();
                    } else {
                      final r = await guard(ctx, session.api.patchJson('/api/admin/cafes/${c['id']}', {'is_active': v == 'approve'}));
                      if (r != null) await reload();
                    }
                  },
                  itemBuilder: (_) => [
                    PopupMenuItem(value: c['is_active'] == 1 ? 'hide' : 'approve', child: Text(c['is_active'] == 1 ? 'Hide' : 'Approve')),
                    const PopupMenuItem(value: 'delete', child: Text('Delete')),
                  ],
                ),
              ),
            ),
        ]);
      },
    );
  }
}

class _Support extends StatefulWidget {
  const _Support();
  @override
  State<_Support> createState() => _SupportState();
}

class _SupportState extends State<_Support> {
  String status = 'open';
  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Padding(
        padding: const EdgeInsets.all(12),
        child: SegmentedButton<String>(
          segments: const [ButtonSegment(value: 'open', label: Text('Open')), ButtonSegment(value: 'closed', label: Text('Closed'))],
          selected: {status},
          onSelectionChanged: (s) => setState(() => status = s.first),
        ),
      ),
      Expanded(
        child: Loader<Map<String, dynamic>>(
          key: ValueKey(status),
          load: () => session.api.getJson('/api/admin/support?status=$status'),
          every: const Duration(seconds: 30),
          builder: (ctx, d, reload) {
            final list = ((d['messages'] as List?) ?? []).cast<Map<String, dynamic>>();
            if (list.isEmpty) return ListView(children: const [Empty('Nothing here.')]);
            return ListView(padding: const EdgeInsets.symmetric(horizontal: 16), children: [
              for (final m in list)
                Card(
                  child: ListTile(
                    title: Text('${m['message']}'),
                    subtitle: Text('${m['contact'] ?? 'signed-in user'} · ${'${m['created_at']}'.replaceFirst('T', ' ').split('.').first}'),
                    trailing: IconButton(
                      icon: Icon(status == 'open' ? Icons.check_circle_outline : Icons.undo),
                      onPressed: () async {
                        final r = await guard(ctx, session.api.patchJson('/api/admin/support/${m['id']}', {'status': status == 'open' ? 'closed' : 'open'}));
                        if (r != null) await reload();
                      },
                    ),
                  ),
                ),
            ]);
          },
        ),
      ),
    ]);
  }
}
