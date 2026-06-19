package PACKAGE_NAME

import android.system.Os
import android.system.OsConstants
import android.util.Log
import java.io.File
import java.io.FileDescriptor
import java.io.InputStream
import java.lang.reflect.Field
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Manages the tun2socks subprocess.
 *
 * tun2socks reads raw IP packets from the TUN file descriptor and forwards
 * them through a SOCKS5 proxy. This enables ALL app traffic to be tunneled
 * — not just apps that respect Android's system HTTP proxy setting.
 *
 * Usage:
 *   val proc = Tun2SocksProcess(binaryFile, tun2socksConfig)
 *   proc.start()
 *   ...
 *   proc.stop()
 */
class Tun2SocksProcess(
    private val binary: File,
    private val config: Tun2SocksConfig
) {
    data class Tun2SocksConfig(
        val tunFd: Int,
        val proxyScheme: String,       // "socks5" | "http" | "ss"
        val proxyHost: String,
        val proxyPort: Int,
        val username: String = "",
        val password: String = "",
        // Shadowsocks-specific
        val ssMethod: String = "chacha20-ietf-poly1305",
        val ssPassword: String = "",
        val dnsMode: String = "direct", // "direct" | "fake"
        val fakeIpRange: String = "198.18.0.0/15",
    )

    private var process: Process? = null
    private val running = AtomicBoolean(false)
    private var logThread: Thread? = null

    companion object {
        private const val TAG = "Tun2SocksProcess"

        fun isBinaryAvailable(filesDir: File): Boolean {
            return File(filesDir, "tun2socks").let { it.exists() && it.canExecute() }
        }

        /**
         * Copy the tun2socks binary from assets into the app's files directory
         * and mark it executable.
         *
         * Call this once at app startup (or before first VPN connect).
         * The binary file should be placed in:
         *   android/app/src/main/assets/tun2socks-<abi>
         * where <abi> is arm64-v8a, armeabi-v7a, x86, or x86_64.
         *
         * The config plugin (withProxyVpn.js) copies the correct ABI variant
         * at build time based on the device's supported ABIs.
         */
        fun installBinary(context: android.content.Context): Boolean {
            val dest = File(context.filesDir, "tun2socks")
            if (dest.exists() && dest.canExecute()) return true

            val abi = android.os.Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64-v8a"
            val assetName = "tun2socks-$abi"

            return try {
                context.assets.open(assetName).use { input ->
                    dest.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
                dest.setExecutable(true, true)
                Log.i(TAG, "tun2socks binary installed from assets/$assetName")
                true
            } catch (e: Exception) {
                Log.w(TAG, "Could not install tun2socks binary: ${e.message}")
                false
            }
        }

        /**
         * Clear FD_CLOEXEC on the TUN file descriptor so the child process
         * inherits it after fork/exec.
         *
         * Android sets O_CLOEXEC on most fds by default. Without clearing it,
         * the child process will not have access to the TUN fd.
         */
        fun makeFdInheritable(fd: Int): Boolean {
            return try {
                // Construct a FileDescriptor object wrapping the raw int fd.
                val fdObj = FileDescriptor()
                val field: Field = FileDescriptor::class.java.getDeclaredField("descriptor")
                field.isAccessible = true
                field.setInt(fdObj, fd)

                // F_SETFD with 0 = clear all fd flags (including FD_CLOEXEC = 1)
                Os.fcntl(fdObj, OsConstants.F_SETFD, 0)
                Log.d(TAG, "FD_CLOEXEC cleared on fd=$fd")
                true
            } catch (e: Exception) {
                Log.e(TAG, "Could not clear FD_CLOEXEC: ${e.message}")
                false
            }
        }
    }

    fun start(): Boolean {
        if (!binary.exists() || !binary.canExecute()) {
            Log.e(TAG, "tun2socks binary not found at ${binary.absolutePath}")
            return false
        }

        if (!makeFdInheritable(config.tunFd)) {
            Log.w(TAG, "Could not make TUN fd inheritable, tun2socks may fail")
        }

        val proxyUrl = buildProxyUrl()

        val args = mutableListOf(
            binary.absolutePath,
            "--tun-fd", config.tunFd.toString(),
            "--proxy", proxyUrl,
            "--loglevel", "warning",
        )

        if (config.dnsMode == "fake") {
            args += listOf("--fake-dns-range", config.fakeIpRange)
        }

        Log.i(TAG, "Starting tun2socks: ${args.joinToString(" ").replace(Regex(":[^@]+@"), ":***@")}")

        return try {
            process = ProcessBuilder(args)
                .redirectErrorStream(true)
                .start()

            running.set(true)

            // Log subprocess output
            logThread = thread(name = "Tun2SocksLog") {
                drainStream(process!!.inputStream)
            }

            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start tun2socks: ${e.message}")
            false
        }
    }

    fun stop() {
        running.set(false)
        try {
            process?.destroy()
            process?.waitFor()
        } catch (_: Exception) {}
        process = null
        logThread?.interrupt()
        logThread = null
        Log.i(TAG, "tun2socks stopped")
    }

    fun isRunning(): Boolean {
        return try {
            process?.exitValue()
            false  // exitValue() succeeds only when the process has exited
        } catch (_: IllegalThreadStateException) {
            true   // still running
        }
    }

    private fun buildProxyUrl(): String {
        return when (config.proxyScheme) {
            "ss" -> {
                // Shadowsocks: ss://base64(method:password)@host:port
                val methodPass = "${config.ssMethod}:${config.ssPassword}"
                val b64 = android.util.Base64.encodeToString(
                    methodPass.toByteArray(Charsets.UTF_8),
                    android.util.Base64.NO_WRAP or android.util.Base64.URL_SAFE
                )
                "ss://$b64@${config.proxyHost}:${config.proxyPort}"
            }
            else -> {
                val creds = if (config.username.isNotBlank()) {
                    "${encode(config.username)}:${encode(config.password)}@"
                } else ""
                "${config.proxyScheme}://$creds${config.proxyHost}:${config.proxyPort}"
            }
        }
    }

    private fun encode(s: String): String =
        java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    private fun drainStream(stream: InputStream) {
        try {
            stream.bufferedReader().forEachLine { line ->
                Log.d(TAG, line)
            }
        } catch (_: Exception) {}
    }
}
