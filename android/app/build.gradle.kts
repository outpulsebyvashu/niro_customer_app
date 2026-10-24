plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Push notifications switch on when android/app/google-services.json is present (from the Firebase console).
// Without it the app still builds and runs; push is simply off.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "cards.niro.customer"
    compileSdk = 34

    defaultConfig {
        applicationId = "cards.niro.customer"
        minSdk = 24
        targetSdk = 34
        versionCode = (System.getenv("APP_VERSION_CODE") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("APP_VERSION_CODE") ?: "1")
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
    implementation(platform("com.google.firebase:firebase-bom:33.1.2"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.google.android.gms:play-services-location:21.3.0")
}
