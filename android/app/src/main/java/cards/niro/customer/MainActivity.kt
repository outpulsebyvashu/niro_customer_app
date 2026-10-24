package cards.niro.customer

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
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
import org.json.JSONObject

/**
 * Niro customer app. A thin native shell around the live web app at https://niro.cards,
 * so the screens look and behave exactly like the website and update without a new APK.
 */
class MainActivity : ComponentActivity() {

    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private lateinit var offline: LinearLayout

    private var geoCallback: GeolocationPermissions.Callback? = null
    private var geoOrigin: String? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingSave: String? = null
    private var failed = false
    private var lastBars = 0
    private val handler = Handler(Looper.getMainLooper())

    private val locationPermission = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        geoCallback?.invoke(geoOrigin, grants.values.any { it }, false)
        geoCallback = null
        geoOrigin = null
    }

    private var askedNotif = false
    private var askedFine = false
    private var askedBg = false
    private val alertsPerm = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { alertsStep() }

    private fun has(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    /** One permission at a time: notifications, then location, then "allow all the time" (Android asks for that last, on its own). */
    private fun alertsStep() {
        if (Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.POST_NOTIFICATIONS) && !askedNotif) {
            askedNotif = true
            alertsPerm.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS)); return
        }
        if (!has(Manifest.permission.ACCESS_FINE_LOCATION) && !askedFine) {
            askedFine = true
            alertsPerm.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)); return
        }
        if (Build.VERSION.SDK_INT >= 29 && has(Manifest.permission.ACCESS_FINE_LOCATION) &&
            !has(Manifest.permission.ACCESS_BACKGROUND_LOCATION) && !askedBg
        ) {
            askedBg = true
            alertsPerm.launch(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION)); return
        }
        val app = applicationContext
        Thread { Net.remember(app); Geo.apply(app); Push.sync(app) }.start()
        tellWeb()
    }

    private fun permJson(): String = JSONObject()
        .put("inApp", true)
        .put("notif", Notifier.canNotify(this))
        .put("fine", has(Manifest.permission.ACCESS_FINE_LOCATION))
        .put("bg", Geo.hasBackground(this))
        .put("push", Push.available(this))
        .toString()

    private fun tellWeb() {
        web.evaluateJavascript("window.__niroPerms&&window.__niroPerms(" + permJson() + ")", null)
    }

    private val filePicker = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        fileCallback?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        )
        fileCallback = null
    }

    private val saveFile = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        val text = pendingSave
        pendingSave = null
        if (uri != null && text != null) {
            try {
                contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
                Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "Could not save the file", Toast.LENGTH_SHORT).show()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)

        root = FrameLayout(this).apply { setBackgroundColor(Color.WHITE) }
        web = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.WHITE)
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        root.addView(web)
        offline = buildOfflineView()
        root.addView(offline)
        setContentView(root)

        Notifier.channels(this)
        configureWebView()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (offline.visibility == View.VISIBLE) {
                    finish()
                    return
                }
                // Let the web app close a sheet, or go back to Home, before leaving the app.
                web.evaluateJavascript(BACK_JS) { r ->
                    if (r == "1") return@evaluateJavascript
                    if (web.canGoBack()) web.goBack() else finish()
                }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else load()
    }

    private fun load() {
        failed = false
        offline.visibility = View.GONE
        if (!isOnline()) {
            showOffline()
            return
        }
        val target = intent?.data?.takeIf { it.host == HOST } ?: Uri.parse(HOME)
        web.loadUrl(target.toString())
    }

    private fun isOnline(): Boolean {
        val cm = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        return cm.activeNetworkInfo?.isConnected == true
    }

    private fun showOffline() {
        offline.visibility = View.VISIBLE
        offline.bringToFront()
    }

    private fun buildOfflineView(): LinearLayout {
        val pad = (24 * resources.displayMetrics.density).toInt()
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(Color.WHITE)
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
            )
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

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, false)
        }
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setGeolocationEnabled(true)
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = userAgentString + " NiroApp/1.0"
            setSupportZoom(false)
            builtInZoomControls = false
        }
        web.addJavascriptInterface(Bridge(), "NiroApp")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                val scheme = uri.scheme ?: ""
                if (scheme == "about" || scheme == "blob" || scheme == "data") return false
                if (scheme == "https" && (uri.host == HOST || uri.host == "www.$HOST")) return false
                // The staff app opens as its own screen inside this app, not in the browser.
                if (scheme == "https" && uri.host == StaffActivity.HOST) {
                    startActivity(Intent(this@MainActivity, StaffActivity::class.java))
                    return true
                }
                // Anything else (partner and admin apps, Google Wallet, WhatsApp, links, phone, mail)
                // opens in the right app, not inside this one.
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
                } catch (e: ActivityNotFoundException) {
                    Toast.makeText(this@MainActivity, "No app can open this link", Toast.LENGTH_SHORT).show()
                }
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    failed = true
                    showOffline()
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!failed) offline.visibility = View.GONE
                CookieManager.getInstance().flush()
                Net.remember(applicationContext)
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String, callback: GeolocationPermissions.Callback
            ) {
                val fine = ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.ACCESS_FINE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
                val coarse = ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.ACCESS_COARSE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
                if (fine || coarse) {
                    callback.invoke(origin, true, false)
                } else {
                    geoCallback = callback
                    geoOrigin = origin
                    locationPermission.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        )
                    )
                }
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                request.deny()
            }

            override fun onShowFileChooser(
                view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams
            ): Boolean {
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
    }

    /** Small bridge so the web app can use native sharing, saving and bar colours. */
    private inner class Bridge {
        @JavascriptInterface
        fun share(text: String, url: String) {
            runOnUiThread {
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, "$text $url")
                }
                startActivity(Intent.createChooser(send, null))
            }
        }

        @JavascriptInterface
        fun save(name: String, text: String) {
            runOnUiThread {
                pendingSave = text
                try {
                    saveFile.launch(name)
                } catch (e: Exception) {
                    pendingSave = null
                }
            }
        }

        /** What the phone currently allows: {inApp, notif, fine, bg, push}. */
        @JavascriptInterface
        fun permState(): String = permJson()

        /** Starts the permission steps for nearby alerts and push (the web app shows its own explanation first). */
        @JavascriptInterface
        fun enableAlerts() {
            runOnUiThread {
                askedNotif = false; askedFine = false; askedBg = false
                alertsStep()
            }
        }

        @JavascriptInterface
        fun openAppSettings() {
            runOnUiThread {
                startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            }
        }

        /** {center:{lat,lng}, fences:[{id,name,lat,lng,offer}]}: cafes for the phone to watch in the background. */
        @JavascriptInterface
        fun setGeofences(json: String) {
            val app = applicationContext
            Thread { Net.remember(app); Geo.set(app, json) }.start()
        }

        @JavascriptInterface
        fun clearGeofences() {
            val app = applicationContext
            Thread { Geo.clear(app) }.start()
        }

        /** After sign-in: tell the server which account this phone's push token belongs to. */
        @JavascriptInterface
        fun syncPush() {
            val app = applicationContext
            Thread { Net.remember(app); Push.sync(app) }.start()
        }

        /** Before log out: stop pushes for this account on this phone. */
        @JavascriptInterface
        fun pushOff() {
            val app = applicationContext
            Thread { Push.unregister(app) }.start()
        }

        @JavascriptInterface
        fun theme(dark: Boolean) {
            runOnUiThread { applyBars(if (dark) Color.parseColor("#0B0B0B") else Color.parseColor("#F7F7F5")) }
        }
    }

    /** Colours the status bar and the bottom system bar to match the page, with the right icon colour. */
    private fun applyBars(bg: Int) {
        if (bg == lastBars) return
        lastBars = bg
        window.statusBarColor = bg
        window.navigationBarColor = bg
        root.setBackgroundColor(bg)
        val light = (0.299 * Color.red(bg) + 0.587 * Color.green(bg) + 0.114 * Color.blue(bg)) > 150
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = light
        controller.isAppearanceLightNavigationBars = light
    }

    private fun parseCssColor(raw: String?): Int? {
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

    private val barPoll = object : Runnable {
        override fun run() {
            if (offline.visibility != View.VISIBLE) {
                web.evaluateJavascript(BG_JS) { raw -> parseCssColor(raw)?.let { applyBars(it) } }
            }
            handler.postDelayed(this, 700)
        }
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        handler.post(barPoll)
    }

    override fun onPause() {
        handler.removeCallbacks(barPoll)
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
        private const val HOST = "niro.cards"
        private const val HOME = "https://niro.cards/"
        private const val BG_JS =
            "(function(){try{var c=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();" +
                "if(c)return c;return getComputedStyle(document.body).backgroundColor}catch(e){return ''}})()"
        private const val BACK_JS =
            "(function(){try{var s=document.getElementById('scrim');" +
                "if(s&&!s.hidden){closeSheet();return 1}" +
                "if(state.tab&&state.tab!=='home'){setTab('home');return 1}}catch(e){}return 0})()"
    }
}
