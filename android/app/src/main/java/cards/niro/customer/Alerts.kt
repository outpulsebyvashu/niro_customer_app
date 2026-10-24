package cards.niro.customer

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.CookieManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

private const val BASE = "https://niro.cards"
private const val PREFS = "niro_native"

private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

/** Calls the Niro API from background code (no WebView needed) using a copy of the signed-in session cookie. */
object Net {
    /** Called from the WebView side whenever a page finishes: keeps a copy of the session cookie for background work. */
    fun remember(ctx: Context) {
        try {
            val c = CookieManager.getInstance().getCookie(BASE)
            val hasSession = c != null && c.contains("cl_session=")
            prefs(ctx).edit().apply { if (hasSession) putString("cookie", c) else remove("cookie") }.apply()
        } catch (_: Throwable) {
        }
    }

    fun signedIn(ctx: Context) = prefs(ctx).getString("cookie", null) != null

    fun call(ctx: Context, method: String, path: String, body: String? = null): Pair<Int, String>? {
        return try {
            val c = URL(BASE + path).openConnection() as HttpURLConnection
            c.requestMethod = method
            c.connectTimeout = 8000
            c.readTimeout = 10000
            c.setRequestProperty("Accept", "application/json")
            prefs(ctx).getString("cookie", null)?.let { c.setRequestProperty("Cookie", it) }
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            val text = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            c.disconnect()
            code to text
        } catch (_: Throwable) {
            null
        }
    }
}

/** Notification channels and the one place notifications are built. */
object Notifier {
    const val DEFAULT = "niro_default"
    const val OFFERS = "niro_offers"

    fun channels(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(DEFAULT, "Stamps and updates", NotificationManager.IMPORTANCE_DEFAULT))
        nm.createNotificationChannel(NotificationChannel(OFFERS, "Nearby cafe alerts", NotificationManager.IMPORTANCE_HIGH))
    }

    fun canNotify(ctx: Context) =
        (Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    @SuppressLint("MissingPermission")
    fun show(ctx: Context, channel: String, title: String, text: String, id: Int) {
        if (!canNotify(ctx)) return
        channels(ctx)
        val open = PendingIntent.getActivity(
            ctx, id, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat_niro)
            .setColor(0xFF5E17EB.toInt())
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(if (channel == OFFERS) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        NotificationManagerCompat.from(ctx).notify(id, n)
    }
}

/** Push notifications through Firebase. Quietly off until android/app/google-services.json is added. */
object Push {
    fun available(ctx: Context) = try {
        FirebaseApp.getApps(ctx).isNotEmpty()
    } catch (_: Throwable) {
        false
    }

    /** Gets this phone's token and tells the server which account it belongs to. Run on a background thread. */
    fun sync(ctx: Context) {
        if (!available(ctx) || !Net.signedIn(ctx)) return
        try {
            val token = Tasks.await(FirebaseMessaging.getInstance().token, 15, TimeUnit.SECONDS)
            register(ctx, token)
        } catch (_: Throwable) {
        }
    }

    fun register(ctx: Context, token: String) {
        prefs(ctx).edit().putString("fcm", token).apply()
        if (!Net.signedIn(ctx)) return
        Net.call(ctx, "POST", "/api/devices", JSONObject().put("token", token).put("platform", "android").toString())
    }

    /** Stops pushes for the account that is logging out on this phone. */
    fun unregister(ctx: Context) {
        val token = prefs(ctx).getString("fcm", null) ?: return
        Net.call(ctx, "DELETE", "/api/devices", JSONObject().put("token", token).toString())
    }
}

class NiroMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Thread { Push.register(applicationContext, token) }.start()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title ?: message.data["title"] ?: "Niro"
        val body = message.notification?.body ?: message.data["body"] ?: return
        Notifier.show(applicationContext, Notifier.DEFAULT, title, body, (System.currentTimeMillis() % 100000).toInt())
    }
}

/** Geofences around nearby partner cafes. The phone watches them, so alerts work when Niro is closed. */
object Geo {
    private const val MAX_CAFES = 95
    private const val CAFE_RADIUS_M = 120f
    private const val REFRESH_RADIUS_M = 2500f

    fun hasBackground(ctx: Context): Boolean {
        val fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val bg = Build.VERSION.SDK_INT < 29 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
        return fine && bg
    }

