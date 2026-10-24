package cards.niro.customer

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
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
 * The Niro staff app, opened as its own screen inside the customer app (instead of the browser).
 * It loads the live staff site, so it updates without a new APK. Back or the arrow returns to the customer app.
 */
class StaffActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var bar: LinearLayout
    private lateinit var root: LinearLayout
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var camRequest: PermissionRequest? = null
    private var lastBg = 0
    private val handler = Handler(Looper.getMainLooper())

    private val cameraPerm = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        val r = camRequest
        camRequest = null
        if (r != null) {
            if (ok) r.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else r.deny()
        }
    }

    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        val dp = resources.displayMetrics.density

        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE) }
        bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (48 * dp).toInt())
            addView(TextView(context).apply {
                text = "‹"
                textSize = 30f
                setTextColor(Color.parseColor("#0B0B0B"))
                gravity = Gravity.CENTER
                contentDescription = "Back to Niro"
                setOnClickListener { finish() }
                layoutParams = LinearLayout.LayoutParams((52 * dp).toInt(), ViewGroup.LayoutParams.MATCH_PARENT)
            })
            addView(TextView(context).apply {
                text = "Niro Staff"
                textSize = 17f
                setTextColor(Color.parseColor("#0B0B0B"))
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            })
        }
        web = WebView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
            setBackgroundColor(Color.WHITE)
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        root.addView(bar)
        root.addView(web)
        setContentView(FrameLayout(this).apply { addView(root) })
        paint(Color.WHITE)

        CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(web, false) }
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = userAgentString + " NiroApp/1.0 NiroStaff"
            setSupportZoom(false)
            builtInZoomControls = false
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                val s = u.scheme ?: ""
                if (s == "about" || s == "blob" || s == "data") return false
                if (s == "https" && u.host == HOST) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE))
                } catch (e: ActivityNotFoundException) {
                    Toast.makeText(this@StaffActivity, "No app can open this link", Toast.LENGTH_SHORT).show()
                }
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                CookieManager.getInstance().flush()
            }

            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                // Only the camera, and only for the staff site (scanning customer QR codes).
                val wantsCam = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                val onlyCam = request.resources.all { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
                if (request.origin.host != HOST || !wantsCam || !onlyCam) {
                    request.deny()
                    return
                }
                if (ContextCompat.checkSelfPermission(this@StaffActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
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
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(START)
    }

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
            web.evaluateJavascript(
                "(function(){try{var c=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();" +
                    "if(c)return c;return getComputedStyle(document.body).backgroundColor}catch(e){return ''}})()"
            ) { raw -> parse(raw)?.let { paint(it) } }
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
        const val HOST = "workforce.niro.cards"
        const val START = "https://workforce.niro.cards/"
    }
}
