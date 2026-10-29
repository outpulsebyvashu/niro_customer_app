package cards.niro.customer

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.bluetooth.BluetoothAdapter
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Listens for Niro cafe beacons (see BeaconProtocol) with a low-power Bluetooth scan that the system keeps running
 * and delivers to BeaconReceiver, even when Niro is closed. On a hit the server decides (same limits as location alerts).
 */
object BeaconScan {
    private const val ACTION = "cards.niro.BEACON_SEEN"

    fun canScan(ctx: Context): Boolean =
        if (Build.VERSION.SDK_INT >= 31) {
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        }

    private fun pending(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
        ctx, 8, Intent(ctx, BeaconReceiver::class.java).setAction(ACTION),
        PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
    )

    private fun scanner(ctx: Context): BluetoothLeScanner? =
        ctx.getSystemService(android.bluetooth.BluetoothManager::class.java)?.adapter?.takeIf { it.isEnabled }?.bluetoothLeScanner

    /** Starts (or restarts) the scan when the person is signed in, has nearby alerts on and has allowed Bluetooth scanning. */
    @SuppressLint("MissingPermission")
    fun apply(ctx: Context) {
        if (!Net.signedIn(ctx) || !canScan(ctx)) return
        if (ctx.getSharedPreferences("niro_native", Context.MODE_PRIVATE).getString("fences", null) == null) return
        val sc = scanner(ctx) ?: return
        try {
            val filter = ScanFilter.Builder()
                .setServiceData(BeaconProtocol.SERVICE_UUID, byteArrayOf(BeaconProtocol.MAGIC), byteArrayOf(0xFF.toByte()))
                .build()
            val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_POWER)
                .setCallbackType(ScanSettings.CALLBACK_TYPE_FIRST_MATCH)
                .setMatchMode(ScanSettings.MATCH_MODE_STICKY)
                .build()
            sc.stopScan(pending(ctx))
            sc.startScan(listOf(filter), settings, pending(ctx))
        } catch (_: Throwable) {
        }
    }

    private var live: ScanCallback? = null

    /** While Niro is open: a fast scan, so a nearby beacon is noticed straight away (the background scan can be slow on some phones). */
    @SuppressLint("MissingPermission")
    fun startLive(ctx: Context) {
        if (live != null || !Net.signedIn(ctx) || !canScan(ctx)) return
        val sc = scanner(ctx) ?: return
        val app = ctx.applicationContext
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val code = BeaconProtocol.parse(result.scanRecord?.getServiceData(BeaconProtocol.SERVICE_UUID)) ?: return
                Thread {
                    try {
                        BeaconReceiver.heard(app, code)
                    } catch (_: Throwable) {
                    }
                }.start()
            }
        }
        try {
            val filter = ScanFilter.Builder()
                .setServiceData(BeaconProtocol.SERVICE_UUID, byteArrayOf(BeaconProtocol.MAGIC), byteArrayOf(0xFF.toByte()))
                .build()
            sc.startScan(listOf(filter), ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), cb)
            live = cb
        } catch (_: Throwable) {
        }
    }

    @SuppressLint("MissingPermission")
    fun stopLive(ctx: Context) {
        val cb = live ?: return
        live = null
        try {
            if (canScan(ctx)) scanner(ctx)?.stopScan(cb)
        } catch (_: Throwable) {
        }
    }

    @SuppressLint("MissingPermission")
    fun stop(ctx: Context) {
        try {
            if (canScan(ctx)) scanner(ctx)?.stopScan(pending(ctx))
        } catch (_: Throwable) {
        }
    }

    /** Bluetooth switched off and on again drops the scan, so start it again when the phone's Bluetooth turns back on. */
    fun watchBluetooth(app: Context) {
        try {
            app.registerReceiver(object : BroadcastReceiver() {
                override fun onReceive(c: Context, i: Intent) {
                    if (i.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1) == BluetoothAdapter.STATE_ON) {
                        val r = goAsync()
                        Thread { try { apply(c.applicationContext) } finally { r.finish() } }.start()
                    }
                }
            }, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED))
        } catch (_: Throwable) {
        }
    }
}

class BeaconReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        @Suppress("DEPRECATION")
        val results: List<ScanResult> = (if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableArrayListExtra(BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT, ScanResult::class.java)
        } else {
            intent.getParcelableArrayListExtra<ScanResult>(BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT)
        }) ?: return
        val codes = results.mapNotNull { BeaconProtocol.parse(it.scanRecord?.getServiceData(BeaconProtocol.SERVICE_UUID)) }.distinct()
        if (codes.isEmpty()) return
        val app = ctx.applicationContext
        val result = goAsync()
        Thread {
            try {
                codes.forEach { BeaconReceiver.heard(app, it) }
            } catch (_: Throwable) {
            } finally {
                result.finish()
            }
        }.start()
    }

    companion object {
        /**
         * A cafe beacon is nearby: ask the server (it applies the same-cafe-once and 2-a-day limits and the cafe's own switches), then alert.
         * Settled answers are remembered for the day; a "not now" answer (paused, closed) is retried after two minutes.
         */
        fun heard(ctx: Context, code: String) {
            val p = ctx.getSharedPreferences("niro_native", Context.MODE_PRIVATE)
            val key = "bsent-" + Geo.istDay() + "-" + code
            if (p.getBoolean(key, false)) return
            val now = System.currentTimeMillis()
            if (now - p.getLong("btry-" + code, 0L) < 120_000L) return
            p.edit().putLong("btry-" + code, now).apply()
            val r = Net.call(ctx, "POST", "/api/beacon-alerts", JSONObject().put("code", code).toString()) ?: return
            if (r.first != 200) return
            val res = JSONObject(r.second)
            if (!res.optBoolean("allowed")) {
                when (res.optString("reason")) {
                    "already", "daily_limit", "off" -> p.edit().putBoolean(key, true).apply()
                }
                return
            }
            p.edit().putBoolean(key, true).apply()
            val cafe = res.optJSONObject("cafe") ?: return
            val offer = cafe.optString("offer").ifBlank { "Show your Niro card and collect a stamp." }
            Notifier.show(ctx, Notifier.OFFERS, "You’re at " + cafe.optString("name", "a partner cafe"), offer, code.hashCode())
        }
    }
}
