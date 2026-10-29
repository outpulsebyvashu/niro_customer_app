package cards.niro.customer

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat

/**
 * A native shell around one Niro web app. It is the whole app for Niro Partner and Niro Workforce
 * (they load their live site, so they update without a new APK), and it is the in-app staff screen
 * inside the customer app (opened with a back bar). Camera and location are only offered to the app's own site.
 */
class ShellActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var root: LinearLayout
    private lateinit var bar: LinearLayout
    private lateinit var offline: LinearLayout
    private lateinit var startUrl: String
    private lateinit var host: String
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var camRequest: PermissionRequest? = null
    private var geoCallback: GeolocationPermissions.Callback? = null
    private var geoOrigin: String? = null
    private var failed = false
    private var lastBg = 0
    private val handler = Handler(Looper.getMainLooper())

    private val cameraPerm = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        val r = camRequest
        camRequest = null
        if (r != null) {
            if (ok) r.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else r.deny()
        }
    }

    private val locationPerm = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        geoCallback?.invoke(geoOrigin, grants.values.any { it }, false)
        geoCallback = null
        geoOrigin = null
    }

    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    /* Partner and Workforce apps: let the cafe's phone (owner or on-shift staff) broadcast the Niro Bluetooth beacon. */
    private var pendingBeacon: Pair<String, String>? = null
    private val beaconPerm = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { beginBeaconIfReady() }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun tellBeacon() {
        if (BuildConfig.APP_KIND != "Partner" && BuildConfig.APP_KIND != "Workforce") return
        web.evaluateJavascript("window.__niroBeacon&&window.__niroBeacon(" + Beacon.stateJson(this) + ")", null)
    }

    private fun beaconAsk(code: String, name: String) {
        pendingBeacon = code to name
        val need = ArrayList<String>()
        if (Build.VERSION.SDK_INT >= 31) {
            if (!granted(Manifest.permission.BLUETOOTH_ADVERTISE)) need += Manifest.permission.BLUETOOTH_ADVERTISE
            if (!granted(Manifest.permission.BLUETOOTH_CONNECT)) need += Manifest.permission.BLUETOOTH_CONNECT
        }
        if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) need += Manifest.permission.POST_NOTIFICATIONS
        if (need.isNotEmpty()) beaconPerm.launch(need.toTypedArray()) else beginBeaconIfReady()
    }

    private fun beginBeaconIfReady() {
        val (code, name) = pendingBeacon ?: return
        pendingBeacon = null
        if (Build.VERSION.SDK_INT >= 31 && !granted(Manifest.permission.BLUETOOTH_ADVERTISE)) {
            Toast.makeText(this, "Allow “Nearby devices” so this phone can work as your beacon.", Toast.LENGTH_LONG).show()
            tellBeacon(); return
        }
        if (!Beacon.supported(this)) {
            Toast.makeText(this, "This phone can’t broadcast a Bluetooth beacon.", Toast.LENGTH_LONG).show()
            tellBeacon(); return
        }
        if (Beacon.adapter(this)?.isEnabled != true) {
            Toast.makeText(this, "Turn Bluetooth on, then tap Start again.", Toast.LENGTH_LONG).show()
            try { startActivity(Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS)) } catch (_: Exception) {}
            tellBeacon(); return
        }
        Beacon.start(this, code, name)
        handler.postDelayed({ tellBeacon() }, 1200)
    }

    private inner class BeaconBridge {
        @JavascriptInterface
        fun state(): String = Beacon.stateJson(this@ShellActivity)

        @JavascriptInterface
        fun start(code: String, name: String) {
            if (!Regex("^[A-Z2-9]{8}$").matches(code)) return
            runOnUiThread { beaconAsk(code, name.take(60)) }
        }

        @JavascriptInterface
        fun stop() {
            runOnUiThread { Beacon.stop(this@ShellActivity); handler.postDelayed({ tellBeacon() }, 400) }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        val dp = resources.displayMetrics.density
        startUrl = intent?.getStringExtra(EXTRA_URL) ?: BuildConfig.START_URL
        host = Uri.parse(startUrl).host ?: ""
        val showBar = intent?.getBooleanExtra(EXTRA_BAR, false) == true

        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE) }
        bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.WHITE)
            visibility = if (showBar) View.VISIBLE else View.GONE
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (48 * dp).toInt())
            addView(TextView(context).apply {
                text = "‹"
                textSize = 30f
                setTextColor(Color.parseColor("#0B0B0B"))
                gravity = Gravity.CENTER
                contentDescription = "Back"
                setOnClickListener { finish() }
                layoutParams = LinearLayout.LayoutParams((52 * dp).toInt(), ViewGroup.LayoutParams.MATCH_PARENT)
            })
            addView(TextView(context).apply {
                text = intent?.getStringExtra(EXTRA_TITLE) ?: ""
                textSize = 17f
                setTextColor(Color.parseColor("#0B0B0B"))
                setTypeface(typeface, Typeface.BOLD)
            })
        }
        web = WebView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
            setBackgroundColor(Color.WHITE)
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        offline = buildOfflineView()
        root.addView(bar)
        root.addView(web)
        setContentView(FrameLayout(this).apply { addView(root); addView(offline) })
        paint(Color.WHITE)

        CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(web, false) }
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setGeolocationEnabled(true)
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = userAgentString + " NiroApp/1.0 Niro" + BuildConfig.APP_KIND
            setSupportZoom(false)
            builtInZoomControls = false
        }
        if (BuildConfig.APP_KIND == "Partner" || BuildConfig.APP_KIND == "Workforce") web.addJavascriptInterface(BeaconBridge(), "NiroBeacon")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                val s = u.scheme ?: ""
                if (s == "about" || s == "blob" || s == "data") return false
                if (s == "https" && u.host == host) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE))
                } catch (e: ActivityNotFoundException) {
                    Toast.makeText(this@ShellActivity, "No app can open this link", Toast.LENGTH_SHORT).show()
                }
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    failed = true
                    offline.visibility = View.VISIBLE
                    offline.bringToFront()
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!failed) offline.visibility = View.GONE
                CookieManager.getInstance().flush()
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (Uri.parse(origin).host != host) {
                    callback.invoke(origin, false, false)
                    return
                }
                val fine = ContextCompat.checkSelfPermission(this@ShellActivity, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                val coarse = ContextCompat.checkSelfPermission(this@ShellActivity, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                if (fine || coarse) {
                    callback.invoke(origin, true, false)
                } else {
                    geoCallback?.invoke(geoOrigin, false, false)
                    geoCallback = callback
                    geoOrigin = origin
                    locationPerm.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                }
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                // Only the camera, and only for this app's own site (scanning QR codes).
                val onlyCam = request.resources.isNotEmpty() && request.resources.all { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
                if (request.origin.host != host || !onlyCam) {
                    request.deny()
                    return
                }
                if (ContextCompat.checkSelfPermission(this@ShellActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                } else {
                    camRequest?.deny()
                    camRequest = request
                    cameraPerm.launch(Manifest.permission.CAMERA)
                }
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    filePicker.launch(params.createIntent())
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    false
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (offline.visibility == View.VISIBLE) finish()
                else if (web.canGoBack()) web.goBack()
                else finish()
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else load()
    }

    private fun load() {
        failed = false
        offline.visibility = View.GONE
        val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        if (cm.activeNetworkInfo?.isConnected != true) {
            offline.visibility = View.VISIBLE
            offline.bringToFront()
            return
        }
        web.loadUrl(startUrl)
    }

    private fun buildOfflineView(): LinearLayout {
        val pad = (24 * resources.displayMetrics.density).toInt()
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(Color.WHITE)
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            addView(TextView(context).apply {
                text = getString(R.string.offline_title)
                textSize = 26f
                setTextColor(Color.parseColor("#0B0B0B"))
                gravity = Gravity.CENTER
            })
            addView(TextView(context).apply {
                text = getString(R.string.offline_text)
                textSize = 16f
                setTextColor(Color.parseColor("#62625F"))
                gravity = Gravity.CENTER
                setPadding(0, pad / 2, 0, pad)
            })
            addView(Button(context).apply {
                text = getString(R.string.retry)
                isAllCaps = false
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.parseColor("#0B0B0B"))
                setOnClickListener { load() }
            })
        }
    }

    /** Colours the status bar, the bottom bar and the back bar to match the page. */
    private fun paint(bg: Int) {
        if (bg == lastBg) return
        lastBg = bg
        root.setBackgroundColor(bg)
        bar.setBackgroundColor(bg)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        val light = (0.299 * Color.red(bg) + 0.587 * Color.green(bg) + 0.114 * Color.blue(bg)) > 150
        val c = WindowCompat.getInsetsController(window, window.decorView)
        c.isAppearanceLightStatusBars = light
        c.isAppearanceLightNavigationBars = light
        val fg = if (light) Color.parseColor("#0B0B0B") else Color.WHITE
        for (i in 0 until bar.childCount) (bar.getChildAt(i) as? TextView)?.setTextColor(fg)
    }

    private val poll = object : Runnable {
        override fun run() {
            if (offline.visibility != View.VISIBLE) {
                web.evaluateJavascript(
                    "(function(){try{var c=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();" +
                        "if(c)return c;return getComputedStyle(document.body).backgroundColor}catch(e){return ''}})()"
                ) { raw -> parse(raw)?.let { paint(it) } }
            }
            handler.postDelayed(this, 700)
        }
    }

    private fun parse(raw: String?): Int? {
        val v = raw?.trim()?.trim('"')?.trim() ?: return null
        if (v.startsWith("#")) {
            return try {
                when (v.length) {
                    4 -> Color.parseColor("#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3])
                    7 -> Color.parseColor(v)
                    else -> null
                }
            } catch (e: IllegalArgumentException) { null }
        }
        val m = Regex("""rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)""").find(v) ?: return null
        val (r, g, b) = m.destructured
        return Color.rgb(r.toInt(), g.toInt(), b.toInt())
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        handler.post(poll)
        tellBeacon()
    }

    override fun onPause() {
        handler.removeCallbacks(poll)
        CookieManager.getInstance().flush()
        web.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_BAR = "bar"
        const val EXTRA_TITLE = "title"
    }
}
