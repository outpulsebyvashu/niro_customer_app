import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Push notifications (customer app only) switch on when android/app/google-services.json exists
// (download it from the Firebase console). Its values are read here; no Google plugin is needed,
// so the Partner and Workforce apps are never affected by it.
val firebase: Map<String, String> = run {
    val f = file("google-services.json")
    if (!f.exists()) return@run emptyMap<String, String>()
    try {
        val j = JsonSlurper().parse(f) as Map<*, *>
        val clients = (j["client"] as? List<*>) ?: emptyList<Any>()
        val mine = clients.filterIsInstance<Map<*, *>>().firstOrNull {
            (((it["client_info"] as? Map<*, *>)?.get("android_client_info") as? Map<*, *>)?.get("package_name")) == "cards.niro.customer"
        } ?: clients.filterIsInstance<Map<*, *>>().firstOrNull()
        val info = j["project_info"] as? Map<*, *>
        mapOf(
            "app_id" to ((mine?.get("client_info") as? Map<*, *>)?.get("mobilesdk_app_id")?.toString() ?: ""),
            "api_key" to ((mine?.get("api_key") as? List<*>)?.filterIsInstance<Map<*, *>>()?.firstOrNull()?.get("current_key")?.toString() ?: ""),
            "project_id" to (info?.get("project_id")?.toString() ?: ""),
            "sender_id" to (info?.get("project_number")?.toString() ?: "")
        )
    } catch (e: Exception) {
        emptyMap()
    }
}

android {
    namespace = "cards.niro.customer"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        targetSdk = 34
        versionCode = (System.getenv("APP_VERSION_CODE") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("APP_VERSION_CODE") ?: "1")
    }

    buildFeatures {
        buildConfig = true
    }

    // Three independent apps from one codebase: each has its own package, name, icon and live site.
    flavorDimensions += "app"
    productFlavors {
        create("customer") {
            dimension = "app"
            applicationId = "cards.niro.customer"
            resValue("string", "app_name", "Niro-beta")
            buildConfigField("String", "START_URL", "\"https://niro.cards/\"")
            buildConfigField("String", "APP_KIND", "\"Customer\"")
            buildConfigField("String", "FCM_APP_ID", "\"${firebase["app_id"] ?: ""}\"")
            buildConfigField("String", "FCM_API_KEY", "\"${firebase["api_key"] ?: ""}\"")
            buildConfigField("String", "FCM_PROJECT_ID", "\"${firebase["project_id"] ?: ""}\"")
            buildConfigField("String", "FCM_SENDER_ID", "\"${firebase["sender_id"] ?: ""}\"")
        }
        create("partner") {
            dimension = "app"
            applicationId = "cards.niro.partner"
            resValue("string", "app_name", "Niro Partner")
            buildConfigField("String", "START_URL", "\"https://partner.niro.cards/\"")
            buildConfigField("String", "APP_KIND", "\"Partner\"")
        }
        create("workforce") {
            dimension = "app"
            applicationId = "cards.niro.workforce"
            resValue("string", "app_name", "Niro Workforce")
            buildConfigField("String", "START_URL", "\"https://workforce.niro.cards/\"")
            buildConfigField("String", "APP_KIND", "\"Workforce\"")
        }
    }

    signingConfigs {
        create("sideload") {
            storeFile = file("../niro-sideload.jks")
            storePassword = "niro-sideload"
            keyAlias = "niro"
            keyPassword = "niro-sideload"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("sideload")
        }
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.1")
    // Push and background alerts exist only in the customer app.
    "customerImplementation"(platform("com.google.firebase:firebase-bom:33.1.2"))
    "customerImplementation"("com.google.firebase:firebase-messaging")
    "customerImplementation"("com.google.android.gms:play-services-location:21.3.0")
}
