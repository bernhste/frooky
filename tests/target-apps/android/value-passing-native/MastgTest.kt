package org.owasp.mastestapp

import android.app.AppComponentFactory
import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri

// The stages of the app's startup, in the order Android runs them. Each loads its own library, whose constructor
// and JNI_OnLoad call startup_step() and getenv() (cpp/startupStage.c).

// The app's earliest code: Android creates the factory together with the app's class loader, before it loads the
// Application class.
class StartupComponentFactory : AppComponentFactory() {
    companion object {
        init {
            System.loadLibrary("startupFactory")
        }
    }
}

// Loaded once the class loader and the factory exist. Its static initializer runs before attachBaseContext(),
// the content providers and onCreate().
class StartupApplication : Application() {
    companion object {
        init {
            System.loadLibrary("startupApplication")
        }
    }
}

// Android creates the content providers after the Application and before Application.onCreate().
class StartupProvider : ContentProvider() {
    override fun onCreate(): Boolean {
        System.loadLibrary("startupProvider")
        return true
    }

    override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor? = null

    override fun getType(uri: Uri): String? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = 0

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = 0
}

class MastgTest(private val context: Context) {

    companion object {
        init {
            // before loadTime, which calls it while it loads
            System.loadLibrary("loadStage")
            System.loadLibrary("receiveFundamentalValue")
            System.loadLibrary("receiveFundamentalReference")
            System.loadLibrary("receiveString")
            System.loadLibrary("loadTime")
        }
    }

    external fun receiveFundamentalValueJNI(): String
    external fun receiveFundamentalReferenceJNI(): String
    external fun receiveStringsJNI(): String

    fun mastgTest(): String {
        val r = DemoResults("basic-native")
        r.add(Status.PASS, "${receiveFundamentalValueJNI()}")
        r.add(Status.PASS, "${receiveFundamentalReferenceJNI()}")
        r.add(Status.PASS, "${receiveStringsJNI()}")

        return r.toJson()
    }
}
