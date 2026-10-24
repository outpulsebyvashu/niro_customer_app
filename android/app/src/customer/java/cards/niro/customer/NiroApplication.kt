package cards.niro.customer

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

/** Starts Firebase from the values in android/app/google-services.json (read at build time). Without them push stays off. */
class NiroApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifier.channels(this)
        if (BuildConfig.FCM_APP_ID.isNotBlank() && BuildConfig.FCM_API_KEY.isNotBlank()) {
            try {
                if (FirebaseApp.getApps(this).isEmpty()) {
                    FirebaseApp.initializeApp(
                        this,
                        FirebaseOptions.Builder()
                            .setApplicationId(BuildConfig.FCM_APP_ID)
                            .setApiKey(BuildConfig.FCM_API_KEY)
                            .setProjectId(BuildConfig.FCM_PROJECT_ID)
                            .setGcmSenderId(BuildConfig.FCM_SENDER_ID)
                            .build()
                    )
                }
            } catch (_: Throwable) {
            }
        }
    }
}
