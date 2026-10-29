package com.ashish.technologies.aotg

import android.app.ActivityManager
import android.content.Context
import android.os.Debug
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MemoryModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "DeviceMemory"

    @ReactMethod
    fun getMemoryInfo(promise: Promise) {
        try {
            val actManager = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            val memInfo = ActivityManager.MemoryInfo()
            actManager?.getMemoryInfo(memInfo)

            val totalBytes = memInfo.totalMem.toDouble()
            val availBytes = memInfo.availMem.toDouble()
            val usedBytes = (memInfo.totalMem - memInfo.availMem).toDouble()
            val nativeHeapAllocated = Debug.getNativeHeapAllocatedSize().toDouble()

            val map = Arguments.createMap().apply {
                putDouble("totalBytes", totalBytes)
                putDouble("availableBytes", availBytes)
                putDouble("usedBytes", usedBytes)
                putDouble("nativeHeapBytes", nativeHeapAllocated)
                putBoolean("isLowMemory", memInfo.lowMemory)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERR_MEMORY", e.message, e)
        }
    }
}

