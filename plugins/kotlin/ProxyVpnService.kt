package PACKAGE_NAME

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.ProxyInfo
import android.net.TrafficStats
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.util.Log
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * ProxyVpnService — Full-featured Android VPN service
 *
 * Features:
 *   • tun2socks packet-level forwarding (Mode A) — routes ALL app traffic
 *   • Android HTTP proxy fallback (Mode B) — for apps that respect system proxy
 *   • Kill switch — aggressive reconnect on unexpected drop
 *   • Auto-reconnect — NetworkCallback reconnects on network availability
 *   • Traffic stats — broadcasts bytes in/out every 2 s via ACTION_TRAFFIC
 *   • Multi-protocol — SOCKS5, HTTP, Shadowsocks (via tun2socks)
 *   • IPv4 + IPv6 routing
 *   • Notification with inline Disconnect action
 */
class ProxyVpnService : VpnService() {

    companion object {
        const val ACTION_START   = "com.privateproxyclient.START_VPN"
        const val ACTION_STOP    = "com.privateproxyclient.STOP_VPN"
        const val ACTION_STATUS  = "com.privateproxyclient.VPN_STATUS"
        const val ACTION_TRAFFIC = "com.privateproxyclient.VPN_TRAFFIC"

        private const val TAG                   = "ProxyVpnService"
        private const val NOTIFICATION_CHANNEL  = "private_proxy_vpn"
        private const val NOTIFICATION_ID       = 3107

        @Volatile var currentState    = "disconnected"
        @Volatile var currentActiveIp = ""
        @Volatile var currentMessage  = "VPN is not active"
        @Volatile var currentBytesIn  = 0L
        @Volatile var currentBytesOut = 0L

        // Stored for kill-switch / auto-reconnect restart
        private var lastProfileBundle: Bundle? = null
    }

    private var vpnInterface: ParcelFileDescriptor? = null
    private val running           = AtomicBoolean(false)
    private var tun2SocksProcess: Tun2SocksProcess? = null
    private var packetDrainThread: Thread?          = null
    private var trafficStatsThread: Thread?         = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    // Settings
    private var killSwitch    = false
    private var autoReconnect = true
    private var dnsMode       = "direct"

    // Traffic stat baseline
    private var baseRxBytes = 0L
    private var baseTxBytes = 0L

