package com.ashish.technologies.aotg.turbo_modules.agenttools

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.ai.edge.litertlm.OpenApiTool
import com.google.ai.edge.litertlm.ToolProvider
import com.google.ai.edge.litertlm.tool
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** The inference actor suspends here; network work never runs on it or the audio thread. */
internal object AgentToolBridge {
    private data class Pending(val generationId: String, val result: CompletableDeferred<String>, val context: ReactApplicationContext, val maxBytes: Int)
    @Volatile private var descriptions: List<String> = emptyList()
    private val pending = ConcurrentHashMap<String, Pending>()

    fun configure(json: String) {
        require(json.length <= 16000) { "Tool catalog too large" }
        val array = JSONArray(json)
        require(array.length() <= 12) { "Too many tools" }
        descriptions = (0 until array.length()).map { array.getJSONObject(it).toString() }
        if (descriptions.isEmpty()) pending.values.map { it.generationId }.distinct().forEach(::cancel)
    }

    fun providers(): List<ToolProvider> = descriptions.map { description ->
        tool(object : OpenApiTool {
            override fun getToolDescriptionJsonString() = description
            override fun execute(paramsJsonString: String) = unavailable("Automatic native dispatch is disabled")
        })
    }

    fun isEnabled() = descriptions.isNotEmpty()

    fun beginTurn(context: ReactApplicationContext, generationId: String, mode: String) {
        if (context.hasActiveReactInstance()) context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onAgentToolTurnStarted", Arguments.createMap().apply {
                putString("generationId", generationId)
                putString("mode", mode)
            })
    }

    fun unavailable(message: String): String = JSONObject().put("status", "unavailable").put("content", message).toString()

    fun responseValue(value: Any?): Any? = when (value) {
        is JSONObject -> value.keys().asSequence().associateWith { responseValue(value.get(it)) }
        is JSONArray -> (0 until value.length()).map { responseValue(value.get(it)) }
        JSONObject.NULL -> null
        else -> value
    }

    suspend fun request(context: ReactApplicationContext, generationId: String, name: String, arguments: String,
                        maxResultBytes: Int, mode: String, isActive: () -> Boolean): String {
        if (!isActive() || !context.hasActiveReactInstance() || arguments.length > 6000 ||
            descriptions.none { JSONObject(it).optString("name") == name }) return unavailable("Capability unavailable")
        val requestId = UUID.randomUUID().toString()
        val deferred = CompletableDeferred<String>()
        pending[requestId] = Pending(generationId, deferred, context, maxResultBytes)
        try {
            if (!isActive()) return unavailable("Request cancelled")
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onAgentToolRequest", Arguments.createMap().apply {
                    putString("requestId", requestId)
                    putString("generationId", generationId)
                    putString("name", name)
                    putString("argumentsJson", arguments)
                    putInt("maxResultBytes", maxResultBytes)
                    putString("mode", mode)
                })
            return withTimeoutOrNull(24000) { deferred.await() } ?: unavailable("Source retrieval timed out; current data is unverified")
        } finally {
            pending.remove(requestId)
            if (!deferred.isCompleted) emitCancellation(context, requestId)
        }
    }

    fun resolve(requestId: String, json: String): Boolean {
        val request = pending[requestId] ?: return false
        if (json.toByteArray(Charsets.UTF_8).size > request.maxBytes) return request.result.complete(unavailable("Tool output exceeded budget"))
        JSONObject(json) // Reject malformed bridge output.
        return request.result.complete(json)
    }

    fun cancel(generationId: String) {
        pending.entries.filter { it.value.generationId == generationId }.forEach { (id, request) ->
            request.result.complete(unavailable("Request cancelled"))
            emitCancellation(request.context, id)
        }
    }

    private fun emitCancellation(context: ReactApplicationContext, id: String) {
        if (context.hasActiveReactInstance()) context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onAgentToolCancelled", Arguments.createMap().apply { putString("requestId", id) })
    }
}