    private fun pending(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
        ctx, 7, Intent(ctx, GeofenceReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
    )

    /** json = {center:{lat,lng}, fences:[{id,name,lat,lng,offer}]}. Saved, then registered if permission allows. */
    fun set(ctx: Context, json: String) {
        prefs(ctx).edit().putString("fences", json).apply()
        apply(ctx)
    }

    fun clear(ctx: Context) {
        prefs(ctx).edit().remove("fences").apply()
        try {
            LocationServices.getGeofencingClient(ctx).removeGeofences(pending(ctx))
        } catch (_: Throwable) {
        }
    }

    @SuppressLint("MissingPermission")
    fun apply(ctx: Context) {
        val raw = prefs(ctx).getString("fences", null) ?: return
        if (!hasBackground(ctx) || !Net.signedIn(ctx)) return
        try {
            val o = JSONObject(raw)
            val list = ArrayList<Geofence>()
            val fences = o.optJSONArray("fences") ?: JSONArray()
            for (i in 0 until minOf(fences.length(), MAX_CAFES)) {
                val f = fences.getJSONObject(i)
                list += Geofence.Builder()
                    .setRequestId("c:" + f.getString("id"))
                    .setCircularRegion(f.getDouble("lat"), f.getDouble("lng"), CAFE_RADIUS_M)
                    .setExpirationDuration(Geofence.NEVER_EXPIRE)
                    .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER)
                    .build()
            }
            o.optJSONObject("center")?.let { c ->
                list += Geofence.Builder()
                    .setRequestId("refresh")
                    .setCircularRegion(c.getDouble("lat"), c.getDouble("lng"), REFRESH_RADIUS_M)
                    .setExpirationDuration(Geofence.NEVER_EXPIRE)
                    .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_EXIT)
                    .build()
            }
            if (list.isEmpty()) return
            val client = LocationServices.getGeofencingClient(ctx)
            val request = GeofencingRequest.Builder().setInitialTrigger(0).addGeofences(list).build()
            client.removeGeofences(pending(ctx)).addOnCompleteListener {
                try {
                    client.addGeofences(request, pending(ctx))
                } catch (_: Throwable) {
                }
            }
        } catch (_: Throwable) {
        }
    }

    fun istDay(): String = SimpleDateFormat("yyyyMMdd", Locale.US).apply { timeZone = TimeZone.getTimeZone("Asia/Kolkata") }.format(Date())
}

class GeofenceReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) return
        val app = ctx.applicationContext
        val result = goAsync()
        Thread {
            try {
                when (event.geofenceTransition) {
                    Geofence.GEOFENCE_TRANSITION_ENTER -> event.triggeringGeofences?.forEach { g ->
                        if (g.requestId.startsWith("c:")) enter(app, g.requestId.substring(2))
                    }
                    Geofence.GEOFENCE_TRANSITION_EXIT -> {
                        val l = event.triggeringLocation
                        if (event.triggeringGeofences?.any { it.requestId == "refresh" } == true && l != null) refresh(app, l.latitude, l.longitude)
                    }
                }
            } catch (_: Throwable) {
            } finally {
                result.finish()
            }
        }.start()
    }

    /** The phone is at a cafe: ask the server (it enforces the 2-a-day limit), then show the alert. */
    private fun enter(ctx: Context, cafeId: String) {
        val p = prefs(ctx)
        val key = "sent-" + Geo.istDay() + "-" + cafeId
        if (p.getBoolean(key, false)) return
        val r = Net.call(ctx, "POST", "/api/geo-alerts", JSONObject().put("cafe_id", cafeId).toString()) ?: return
        if (r.first != 200) return
        p.edit().putBoolean(key, true).apply()
        val res = JSONObject(r.second)
        if (!res.optBoolean("allowed")) return
        var name = "A partner cafe"
        var offer = "Show your Niro card and collect a stamp."
        try {
            val fences = JSONObject(p.getString("fences", "{}")!!).optJSONArray("fences") ?: JSONArray()
            for (i in 0 until fences.length()) {
                val f = fences.getJSONObject(i)
                if (f.optString("id") == cafeId) {
                    name = f.optString("name", name)
                    f.optString("offer").takeIf { it.isNotBlank() }?.let { offer = it }
                }
            }
        } catch (_: Throwable) {
        }
        Notifier.show(ctx, Notifier.OFFERS, "You’re near $name", offer, cafeId.hashCode())
    }

    /** The phone left the area it was watching: load the cafes around the new spot and watch those. */
    private fun refresh(ctx: Context, lat: Double, lng: Double) {
        val r = Net.call(ctx, "GET", "/api/cafes/nearby?lat=$lat&lng=$lng&limit=50") ?: return
        if (r.first != 200) return
        val cafes = JSONObject(r.second).optJSONArray("cafes") ?: return
        val fences = JSONArray()
        for (i in 0 until cafes.length()) {
            val c = cafes.getJSONObject(i)
            val offers = c.optJSONArray("offers")
            val offer = if (offers != null && offers.length() > 0) offers.getJSONObject(0).optString("title") else ""
            fences.put(JSONObject().put("id", c.getString("id")).put("name", c.optString("name")).put("lat", c.getDouble("lat")).put("lng", c.getDouble("lng")).put("offer", offer))
        }
        Geo.set(ctx, JSONObject().put("center", JSONObject().put("lat", lat).put("lng", lng)).put("fences", fences).toString())
    }
}

/** After a restart or an app update the phone forgets geofences, so register them again. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val app = ctx.applicationContext
        val result = goAsync()
        Thread {
            try {
                Notifier.channels(app)
                Geo.apply(app)
            } finally {
                result.finish()
            }
        }.start()
    }
}
