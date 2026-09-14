package com.ashish.technologies.aotg.turbo_modules.accessibility

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log
import com.ashish.technologies.aotg.NativeAccessibilitySpec
import com.ashish.technologies.aotg.services.AOTGAccessibilityService
import com.ashish.technologies.aotg.services.AgentForegroundService
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * AccessibilityModule — Turbo Module bridge between React Native and AOTGAccessibilityService.
 *
 * All methods delegate to the static AOTGAccessibilityService.instance.
 * Heavy operations (getUITree, takeScreenshot) run on a background thread pool.
 */
class AccessibilityModule(
    private val reactContext: ReactApplicationContext
) : NativeAccessibilitySpec(reactContext) {

    companion object {
        const val NAME = "Accessibility"
        private const val TAG = "AccessibilityModule"
    }

    private val executor: ExecutorService = Executors.newFixedThreadPool(2)
    private var listenerCount = 0

    init {
        // Provide React context to the AccessibilityService for event emission
        AOTGAccessibilityService.reactContext = reactContext
    }

    // ─────────────────────────────────────────────────────────────
    // Service Status
    // ─────────────────────────────────────────────────────────────

    /**
     * Checks if the AOTG AccessibilityService is currently enabled in system settings.
     */
    override fun isServiceEnabled(promise: Promise) {
        try {
            val enabled = isAccessibilityServiceEnabled()
            promise.resolve(enabled)
        } catch (e: Exception) {
            promise.reject("ERR_CHECK_SERVICE", e.message, e)
        }
    }

    /**
     * Opens the Android Accessibility Settings page so the user can enable the service.
     */
    override fun openAccessibilitySettings() {
        try {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open accessibility settings: ${e.message}", e)
        }
    }

    // ─────────────────────────────────────────────────────────────
    // UI Tree
    // ─────────────────────────────────────────────────────────────

    /**
     * Returns the current screen's accessibility tree as a JSON string.
     * Runs on a background thread to avoid blocking the JS thread.
     */
    override fun getUITree(promise: Promise) {
        executor.execute {
            try {
                val service = getServiceOrReject(promise) ?: return@execute
                val tree = service.getUITree()
                promise.resolve(tree)
            } catch (e: Exception) {
                Log.e(TAG, "getUITree error: ${e.message}", e)
                promise.reject("ERR_UI_TREE", e.message, e)
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Node Actions
    // ─────────────────────────────────────────────────────────────

    /**
     * Performs an action on a specific accessibility node.
     *
     * @param nodeId The element ID from getUITree() output
     * @param action One of: "click", "long_click", "set_text", "scroll_forward",
     *               "scroll_backward", "focus", "clear_focus", "select",
     *               "copy", "paste", "cut"
     * @param value  The value for the action (e.g., text for "set_text"). Pass empty string if N/A.
     */
    override fun performAction(nodeId: String, action: String, value: String, promise: Promise) {
        executor.execute {
            try {
                val service = getServiceOrReject(promise) ?: return@execute
                val result = service.performNodeAction(nodeId, action, value)
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "performAction error: ${e.message}", e)
                promise.reject("ERR_PERFORM_ACTION", e.message, e)
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Gesture Actions
    // ─────────────────────────────────────────────────────────────

    /**
     * Dispatches a tap gesture at the given screen coordinates.
     * Use this as a fallback when node-based click doesn't work.
     */
    override fun tapAtCoordinates(x: Double, y: Double, promise: Promise) {
        executor.execute {
            try {
                val service = getServiceOrReject(promise) ?: return@execute
                val result = service.tapAtCoordinates(x.toFloat(), y.toFloat())
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "tapAtCoordinates error: ${e.message}", e)
                promise.reject("ERR_TAP", e.message, e)
            }
        }
    }

    /**
     * Dispatches a swipe gesture between two points.
     */
    override fun swipe(
        startX: Double, startY: Double,
        endX: Double, endY: Double,
        durationMs: Double,
        promise: Promise
    ) {
        executor.execute {
            try {
                val service = getServiceOrReject(promise) ?: return@execute
                val result = service.swipeGesture(
                    startX.toFloat(), startY.toFloat(),
                    endX.toFloat(), endY.toFloat(),
                    durationMs.toLong()
                )
                promise.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "swipe error: ${e.message}", e)
                promise.reject("ERR_SWIPE", e.message, e)
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Global Actions
    // ─────────────────────────────────────────────────────────────

    override fun pressBack(promise: Promise) {
        try {
            val service = getServiceOrReject(promise) ?: return
            promise.resolve(service.pressBack())
        } catch (e: Exception) {
            promise.reject("ERR_BACK", e.message, e)
        }
    }

    override fun pressHome(promise: Promise) {
        try {
            val service = getServiceOrReject(promise) ?: return
            promise.resolve(service.pressHome())
        } catch (e: Exception) {
            promise.reject("ERR_HOME", e.message, e)
        }
    }

    override fun pressRecents(promise: Promise) {
        try {
            val service = getServiceOrReject(promise) ?: return
            promise.resolve(service.pressRecents())
        } catch (e: Exception) {
            promise.reject("ERR_RECENTS", e.message, e)
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Screenshot
    // ─────────────────────────────────────────────────────────────

    /**
     * Captures a screenshot and returns it as a base64-encoded JPEG.
     * Requires Android 11+ (API 30).
     */
    override fun takeScreenshot(promise: Promise) {
        executor.execute {
            try {
                val service = getServiceOrReject(promise) ?: return@execute
                val base64 = service.captureScreenshot()
                if (base64 != null) {
                    promise.resolve(base64)
                } else {
                    promise.reject("ERR_SCREENSHOT", "Screenshot capture failed or not supported (requires API 30+)")
                }
            } catch (e: Exception) {
                Log.e(TAG, "takeScreenshot error: ${e.message}", e)
                promise.reject("ERR_SCREENSHOT", e.message, e)
            }
        }
    }

    /**
     * Captures a screenshot and saves it directly to the app's cache directory.
     * Returns the absolute file path to the saved JPEG.
     *
     * Preferred over takeScreenshot() for vision inference — avoids large base64 strings
     * flowing through the React Native bridge.
     *
     * Requires Android 11+ (API 30).
     */
    override fun takeScreenshotToFile(promise: Promise) {
        executor.execute {
            try {
                val service = getServiceOrReject(promise) ?: return@execute
                val filePath = service.captureScreenshotToFile(reactContext.cacheDir)
                if (filePath != null) {
                    Log.d(TAG, "Screenshot saved to $filePath")
                    promise.resolve(filePath)
                } else {
                    promise.reject("ERR_SCREENSHOT", "Screenshot capture failed (requires API 30+)")
                }
            } catch (e: Exception) {
                Log.e(TAG, "takeScreenshotToFile error: ${e.message}", e)
                promise.reject("ERR_SCREENSHOT_FILE", e.message, e)
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // App Info
    // ─────────────────────────────────────────────────────────────

    /**
     * Returns the package name of the currently active foreground app.
     */
    override fun getCurrentApp(promise: Promise) {
        try {
            val service = getServiceOrReject(promise) ?: return
            promise.resolve(service.getCurrentAppPackage())
        } catch (e: Exception) {
            promise.reject("ERR_GET_APP", e.message, e)
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Agent Foreground Service
    // ─────────────────────────────────────────────────────────────

    /**
     * Starts a foreground service to keep the RN process alive while the agent runs.
     */
    override fun startAgentService(promise: Promise) {
        try {
            AgentForegroundService.start(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "startAgentService error: ${e.message}", e)
            promise.reject("ERR_START_SERVICE", e.message, e)
        }
    }

    /**
     * Stops the agent foreground service.
     */
    override fun stopAgentService(promise: Promise) {
        try {
            AgentForegroundService.stop(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "stopAgentService error: ${e.message}", e)
            promise.reject("ERR_STOP_SERVICE", e.message, e)
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Event Listener Support
    // ─────────────────────────────────────────────────────────────

    override fun addListener(eventName: String) {
        listenerCount++
    }

    override fun removeListeners(count: Double) {
        listenerCount -= count.toInt()
        if (listenerCount < 0) listenerCount = 0
    }

    // ─────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────

    /**
     * Gets the AccessibilityService instance or rejects the promise if not available.
     */
    private fun getServiceOrReject(promise: Promise): AOTGAccessibilityService? {
        val service = AOTGAccessibilityService.instance
        if (service == null) {
            promise.reject(
                "ERR_SERVICE_NOT_ENABLED",
                "Accessibility service is not enabled. Please enable it in Settings > Accessibility > AOTG."
            )
            return null
        }
        return service
    }

    /**
     * Checks if our accessibility service is currently enabled in the system.
     * Uses multiple strategies because Android stores service names in different formats
     * across OEMs and versions.
     */
    private fun isAccessibilityServiceEnabled(): Boolean {
        // Strategy 1: Check if the service instance is alive (most reliable)
        if (AOTGAccessibilityService.instance != null) {
            return true
        }

        // Strategy 2: Check the system setting string
        val enabledServices = Settings.Secure.getString(
            reactContext.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        )

        if (enabledServices.isNullOrEmpty()) {
            Log.d(TAG, "isAccessibilityServiceEnabled: No accessibility services enabled at all")
            return false
        }

        val packageName = reactContext.packageName
        val canonicalName = AOTGAccessibilityService::class.java.canonicalName ?: ""
        val simpleName = AOTGAccessibilityService::class.java.name

        // Formats Android may use:
        // "com.ashish.technologies.aotg/com.ashish.technologies.aotg.services.AOTGAccessibilityService"
        // "com.ashish.technologies.aotg/.services.AOTGAccessibilityService"
        val fullFormat = "$packageName/$canonicalName"
        val shortFormat = "$packageName/.${canonicalName.removePrefix("$packageName.")}"
        val nameFormat = "$packageName/$simpleName"

        Log.d(TAG, "isAccessibilityServiceEnabled: checking for service in enabled list")
        Log.d(TAG, "  enabledServices = $enabledServices")
        Log.d(TAG, "  fullFormat  = $fullFormat")
        Log.d(TAG, "  shortFormat = $shortFormat")
        Log.d(TAG, "  nameFormat  = $nameFormat")

        val services = enabledServices.split(':')
        return services.any { service ->
            service.equals(fullFormat, ignoreCase = true) ||
            service.equals(shortFormat, ignoreCase = true) ||
            service.equals(nameFormat, ignoreCase = true) ||
            service.contains(packageName, ignoreCase = true)
        }
    }
}
