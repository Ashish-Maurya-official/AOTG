package com.ashish.technologies.aotg.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import com.ashish.technologies.aotg.MainActivity

/**
 * AgentForegroundService — Keeps the React Native JS thread alive while
 * the AI agent is running in the background.
 *
 * Without this service, Android will kill the RN process shortly after the
 * user switches away from AOTG (which is required for the agent to observe
 * and interact with other apps).
 *
 * Usage (from AccessibilityModule):
 *   AgentForegroundService.start(reactContext)
 *   AgentForegroundService.stop(reactContext)
 */
class AgentForegroundService : Service() {

    companion object {
        private const val TAG = "AgentForegroundService"
        private const val CHANNEL_ID = "aotg_agent_channel"
        private const val NOTIFICATION_ID = 9001

        @Volatile
        var isRunning: Boolean = false
            private set

        fun start(context: Context) {
            if (isRunning) {
                Log.d(TAG, "Service already running, skipping start")
                return
            }
            val intent = Intent(context, AgentForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            if (!isRunning) {
                Log.d(TAG, "Service not running, skipping stop")
                return
            }
            val intent = Intent(context, AgentForegroundService::class.java)
            context.stopService(intent)
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "Agent foreground service starting")
        isRunning = true

        val notification = buildNotification()
        startForeground(NOTIFICATION_ID, notification)

        // Acquire a partial wake lock to ensure the CPU doesn't sleep while the
        // LLM generates in the background (especially when the screen is off).
        if (wakeLock == null) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "AOTG:AgentWakeLock"
            ).apply {
                acquire(10 * 60 * 1000L) // 10 minutes max timeout just in case
            }
            Log.d(TAG, "WakeLock acquired")
        }

        // If the system kills this service, don't restart automatically —
        // the agent loop is already dead at that point.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        Log.i(TAG, "Agent foreground service stopping")
        isRunning = false
        
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                Log.d(TAG, "WakeLock released")
            }
        }
        wakeLock = null

        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ─────────────────────────────────────────────────────────────
    // Notification
    // ─────────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "AOTG Agent",
                NotificationManager.IMPORTANCE_LOW  // No sound, just a persistent icon
            ).apply {
                description = "Shows when the AI agent is actively running a task"
                setShowBadge(false)
            }

            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        // Tapping the notification returns the user to AOTG
        val tapIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val tapPending = PendingIntent.getActivity(
            this, 0, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Stop action — lets the user cancel the agent from the notification
        val stopIntent = Intent(this, AgentForegroundService::class.java)
        val stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setContentTitle("AOTG Agent")
            .setContentText("Agent is running a task...")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setContentIntent(tapPending)
            .addAction(
                Notification.Action.Builder(
                    null, "Stop", stopPending
                ).build()
            )
            .build()
    }
}
