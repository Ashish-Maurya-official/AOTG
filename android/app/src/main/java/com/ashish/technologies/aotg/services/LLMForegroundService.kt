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
 * LLMForegroundService — Keeps the React Native app process alive while
 * the LLM generation is running in the background.
 *
 * It prevents Android from putting the app to sleep or killing the process
 * while the LLM is actively streaming tokens.
 */
class LLMForegroundService : Service() {

    companion object {
        private const val TAG = "LLMForegroundService"
        private const val CHANNEL_ID = "aotg_llm_channel"
        private const val NOTIFICATION_ID = 9002
        const val ACTION_CANCEL_GENERATION = "com.ashish.technologies.aotg.CANCEL_LLM_GENERATION"

        @Volatile
        var isRunning: Boolean = false
            private set

        fun start(context: Context) {
            if (isRunning) {
                Log.d(TAG, "LLMForegroundService already running, skipping start")
                return
            }
            val intent = Intent(context, LLMForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            if (!isRunning) {
                Log.d(TAG, "LLMForegroundService not running, skipping stop")
                return
            }
            val intent = Intent(context, LLMForegroundService::class.java)
            context.stopService(intent)
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_CANCEL_GENERATION) {
            Log.i(TAG, "Received cancel action from notification")
            val cancelIntent = Intent(ACTION_CANCEL_GENERATION)
            cancelIntent.setPackage(packageName)
            sendBroadcast(cancelIntent)
            stopSelf()
            return START_NOT_STICKY
        }

        Log.i(TAG, "LLM foreground service starting")
        isRunning = true

        val notification = buildNotification()
        startForeground(NOTIFICATION_ID, notification)

        // Acquire a partial wake lock to ensure the CPU doesn't sleep while the
        // LLM generates in the background (especially when the screen is off).
        if (wakeLock == null) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "AOTG:LlmWakeLock"
            ).apply {
                acquire(15 * 60 * 1000L) // 15 minutes max timeout just in case
            }
            Log.d(TAG, "WakeLock acquired for LLM generation")
        }

        return START_NOT_STICKY
    }

    override fun onDestroy() {
        Log.i(TAG, "LLM foreground service stopping")
        isRunning = false
        
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                Log.d(TAG, "WakeLock released for LLM generation")
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
                "AOTG Generation",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when AOTG is generating an AI response"
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

        // Stop action — lets the user cancel the generation from the notification
        val stopIntent = Intent(this, LLMForegroundService::class.java).apply {
            action = ACTION_CANCEL_GENERATION
        }
        val stopPending = PendingIntent.getService(
            this, 2, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setContentTitle("AOTG is generating a response")
            .setContentText("Generating...")
            .setSmallIcon(android.R.drawable.ic_media_play) // fallback icon
            .setOngoing(true)
            .setContentIntent(tapPending)
            .addAction(
                Notification.Action.Builder(
                    null, "Cancel", stopPending
                ).build()
            )
            .build()
    }
}
