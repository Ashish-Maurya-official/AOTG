package com.aotg.services

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * AOTGAccessibilityService — Core Android AccessibilityService for the AI Agent.
 *
 * This service runs as a privileged system service and provides:
 * 1. UI tree extraction → structured JSON for LLM consumption
 * 2. Node-based actions (click, setText, scroll, focus, longClick)
 * 3. Gesture dispatch (tap, swipe via GestureDescription)
 * 4. Screenshot capture (API 30+)
 * 5. Global actions (back, home, recents)
 *
 * Communication with React Native happens through a static instance
 * reference that the AccessibilityModule Turbo Module accesses.
 */
class AOTGAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "AOTGAccessibility"
        private const val MAX_TREE_DEPTH = 25
        private const val MAX_NODES = 500

        // Static instance for Turbo Module access
        @Volatile
        var instance: AOTGAccessibilityService? = null
            private set

        // Optional React context for emitting events
        @Volatile
        var reactContext: ReactApplicationContext? = null
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    // ─────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "AccessibilityService connected")
        emitEvent("onServiceConnected", Arguments.createMap())
    }

    override fun onDestroy() {
        instance = null
        Log.i(TAG, "AccessibilityService destroyed")
        emitEvent("onServiceDisconnected", Arguments.createMap())
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                val packageName = event.packageName?.toString() ?: return
                // Avoid spamming events for our own app
                if (packageName == "com.aotg") return

                val params = Arguments.createMap().apply {
                    putString("packageName", packageName)
                    putString("className", event.className?.toString() ?: "")
                    putInt("eventType", event.eventType)
                }
                emitEvent("onScreenChanged", params)
            }
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "AccessibilityService interrupted")
    }

    // ─────────────────────────────────────────────────────────────
    // UI Tree Extraction
    // ─────────────────────────────────────────────────────────────

    /**
     * Extracts the current screen's accessibility tree as a structured JSON string.
     *
     * Output format:
     * {
     *   "app": "com.example.app",
     *   "timestamp": 1693920000000,
     *   "elements": [
     *     {
     *       "id": "0_3_1",
     *       "resourceId": "com.example:id/search",
     *       "type": "EditText",
     *       "text": "",
     *       "hint": "Search",
     *       "contentDescription": "",
     *       "clickable": true,
     *       "editable": true,
     *       "focusable": true,
     *       "scrollable": false,
     *       "enabled": true,
     *       "checked": false,
     *       "bounds": { "left": 0, "top": 0, "right": 1080, "bottom": 200 }
     *     }
     *   ]
     * }
     */
    fun getUITree(): String {
        val root = rootInActiveWindow ?: return buildEmptyTree("No active window")

        val result = JSONObject()
        val elements = JSONArray()
        var nodeCount = 0

        try {
            result.put("app", root.packageName?.toString() ?: "unknown")
            result.put("timestamp", System.currentTimeMillis())

            // Flatten the tree into a list of actionable/visible elements
            nodeCount = traverseNode(root, elements, "", 0, nodeCount)

            result.put("elements", elements)
            result.put("totalNodes", nodeCount)
        } catch (e: Exception) {
            Log.e(TAG, "Error extracting UI tree: ${e.message}", e)
            result.put("error", e.message)
        } finally {
            root.recycle()
        }

        return result.toString()
    }

    /**
     * Recursively traverses the accessibility node tree and collects
     * actionable/visible elements into a flat JSON array.
     *
     * @param node Current node
     * @param elements Output array
     * @param pathPrefix Path-based ID prefix (e.g., "0_3")
     * @param depth Current recursion depth
     * @param currentCount Current node count (for capping)
     * @return Updated node count
     */
    private fun traverseNode(
        node: AccessibilityNodeInfo,
        elements: JSONArray,
        pathPrefix: String,
        depth: Int,
        currentCount: Int
    ): Int {
        if (depth > MAX_TREE_DEPTH || currentCount >= MAX_NODES) return currentCount

        var count = currentCount
        val rect = android.graphics.Rect()
        node.getBoundsInScreen(rect)

        // Only include nodes that are visible and potentially interactive or informative
        val isActionable = node.isClickable || node.isLongClickable ||
                node.isEditable || node.isScrollable || node.isFocusable
        val hasText = !node.text.isNullOrEmpty() ||
                !node.contentDescription.isNullOrEmpty() ||
                !node.hintText.isNullOrEmpty()
        val isVisible = rect.width() > 0 && rect.height() > 0

        if (isVisible && (isActionable || hasText)) {
            val nodeId = if (pathPrefix.isEmpty()) "$count" else "${pathPrefix}_$count"

            val element = JSONObject().apply {
                put("id", nodeId)
                put("resourceId", node.viewIdResourceName ?: "")
                put("type", extractSimpleClassName(node.className?.toString()))
                put("text", node.text?.toString() ?: "")
                put("hint", node.hintText?.toString() ?: "")
                put("contentDescription", node.contentDescription?.toString() ?: "")
                put("clickable", node.isClickable)
                put("longClickable", node.isLongClickable)
                put("editable", node.isEditable)
                put("focusable", node.isFocusable)
                put("scrollable", node.isScrollable)
                put("enabled", node.isEnabled)
                put("checked", node.isChecked)
                put("selected", node.isSelected)
                put("bounds", JSONObject().apply {
                    put("left", rect.left)
                    put("top", rect.top)
                    put("right", rect.right)
                    put("bottom", rect.bottom)
                })
            }
            elements.put(element)
            count++
        }

        // Recurse into children
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            try {
                val childPrefix = if (pathPrefix.isEmpty()) "$i" else "${pathPrefix}_$i"
                count = traverseNode(child, elements, childPrefix, depth + 1, count)
            } finally {
                child.recycle()
            }
        }

        return count
    }

    /**
     * Extracts simple class name from full class path.
     * e.g., "android.widget.Button" → "Button"
     */
    private fun extractSimpleClassName(className: String?): String {
        if (className == null) return "View"
        val lastDot = className.lastIndexOf('.')
        return if (lastDot >= 0 && lastDot < className.length - 1) {
            className.substring(lastDot + 1)
        } else {
            className
        }
    }

    private fun buildEmptyTree(reason: String): String {
        return JSONObject().apply {
            put("app", "unknown")
            put("timestamp", System.currentTimeMillis())
            put("elements", JSONArray())
            put("error", reason)
        }.toString()
    }

    // ─────────────────────────────────────────────────────────────
    // Node Actions
    // ─────────────────────────────────────────────────────────────

    /**
     * Finds a node by its element ID (from getUITree) and performs an action.
     *
     * Supported actions: "click", "long_click", "set_text", "scroll_forward",
     * "scroll_backward", "focus", "clear_focus", "copy", "paste", "cut"
     *
     * For "set_text", the value parameter is used as the text to set.
     *
     * @return true if action was performed successfully
     */
    fun performNodeAction(nodeId: String, action: String, value: String): Boolean {
        val root = rootInActiveWindow ?: run {
            Log.e(TAG, "performNodeAction: No active window")
            return false
        }

        try {
            val targetNode = findNodeById(root, nodeId) ?: run {
                Log.e(TAG, "performNodeAction: Node not found for id=$nodeId")
                return false
            }

            try {
                return executeAction(targetNode, action, value)
            } finally {
                targetNode.recycle()
            }
        } finally {
            root.recycle()
        }
    }

    /**
     * Finds a node by matching against the ID we assigned during tree traversal.
     * We re-traverse the tree and match by position.
     */
    private fun findNodeById(root: AccessibilityNodeInfo, targetId: String): AccessibilityNodeInfo? {
        val elements = JSONArray()
        traverseNode(root, elements, "", 0, 0)

        // Walk through the collected elements and find the matching one
        // Then re-search the tree for a node matching the same properties
        for (i in 0 until elements.length()) {
            val element = elements.getJSONObject(i)
            if (element.getString("id") == targetId) {
                // Found the element metadata — now find the actual node
                val resourceId = element.optString("resourceId", "")
                val text = element.optString("text", "")
                val type = element.optString("type", "")
                val bounds = element.getJSONObject("bounds")

                return findMatchingNode(
                    root, resourceId, text, type,
                    bounds.getInt("left"), bounds.getInt("top"),
                    bounds.getInt("right"), bounds.getInt("bottom")
                )
            }
        }
        return null
    }

    /**
     * Finds a node in the tree matching the given properties.
     * Uses bounds as the primary identifier since they're unique per visible element.
     */
    private fun findMatchingNode(
        node: AccessibilityNodeInfo,
        resourceId: String,
        text: String,
        type: String,
        left: Int, top: Int, right: Int, bottom: Int
    ): AccessibilityNodeInfo? {
        val rect = android.graphics.Rect()
        node.getBoundsInScreen(rect)

        // Match by bounds (most reliable) + additional checks
        if (rect.left == left && rect.top == top && rect.right == right && rect.bottom == bottom) {
            val nodeType = extractSimpleClassName(node.className?.toString())
            val nodeText = node.text?.toString() ?: ""
            val nodeResId = node.viewIdResourceName ?: ""

            // At least bounds match — check if type also matches for confidence
            if (nodeType == type || nodeResId == resourceId || nodeText == text) {
                return AccessibilityNodeInfo.obtain(node)
            }
        }

        // Recurse into children
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            try {
                val found = findMatchingNode(child, resourceId, text, type, left, top, right, bottom)
                if (found != null) return found
            } finally {
                child.recycle()
            }
        }

        return null
    }

    /**
     * Executes a specific action on a node.
     */
    private fun executeAction(node: AccessibilityNodeInfo, action: String, value: String): Boolean {
        return when (action.lowercase()) {
            "click" -> node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            "long_click" -> node.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)
            "set_text" -> {
                // Strategy 1: Native ACTION_SET_TEXT (works for native Android views)
                val args = Bundle().apply {
                    putCharSequence(
                        AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                        value
                    )
                }
                node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                val setTextResult = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)

                if (setTextResult) {
                    Log.d(TAG, "set_text: ACTION_SET_TEXT succeeded")
                    return true
                }

                // Strategy 2: Clipboard paste fallback (works for RN/Flutter/WebView)
                Log.w(TAG, "set_text: ACTION_SET_TEXT failed, trying clipboard paste fallback")
                try {
                    val clipboard = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
                    val clip = android.content.ClipData.newPlainText("aotg_agent_text", value)
                    clipboard.setPrimaryClip(clip)
                    node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                    val pasteResult = node.performAction(AccessibilityNodeInfo.ACTION_PASTE)
                    Log.d(TAG, "set_text: clipboard paste result = $pasteResult")
                    pasteResult
                } catch (e: Exception) {
                    Log.e(TAG, "set_text: clipboard fallback failed: ${e.message}", e)
                    false
                }
            }
            "scroll_forward" -> node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
            "scroll_backward" -> node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
            "focus" -> node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
            "clear_focus" -> node.performAction(AccessibilityNodeInfo.ACTION_CLEAR_FOCUS)
            "select" -> node.performAction(AccessibilityNodeInfo.ACTION_SELECT)
            "copy" -> node.performAction(AccessibilityNodeInfo.ACTION_COPY)
            "paste" -> node.performAction(AccessibilityNodeInfo.ACTION_PASTE)
            "cut" -> node.performAction(AccessibilityNodeInfo.ACTION_CUT)
            else -> {
                Log.w(TAG, "Unknown action: $action")
                false
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Gesture Dispatch
    // ─────────────────────────────────────────────────────────────

    /**
     * Dispatches a tap gesture at the given screen coordinates.
     * This is a fallback for when node-based ACTION_CLICK fails.
     */
    fun tapAtCoordinates(x: Float, y: Float): Boolean {
        val path = Path().apply {
            moveTo(x, y)
        }

        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 100))
            .build()

        val result = AtomicBoolean(false)
        val latch = CountDownLatch(1)

        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                result.set(true)
                latch.countDown()
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                result.set(false)
                latch.countDown()
            }
        }, null)

        latch.await(3, TimeUnit.SECONDS)
        return result.get()
    }

    /**
     * Dispatches a swipe gesture between two points.
     */
    fun swipeGesture(
        startX: Float, startY: Float,
        endX: Float, endY: Float,
        durationMs: Long
    ): Boolean {
        val path = Path().apply {
            moveTo(startX, startY)
            lineTo(endX, endY)
        }

        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
            .build()

        val result = AtomicBoolean(false)
        val latch = CountDownLatch(1)

        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                result.set(true)
                latch.countDown()
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                result.set(false)
                latch.countDown()
            }
        }, null)

        latch.await(durationMs + 3000, TimeUnit.MILLISECONDS)
        return result.get()
    }

    // ─────────────────────────────────────────────────────────────
    // Global Actions
    // ─────────────────────────────────────────────────────────────

    fun pressBack(): Boolean = performGlobalAction(GLOBAL_ACTION_BACK)
    fun pressHome(): Boolean = performGlobalAction(GLOBAL_ACTION_HOME)
    fun pressRecents(): Boolean = performGlobalAction(GLOBAL_ACTION_RECENTS)
    fun openNotifications(): Boolean = performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
    fun openQuickSettings(): Boolean = performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS)

    // ─────────────────────────────────────────────────────────────
    // Screenshot
    // ─────────────────────────────────────────────────────────────

    /**
     * Takes a screenshot and returns it as a base64-encoded JPEG string.
     * Requires API 30+ (Android 11).
     *
     * @return base64 string or null if not supported / failed
     */
    fun captureScreenshot(): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            Log.w(TAG, "takeScreenshot requires API 30+, current: ${Build.VERSION.SDK_INT}")
            return null
        }

        val resultRef = AtomicReference<String?>(null)
        val latch = CountDownLatch(1)

        takeScreenshot(
            android.view.Display.DEFAULT_DISPLAY,
            mainExecutor,
            object : TakeScreenshotCallback {
                override fun onSuccess(screenshot: ScreenshotResult) {
                    try {
                        val hardwareBuffer = screenshot.hardwareBuffer
                        val colorSpace = screenshot.colorSpace
                        val bitmap = Bitmap.wrapHardwareBuffer(hardwareBuffer, colorSpace)
                        hardwareBuffer.close()

                        if (bitmap != null) {
                            // Scale down for LLM efficiency (max 720px width)
                            val scaledBitmap = scaleBitmap(bitmap, 720)
                            val stream = ByteArrayOutputStream()
                            scaledBitmap.compress(Bitmap.CompressFormat.JPEG, 70, stream)
                            resultRef.set(Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP))

                            if (scaledBitmap !== bitmap) scaledBitmap.recycle()
                            bitmap.recycle()
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error processing screenshot: ${e.message}", e)
                    } finally {
                        latch.countDown()
                    }
                }

                override fun onFailure(errorCode: Int) {
                    Log.e(TAG, "Screenshot failed with error code: $errorCode")
                    latch.countDown()
                }
            }
        )

        latch.await(5, TimeUnit.SECONDS)
        return resultRef.get()
    }

    /**
     * Scales a bitmap to a maximum width while maintaining aspect ratio.
     */
    private fun scaleBitmap(bitmap: Bitmap, maxWidth: Int): Bitmap {
        if (bitmap.width <= maxWidth) return bitmap
        val scale = maxWidth.toFloat() / bitmap.width.toFloat()
        val newHeight = (bitmap.height * scale).toInt()
        return Bitmap.createScaledBitmap(bitmap, maxWidth, newHeight, true)
    }

    // ─────────────────────────────────────────────────────────────
    // Current App Info
    // ─────────────────────────────────────────────────────────────

    /**
     * Returns the package name of the currently active (foreground) app.
     */
    fun getCurrentAppPackage(): String {
        val root = rootInActiveWindow
        val pkg = root?.packageName?.toString() ?: "unknown"
        root?.recycle()
        return pkg
    }

    // ─────────────────────────────────────────────────────────────
    // Event Emission to React Native
    // ─────────────────────────────────────────────────────────────

    private fun emitEvent(eventName: String, params: com.facebook.react.bridge.WritableMap) {
        val ctx = reactContext ?: return
        if (!ctx.hasActiveReactInstance()) return

        mainHandler.post {
            try {
                ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit(eventName, params)
            } catch (e: Exception) {
                Log.e(TAG, "Error emitting event $eventName: ${e.message}")
            }
        }
    }
}
