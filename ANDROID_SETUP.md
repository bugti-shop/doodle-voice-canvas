# Android Setup Guide for Npd

---

## 🔥 Firebase Setup (REQUIRED)

### Step 1: Add `google-services.json`

1. Go to [Firebase Console](https://console.firebase.google.com/) → Project **npd-all-in-one-notepad**
2. Click ⚙️ **Project Settings** → **General** tab
3. Under **Your apps**, select your Android app (`nota.npd.com`)
4. Download `google-services.json`
5. Place it at: `android/app/google-services.json`

### Step 2: Add Firebase dependencies

**File:** `android/build.gradle` (project-level / root)

```gradle
buildscript {
    dependencies {
        // ... existing dependencies
        classpath 'com.google.gms:google-services:4.4.2'
    }
}
```

**File:** `android/app/build.gradle` (app-level)

Add at the **top** of the file (after existing `apply plugin` lines):

```gradle
apply plugin: 'com.google.gms.google-services'
```

Add in the `dependencies { }` block:

```gradle
    // Firebase BoM (manages all Firebase library versions)
    implementation platform('com.google.firebase:firebase-bom:33.7.0')
    
    // Firebase Auth (for Google Sign-In)
    implementation 'com.google.firebase:firebase-auth'
    
    // Firebase Realtime Database (for sync)
    implementation 'com.google.firebase:firebase-database'
```

 
```

 

### Complete AndroidManifest.xml

**File:** `android/app/src/main/AndroidManifest.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="nota.npd.com">

    <!-- Internet & Network -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />

    <!-- Push & Local Notifications -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />

    <!-- Foreground Service (for notifications) -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />

    <!-- Microphone (for voice notes/recording) -->
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-feature android:name="android.hardware.microphone" android:required="false" />

    <!-- Camera (for scanning/photos) -->
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />

    <!-- Biometric (for app lock) -->
    <uses-permission android:name="android.permission.USE_BIOMETRIC" />
    <uses-permission android:name="android.permission.USE_FINGERPRINT" />

    <!-- Calendar (for system calendar sync) -->
    <uses-permission android:name="android.permission.READ_CALENDAR" />
    <uses-permission android:name="android.permission.WRITE_CALENDAR" />

    <!-- Google Advertising ID for analytics & ads -->
    <uses-permission android:name="com.google.android.gms.permission.AD_ID" />

    <!-- ==================== APPLICATION ==================== -->
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme"
        android:usesCleartextTraffic="true">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:exported="true"
            android:label="@string/title_activity_main"
            android:launchMode="singleTask"
            android:name=".MainActivity"
            android:theme="@style/AppTheme.NoActionBarLaunch">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <!-- Deep Link support -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="voice-brushstrokes.lovable.app" />
            </intent-filter>

        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>

    </application>

</manifest>
```

---

## Complete MainActivity.java (Google Sign-In + Optimized Splash Screen)

**File:** `android/app/src/main/java/nota/npd/com/MainActivity.java`

```java
package nota.npd.com;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;

/**
 * Main Activity for Npd App
 * - Google Sign-In via Capgo Social Login
 * - Dynamic launcher icon (retention feature)
 */
public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN &&
            requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            PluginHandle handle = getBridge().getPlugin("SocialLogin");
            if (handle != null) {
                ((SocialLoginPlugin) handle.getInstance()).handleGoogleLoginIntent(requestCode, data);
            }
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}
}
```


## Splash Screen Setup (Android 12+ API)

### styles.xml

**File:** `android/app/src/main/res/values/styles.xml`

Add the splash screen theme to your launch theme:

```xml
<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
    <!-- Splash background color -->
    <item name="windowSplashScreenBackground">#3b78ed</item>
</style>
```

---


---

## Billing & Splash Screen Dependencies

Add these to your `android/app/build.gradle`:

```gradle

    // Google Play Billing
    implementation "com.android.billingclient:billing:7.1.1"
    
    // Android 12+ SplashScreen API (backward compatible to API 21)
    implementation "androidx.core:core-splashscreen:1.0.1"
// Firebase BoM (manages all Firebase library versions)
    implementation platform('com.google.firebase:firebase-bom:33.7.0')
    
    // Firebase Auth (for Google Sign-In)
    implementation 'com.google.firebase:firebase-auth'
    
    // Firebase Realtime Database (for sync)
    implementation 'com.google.firebase:firebase-database'

```

---

## strings.xml

**File:** `android/app/src/main/res/values/strings.xml`

```xml
    <!-- Firebase Google Sign-In Web Client ID (from google-services.json oauth_client type 3) -->
    <string name="server_client_id">425291387152-n9k3dc2b60nbsup70tub111n8l8o22lo.apps.googleusercontent.com</string>
```

---
