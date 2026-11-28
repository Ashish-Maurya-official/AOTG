package com.ashish.technologies.aotg.services

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.ashish.technologies.aotg.MainActivity
import com.ashish.technologies.aotg.turbo_modules.llm.LLMModule
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject

/** Owns the background JS task, notification, deadline and native cancellation gate. */
class AgentForegroundService : HeadlessJsTaskService() {
    companion object {
        private const val CHANNEL_ID = "aotg_agent_channel"
        private const val NOTIFICATION_ID = 9001
        private const val ACTION_START = "com.ashish.technologies.aotg.AGENT_START"
        private const val ACTION_STOP = "com.ashish.technologies.aotg.AGENT_STOP"
        private val handler = Handler(Looper.getMainLooper())
        @Volatile private var activeTaskId: String? = null
        @Volatile private var cancelled = false
        @Volatile private var reason = ""
        @Volatile private var screenEpoch = 0
        @Volatile private var pendingStart: Promise? = null
        val isRunning: Boolean get() = activeTaskId != null
        val currentScreenEpoch: Int get() = screenEpoch

        @Synchronized
        fun start(context: Context, taskId: String, timeoutMs: Long, promise: Promise) {
            if (taskId.isBlank() || activeTaskId != null) {
                promise.reject("ERR_AGENT_BUSY", "An agent task is already starting or running")
                return
            }
            activeTaskId = taskId
            cancelled = false
            reason = ""
            pendingStart = promise
            try {
                ContextCompat.startForegroundService(context, Intent(context, AgentForegroundService::class.java).apply {
                    action = ACTION_START
                    putExtra("taskId", taskId)
                    putExtra("timeoutMs", timeoutMs.coerceIn(1000L, 10 * 60 * 1000L))
                })
                handler.postDelayed({
                    synchronized(Companion) {
                        if (activeTaskId == taskId && pendingStart != null) {
                            requestCancel(context, taskId, "startup_timeout")
                            pendingStart?.reject("ERR_AGENT_START", "Background task did not start")
                            pendingStart = null
                            stop(context, taskId)
                        }
                    }
                }, 10000L)
            } catch (error: Exception) {
                activeTaskId = null
                pendingStart = null
                LLMModule.activeInstance?.releaseAgentSessionAfterService(taskId)
                promise.reject("ERR_AGENT_START", error.message, error)
            }
        }

        fun isPaused(context: Context): Boolean =
            !(context.getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive ||
                (context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked

        @Synchronized
        fun canAct(context: Context, taskId: String): Boolean =
            taskId == activeTaskId && !cancelled && !isPaused(context)

        @Synchronized
        fun state(context: Context): JSONObject = JSONObject().apply {
            put("taskId", activeTaskId ?: JSONObject.NULL)
            put("cancelled", cancelled)
            put("paused", isPaused(context))
            put("reason", reason)
            put("screenEpoch", screenEpoch)
        }

        @Synchronized
        fun requestCancel(context: Context, taskId: String, cancelReason: String = "cancelled"): Boolean {
            if (activeTaskId != taskId) return false
            if (cancelled) return true
            cancelled = true
            reason = cancelReason
            LLMModule.activeInstance?.cancelAgentGeneration(taskId)
            emitState(context)
            // Stop even if the JS runtime never acknowledges cancellation.
            handler.postDelayed({ stop(context, taskId) }, 10000L)
            return true
        }

        @Synchronized
        fun stop(context: Context, taskId: String): Boolean {
            if (activeTaskId != taskId) return false
            requestCancel(context, taskId, "service_stopped")
            val stopped = context.stopService(Intent(context, AgentForegroundService::class.java))
            if (!stopped && activeTaskId == taskId) {
                pendingStart?.reject("ERR_AGENT_START", "Agent service did not start")
                pendingStart = null
                activeTaskId = null
                LLMModule.activeInstance?.releaseAgentSessionAfterService(taskId)
            }
            return stopped
        }

        @Synchronized
        private fun emitState(context: Context) {
            try {
                AOTGAccessibilityService.reactContext?.let { reactContext ->
                    if (reactContext.hasActiveReactInstance()) {
                        val event = Arguments.createMap().apply {
                            putString("taskId", activeTaskId)
                            putBoolean("cancelled", cancelled)
                            putBoolean("paused", isPaused(context))
                            putString("reason", reason)
                            putInt("screenEpoch", screenEpoch)
                        }
                        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                            .emit("onAgentControl", event)
                    }
                }
            } catch (error: Exception) {
                Log.w("AgentForegroundService", "React runtime disconnected during task control", error)
            }
        }
    }

    private var taskDispatched = false
    private var serviceTaskId: String? = null
    private val deadlineHandler = Handler(Looper.getMainLooper())
    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            screenEpoch++
            if (isPaused(context)) {
                serviceTaskId?.let { LLMModule.activeInstance?.cancelAgentGeneration(it) }
            }
            emitState(context)
            getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
        }
    }

    override fun onCreate() {
        super.onCreate()
        serviceTaskId = activeTaskId
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "AOTG Agent", NotificationManager.IMPORTANCE_LOW)
        )
        ContextCompat.registerReceiver(this, screenReceiver, IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }, ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val taskId = intent?.getStringExtra("taskId")
        if (taskId == null || taskId != activeTaskId) {
            if (activeTaskId == null) stopSelf()
            return START_NOT_STICKY
        }
        if (intent.action == ACTION_STOP) {
            requestCancel(this, taskId)
            return START_NOT_STICKY
        }
        if (intent.action != ACTION_START || taskDispatched) return START_NOT_STICKY
        serviceTaskId = taskId
        try {
            startForeground(NOTIFICATION_ID, buildNotification())
            taskDispatched = true
            super.onStartCommand(intent, flags, startId)
            pendingStart?.resolve(true)
            pendingStart = null
            deadlineHandler.postDelayed({
                requestCancel(this, taskId, "timeout")
                deadlineHandler.postDelayed({ stopSelf() }, 10000L)
            }, intent.getLongExtra("timeoutMs", 10 * 60 * 1000L))
        } catch (error: Exception) {
            requestCancel(this, taskId, "startup_failed")
            pendingStart?.reject("ERR_AGENT_START", error.message, error)
            pendingStart = null
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        val taskId = intent?.getStringExtra("taskId") ?: return null
        return HeadlessJsTaskConfig("AOTGAgentTask", Arguments.createMap().apply {
            putString("taskId", taskId)
        }, intent.getLongExtra("timeoutMs", 10 * 60 * 1000L) + 15000L, true)
    }

    override fun onDestroy() {
        deadlineHandler.removeCallbacksAndMessages(null)
        unregisterReceiver(screenReceiver)
        serviceTaskId?.let { taskId ->
            requestCancel(this, taskId, if (cancelled) reason else "service_stopped")
            LLMModule.activeInstance?.releaseAgentSessionAfterService(taskId)
            synchronized(Companion) {
                if (activeTaskId == taskId) {
                    activeTaskId = null
                    pendingStart?.reject("ERR_AGENT_START", "Agent service stopped before startup completed")
                    pendingStart = null
                }
            }
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val tap = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, AgentForegroundService::class.java).apply {
            action = ACTION_STOP
            putExtra("taskId", activeTaskId)
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("AOTG Agent")
            .setContentText(if (isPaused(this)) "Paused — unlock your phone to continue" else "Running your task")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setContentIntent(tap)
            .addAction(Notification.Action.Builder(null, "Stop", stop).build())
            .build()
    }
}