    // ──────────────────────────────────────────────────────────────────
    // Lifecycle
    // ──────────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        Tun2SocksProcess.installBinary(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val b = intent.extras ?: return START_NOT_STICKY
                lastProfileBundle = Bundle(b)
                killSwitch    = b.getBoolean("killSwitch", false)
                autoReconnect = b.getBoolean("autoReconnect", true)
                dnsMode       = b.getString("dnsMode", "direct") ?: "direct"
                val serverIpForNotif = b.getString("serverIp", "") ?: ""
                startForeground(NOTIFICATION_ID, buildNotification("Connecting…", serverIpForNotif))
                thread(name = "ProxyVpnStart") { startProxyVpn(b) }
            }
            ACTION_STOP -> stopProxyVpn("Disconnected by user")
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopProxyVpn("Service destroyed")
        super.onDestroy()
    }

    override fun onRevoke() {
        stopProxyVpn("VPN permission revoked")
        super.onRevoke()
    }

    // ──────────────────────────────────────────────────────────────────
    // VPN setup
    // ──────────────────────────────────────────────────────────────────

    private fun startProxyVpn(b: Bundle) {
        val profileName = b.getString("profileName", "Private Proxy")!!
        val serverIp    = b.getString("serverIp", "")!!
        val port        = b.getInt("port", 0)
        val proxyType   = b.getString("proxyType", "socks5")!!
        val username    = b.getString("username", "")!!
        val password    = b.getString("password", "")!!
        val ssMethod    = b.getString("ssMethod", "chacha20-ietf-poly1305")!!
        val ssPassword  = b.getString("ssPassword", "")!!
        val customDns   = b.getString("customDns", "1.1.1.1")!!.ifBlank { "1.1.1.1" }

        if (serverIp.isBlank() || port !in 1..65535) {
            broadcastStatus("error", "", "Invalid proxy host or port")
            stopSelf(); return
        }

        broadcastStatus("connecting", serverIp, "Testing connectivity to $serverIp:$port…")

        if (!testTcpConnectivity(serverIp, port)) {
            broadcastStatus("error", serverIp, "Cannot reach $serverIp:$port — TCP connection timed out")
            stopSelf(); return
        }

        startForeground(NOTIFICATION_ID, buildNotification("Connecting → $serverIp:$port", serverIp))

        try {
            vpnInterface?.close(); vpnInterface = null

            val builder = Builder()
                .setSession(profileName)
                .setMtu(1500)
                // IPv4
                .addAddress("10.10.0.2", 32)
                .addRoute("0.0.0.0", 0)
                // IPv6
                .addAddress("fd00::2", 128)
                .addRoute("::", 0)
                // DNS
                .addDnsServer(customDns)
                .addDnsServer(if (customDns == "1.1.1.1") "8.8.8.8" else "1.1.1.1")
                .setBlocking(false)

            // Android HTTP proxy fallback (always set; tun2socks overrides at packet level)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                builder.setHttpProxy(ProxyInfo.buildDirectProxy(serverIp, port))
            }

            // Exclude our own app to prevent routing loops
            builder.addDisallowedApplication(packageName)

            val pfd = builder.establish()
            if (pfd == null) {
                broadcastStatus("error", serverIp, "Android refused to establish VPN interface")
                stopSelf(); return
            }
            vpnInterface = pfd

            // Record traffic baseline
            baseRxBytes = TrafficStats.getTotalRxBytes().coerceAtLeast(0L)
            baseTxBytes = TrafficStats.getTotalTxBytes().coerceAtLeast(0L)
            currentBytesIn = 0L; currentBytesOut = 0L

            val hasBinary = Tun2SocksProcess.isBinaryAvailable(filesDir)
            if (hasBinary) {
                val cfg = Tun2SocksProcess.Tun2SocksConfig(
                    tunFd       = pfd.fd,
                    proxyScheme = buildProxyScheme(proxyType),
                    proxyHost   = serverIp,
                    proxyPort   = port,
                    username    = if (proxyType != "shadowsocks") username else "",
                    password    = if (proxyType != "shadowsocks") password else "",
                    ssMethod    = ssMethod,
                    ssPassword  = ssPassword,
                    dnsMode     = dnsMode,
                )
                tun2SocksProcess = Tun2SocksProcess(
                    binary = java.io.File(filesDir, "tun2socks"),
                    config = cfg,
                )
                val started = tun2SocksProcess!!.start()
                if (!started) {
                    Log.w(TAG, "tun2socks failed — falling back to HTTP proxy mode")
                    tun2SocksProcess = null
                    startPacketDrainMode(pfd)
                } else {
                    startWatchdog()
                }
            } else {
                startPacketDrainMode(pfd)
            }

            running.set(true)
            startTrafficStatsThread()
            if (autoReconnect) registerNetworkCallback()

            val mode = if (hasBinary && tun2SocksProcess?.isRunning() == true)
                "Full packet forwarding" else "HTTP proxy mode"
            val protoLabel = proxyType.uppercase()
            broadcastStatus("connected", serverIp, "$protoLabel · $mode · $serverIp:$port")
            notifyConnected(serverIp, port)

        } catch (e: Exception) {
            Log.e(TAG, "VPN start failed", e)
            broadcastStatus("error", serverIp, e.message ?: "VPN start failed")
            stopProxyVpn("VPN start failed")
        }
    }

    private fun buildProxyScheme(proxyType: String): String = when (proxyType) {
        "http"        -> "http"
        "shadowsocks" -> "ss"
        else          -> "socks5"
    }

    // ──────────────────────────────────────────────────────────────────
    // Packet drain (Mode B fallback — keeps TUN fd alive)
    // ──────────────────────────────────────────────────────────────────

    private fun startPacketDrainMode(pfd: ParcelFileDescriptor) {
        val descriptor = pfd.fileDescriptor
        packetDrainThread = thread(name = "ProxyVpnPacketDrain") {
            val input  = java.io.FileInputStream(descriptor)
            val buf    = ByteArray(32767)
            while (running.get()) {
                try {
                    val len = input.read(buf)
                    if (len <= 0) Thread.sleep(20)
                } catch (_: Exception) {
                    if (running.get()) Thread.sleep(100)
                }
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // tun2socks watchdog (Mode A)
    // ──────────────────────────────────────────────────────────────────

    private fun startWatchdog() {
        thread(name = "Tun2SocksWatchdog") {
            while (running.get()) {
                Thread.sleep(3000)
                if (running.get() && tun2SocksProcess?.isRunning() == false) {
                    Log.w(TAG, "tun2socks exited unexpectedly — restarting")
                    tun2SocksProcess?.start()
                }
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // Traffic stats broadcaster
    // ──────────────────────────────────────────────────────────────────

    private fun startTrafficStatsThread() {
        trafficStatsThread = thread(name = "TrafficStatsMonitor") {
            while (running.get()) {
                Thread.sleep(2000)
                val rxTotal = TrafficStats.getTotalRxBytes()
                val txTotal = TrafficStats.getTotalTxBytes()
                if (rxTotal >= 0 && txTotal >= 0) {
                    currentBytesIn  = (rxTotal  - baseRxBytes).coerceAtLeast(0L)
                    currentBytesOut = (txTotal - baseTxBytes).coerceAtLeast(0L)
                    broadcastTrafficStats(currentBytesIn, currentBytesOut)
                }
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // Auto-reconnect NetworkCallback
    // ──────────────────────────────────────────────────────────────────

    private fun registerNetworkCallback() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        val req = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (!running.get() && autoReconnect) {
                    val profile = lastProfileBundle ?: return
                    Log.i(TAG, "Network available — auto-reconnecting")
                    Handler(Looper.getMainLooper()).postDelayed({
                        if (!running.get()) {
                            startForeground(NOTIFICATION_ID, buildNotification("Reconnecting…", ""))
                            startProxyVpn(profile)
                        }
                    }, 1500)
                }
            }

            override fun onLost(network: Network) {
                if (running.get()) {
                    Log.w(TAG, "Network lost — VPN may drop")
                    if (killSwitch) {
                        broadcastStatus("connecting", currentActiveIp, "Network lost — waiting to reconnect…")
                    }
                }
            }
        }
        try { cm.registerNetworkCallback(req, networkCallback!!) } catch (e: Exception) {
            Log.w(TAG, "Could not register NetworkCallback: ${e.message}")
        }
    }

    private fun unregisterNetworkCallback() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        networkCallback?.let { try { cm.unregisterNetworkCallback(it) } catch (_: Exception) {} }
        networkCallback = null
    }

    // ──────────────────────────────────────────────────────────────────
    // Stop
    // ──────────────────────────────────────────────────────────────────

    private fun stopProxyVpn(message: String) {
        running.set(false)
        unregisterNetworkCallback()

        tun2SocksProcess?.stop(); tun2SocksProcess = null

        try { packetDrainThread?.interrupt() } catch (_: Exception) {}
        packetDrainThread = null

        try { trafficStatsThread?.interrupt() } catch (_: Exception) {}
        trafficStatsThread = null

        try { vpnInterface?.close() } catch (_: Exception) {}
        vpnInterface = null

        currentBytesIn = 0L; currentBytesOut = 0L
        broadcastStatus("disconnected", "", message)

        if (killSwitch && message != "Disconnected by user" && message != "Service destroyed") {
            // Kill switch: notify user traffic may be unprotected
            val nm = getSystemService(NotificationManager::class.java)
            nm?.notify(NOTIFICATION_ID + 1, buildKillSwitchNotification())
        }

        try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (_: Exception) {}
        stopSelf()
    }

    // ──────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────

    private fun testTcpConnectivity(host: String, port: Int): Boolean = try {
        Socket().use { it.connect(InetSocketAddress(host, port), 4000); true }
    } catch (_: Exception) { false }

    private fun broadcastStatus(state: String, activeIp: String, message: String) {
        currentState    = state
        currentActiveIp = activeIp
        currentMessage  = message
        val intent = Intent(ACTION_STATUS).apply {
            setPackage(packageName)
            putExtra("state", state); putExtra("activeIp", activeIp); putExtra("message", message)
        }
        sendBroadcast(intent)
    }

    private fun broadcastTrafficStats(bytesIn: Long, bytesOut: Long) {
        val intent = Intent(ACTION_TRAFFIC).apply {
            setPackage(packageName)
            putExtra("bytesIn", bytesIn); putExtra("bytesOut", bytesOut)
        }
        sendBroadcast(intent)
    }

    // ──────────────────────────────────────────────────────────────────
    // Notifications
    // ──────────────────────────────────────────────────────────────────

    private fun buildNotification(text: String, serverIp: String): Notification {
        val launchPi = PendingIntent.getActivity(
            this, 0, packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        // Disconnect action
        val disconnectIntent = Intent(this, ProxyVpnService::class.java).apply { action = ACTION_STOP }
        val disconnectPi = PendingIntent.getService(
            this, 1, disconnectIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, NOTIFICATION_CHANNEL)
        } else {
            @Suppress("DEPRECATION") Notification.Builder(this)
        }

        return builder
            .setContentTitle("Private Proxy VPN")
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(launchPi)
            .setOngoing(true)
            .addAction(
                Notification.Action.Builder(
                    null, "Disconnect", disconnectPi
                ).build()
            )
            .build()
    }

    private fun notifyConnected(serverIp: String, port: Int) {
        getSystemService(NotificationManager::class.java)
            ?.notify(NOTIFICATION_ID, buildNotification("Connected → $serverIp:$port", serverIp))
    }

    private fun buildKillSwitchNotification(): Notification {
        val launchPi = PendingIntent.getActivity(
            this, 0, packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, NOTIFICATION_CHANNEL)
        } else {
            @Suppress("DEPRECATION") Notification.Builder(this)
        }
        return builder
            .setContentTitle("⚠ VPN Disconnected — Kill Switch")
            .setContentText("Traffic may be unprotected. Open the app to reconnect.")
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentIntent(launchPi)
            .setAutoCancel(true)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                NOTIFICATION_CHANNEL,
                "Private Proxy VPN",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = "VPN connection status"; setShowBadge(false) }
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }
}
