package cards.niro.customer

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/** Helpers the Partner app's screen uses to start, stop and read the beacon. State lives in SharedPreferences. */
object Beacon {
    private const val P = "niro_beacon"
    private fun p(ctx: Context) = ctx.getSharedPreferences(P, Context.MODE_PRIVATE)

    fun adapter(ctx: Context) = ctx.getSystemService(BluetoothManager::class.java)?.adapter

    fun supported(ctx: Context): Boolean = try {
        ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE) && adapter(ctx) != null
    } catch (_: Throwable) {
        false
    }

    fun on(ctx: Context) = p(ctx).getBoolean("on", false)
    fun set(ctx: Context, on: Boolean, status: String) = p(ctx).edit().putBoolean("on", on).putString("status", status).apply()

    fun start(ctx: Context, code: String, name: String) {
        p(ctx).edit().putString("code", code).putString("name", name).putString("status", "starting").putBoolean("on", true).apply()
        ContextCompat.startForegroundService(ctx, Intent(ctx, BeaconService::class.java).putExtra("code", code).putExtra("name", name))
    }

    fun stop(ctx: Context) {
        set(ctx, false, "off")
        ctx.startService(Intent(ctx, BeaconService::class.java).setAction(BeaconService.STOP))
    }

    fun stateJson(ctx: Context): String {
        val bt = adapter(ctx)
        return JSONObject()
            .put("supported", supported(ctx))
            .put("bluetooth", bt?.isEnabled == true)
            .put("on", on(ctx))
            .put("status", p(ctx).getString("status", "off"))
            .put("code", p(ctx).getString("code", ""))
            .toString()
    }
}

/** Keeps the Bluetooth advertisement running (as a visible foreground service) so the phone works as a cafe beacon. */
class BeaconService : Service() {
    companion object {
        const val STOP = "cards.niro.BEACON_STOP"
        const val CHANNEL = "niro_beacon"
        const val ID = 4471
    }

    private var callback: AdvertiseCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            halt()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val prefs = getSharedPreferences("niro_beacon", Context.MODE_PRIVATE)
        val code = intent?.getStringExtra("code") ?: prefs.getString("code", null)
        val name = intent?.getStringExtra("name") ?: prefs.getString("name", "") ?: ""
        if (code == null || !Beacon.on(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        val n = notification(name)
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE) else startForeground(ID, n)
        } catch (_: Throwable) {
            Beacon.set(this, false, "blocked")
            stopSelf()
            return START_NOT_STICKY
        }
        advertise(code)
        return START_REDELIVER_INTENT
    }

    @SuppressLint("MissingPermission")
    private fun advertise(code: String) {
        halt()
        val adv = Beacon.adapter(this)?.takeIf { it.isEnabled }?.bluetoothLeAdvertiser
        val ok = Build.VERSION.SDK_INT < 31 || ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
        if (adv == null || !ok) {
            Beacon.set(this, false, if (!ok) "permission" else "bluetooth_off")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(false)
            .setTimeout(0)
            .build()
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addServiceData(BeaconProtocol.SERVICE_UUID, BeaconProtocol.payload(code))
            .build()
        val cb = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                Beacon.set(this@BeaconService, true, "broadcasting")
            }

            override fun onStartFailure(errorCode: Int) {
                Beacon.set(this@BeaconService, false, "failed_$errorCode")
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        callback = cb
        try {
            adv.startAdvertising(settings, data, cb)
        } catch (_: Throwable) {
            Beacon.set(this, false, "failed")
            stopSelf()
        }
    }

    @SuppressLint("MissingPermission")
    private fun halt() {
        val cb = callback ?: return
        callback = null
        try {
            Beacon.adapter(this)?.bluetoothLeAdvertiser?.stopAdvertising(cb)
        } catch (_: Throwable) {
        }
    }

    override fun onDestroy() {
        halt()
        super.onDestroy()
    }

    private fun notification(name: String): Notification {
        if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(NotificationChannel(CHANNEL, "Beacon", NotificationManager.IMPORTANCE_LOW))
        }
        val stop = PendingIntent.getService(
            this, 1, Intent(this, BeaconService::class.java).setAction(STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 2, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setColor(0xFF13D4FE.toInt())
            .setContentTitle("Niro beacon is on")
            .setContentText(if (name.isBlank()) "Nearby Niro customers get your offer." else "Nearby Niro customers get $name’s offer.")
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(0, "Turn off", stop)
            .build()
    }
}
