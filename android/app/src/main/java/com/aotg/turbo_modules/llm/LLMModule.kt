package com.aotg.turbo_modules.llm

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.turbomodule.core.interfaces.TurboModule

class LLMModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), TurboModule {

    companion object {
        const val NAME = "LLM"
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun initialize(modelPath: String, backend: String, promise: Promise) {
        // TODO: Implement model initialization logic
        promise.resolve(true)
    }

    @ReactMethod
    fun startGeneration(prompt: String) {
        // TODO: Implement generation logic
        // Use reactContext to emit events via DeviceEventManagerModule
    }

    @ReactMethod
    fun stopGeneration() {
        // TODO: Implement stop generation logic
    }
}
