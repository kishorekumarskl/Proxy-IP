package PACKAGE_NAME

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.VpnService
import android.os.Build
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.concurrent.thread

class ProxyVpnModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var pendingProfile: ReadableMap? = null
    private var pendingPromise: Promise?      = null
    private val vpnPermissionRequestCode      = 4421

    private val activityEventListener: ActivityEventListener =
        object : BaseActivityEventListener() {
            override fun onActivityResult(
                activity: Activity, requestCode: Int, resultCode: Int, data: Intent?
            ) {
                if (requestCode != vpnPermissionRequestCode) return
                if (resultCode == Activity.RESULT_OK) {
                    val profile = pendingProfile; val promise = pendingPromise
                    pendingProfile = null; pendingPromise = null
                    if (profile != null && promise != null) startVpnService(profile, promise)
                } else {
                    val promise = pendingPromise
                    pendingProfile = null; pendingPromise = null
                    promise?.reject("VPN_PERMISSION_DENIED", "Android VPN permission was denied")
                    emitStatus("disconnected", "", "VPN permission denied")
                }
            }
        }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                ProxyVpnService.ACTION_STATUS -> {
                    val state    = intent.getStringExtra("state") ?: "disconnected"
                    val activeIp = intent.getStringExtra("activeIp") ?: ""
                    val message  = intent.getStringExtra("message") ?: ""
                    emitStatus(state, activeIp, message)
                }
                ProxyVpnService.ACTION_TRAFFIC -> {
                    val bytesIn  = intent.getLongExtra("bytesIn", 0L)
                    val bytesOut = intent.getLongExtra("bytesOut", 0L)
                    emitTraffic(bytesIn, bytesOut)
                }
            }
        }
    }

    init {
        reactContext.addActivityEventListener(activityEventListener)
        val filter = IntentFilter().apply {
            addAction(ProxyVpnService.ACTION_STATUS)
            addAction(ProxyVpnService.ACTION_TRAFFIC)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            reactContext.registerReceiver(statusReceiver, filter)
        }
    }

    override fun getName(): String = "ProxyVpn"

    override fun invalidate() {
        try { reactContext.unregisterReceiver(statusReceiver) } catch (_: Exception) {}
        super.invalidate()
    }

    // ── JS-callable methods ────────────────────────────────────────────────

    @ReactMethod
    fun startVpn(profile: ReadableMap, promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No active Android activity")
            return
        }
        val permissionIntent = VpnService.prepare(activity)
        if (permissionIntent != null) {
            pendingProfile = profile; pendingPromise = promise
            emitStatus("connecting", profile.getString("serverIp") ?: "", "Waiting for VPN permission")
            activity.startActivityForResult(permissionIntent, vpnPermissionRequestCode)
        } else {
            startVpnService(profile, promise)
        }
    }

    @ReactMethod
    fun stopVpn(promise: Promise) {
        val intent = Intent(reactContext, ProxyVpnService::class.java).apply {
            action = ProxyVpnService.ACTION_STOP
        }
        reactContext.startService(intent)
        promise.resolve(true)
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        val map = Arguments.createMap().apply {
            putString("state",    ProxyVpnService.currentState)
            putString("activeIp", ProxyVpnService.currentActiveIp)
            putString("message",  ProxyVpnService.currentMessage)
        }
        promise.resolve(map)
    }

    /**
     * Test TCP connectivity latency to a proxy host.
     * Performs 3 connection attempts and returns the median round-trip time in ms.
     * Returns -1 on timeout.
     */
    @ReactMethod
    fun testLatency(host: String, port: Int, promise: Promise) {
        thread(name = "LatencyTest") {
            val samples = mutableListOf<Long>()
            repeat(3) {
                try {
                    val start = System.currentTimeMillis()
                    Socket().use { it.connect(InetSocketAddress(host, port), 5000) }
                    samples += System.currentTimeMillis() - start
                    Thread.sleep(100)
                } catch (_: Exception) {}
            }
            if (samples.isEmpty()) promise.resolve(-1)
            else promise.resolve(samples.sorted()[samples.size / 2].toInt())
        }
    }

    /**
     * Return the current traffic stats snapshot (bytes since VPN connected).
     */
    @ReactMethod
    fun getTrafficStats(promise: Promise) {
        val map = Arguments.createMap().apply {
            putDouble("bytesIn",  ProxyVpnService.currentBytesIn.toDouble())
            putDouble("bytesOut", ProxyVpnService.currentBytesOut.toDouble())
        }
        promise.resolve(map)
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    // ── Internal ───────────────────────────────────────────────────────────

    private fun startVpnService(profile: ReadableMap, promise: Promise) {
        fun str(key: String)  = profile.getString(key) ?: ""
        fun bool(key: String) = if (profile.hasKey(key)) profile.getBoolean(key) else false
        fun int(key: String)  = if (profile.hasKey(key)) profile.getInt(key) else 0

        val intent = Intent(reactContext, ProxyVpnService::class.java).apply {
            action = ProxyVpnService.ACTION_START
            putExtra("profileName",  str("profileName"))
            putExtra("proxyType",    str("proxyType"))
            putExtra("serverIp",     str("serverIp"))
            putExtra("port",         int("port"))
            putExtra("username",     str("username"))
            putExtra("password",     str("password"))
            putExtra("ssMethod",     str("ssMethod"))
            putExtra("ssPassword",   str("ssPassword"))
            putExtra("killSwitch",   bool("killSwitch"))
            putExtra("autoReconnect",bool("autoReconnect"))
            putExtra("dnsMode",      str("dnsMode"))
            putExtra("customDns",    str("customDns"))
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(intent)
        } else {
            reactContext.startService(intent)
        }
        promise.resolve(true)
    }

    private fun emitStatus(state: String, activeIp: String, message: String) {
        val map = Arguments.createMap().apply {
            putString("state",    state)
            putString("activeIp", activeIp)
            putString("message",  message)
        }
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("ProxyVpnStatus", map)
    }

    private fun emitTraffic(bytesIn: Long, bytesOut: Long) {
        val map = Arguments.createMap().apply {
            putDouble("bytesIn",  bytesIn.toDouble())
            putDouble("bytesOut", bytesOut.toDouble())
        }
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("ProxyVpnTraffic", map)
    }
}
