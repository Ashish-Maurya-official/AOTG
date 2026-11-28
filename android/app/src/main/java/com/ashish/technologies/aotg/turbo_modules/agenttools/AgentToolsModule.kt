package com.ashish.technologies.aotg.turbo_modules.agenttools

import com.ashish.technologies.aotg.NativeAgentToolsSpec
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import kotlinx.coroutines.*
import java.util.concurrent.ConcurrentHashMap

class AgentToolsModule(context: ReactApplicationContext) : NativeAgentToolsSpec(context) {
    companion object { const val NAME = "AgentTools" }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val web = PublicWebClient()
    private val rendering = ConcurrentHashMap<String, Job>()
    override fun getName() = NAME

    override fun configure(definitionsJson: String, promise: Promise) {
        try { AgentToolBridge.configure(definitionsJson); promise.resolve(true) }
        catch (error: Exception) { promise.reject("ERR_TOOL_CONFIG", "Invalid tool catalog", error) }
    }

    override fun resolveTool(requestId: String, resultJson: String, promise: Promise) {
        try { promise.resolve(AgentToolBridge.resolve(requestId, resultJson)) }
        catch (error: Exception) { promise.reject("ERR_TOOL_RESULT", "Invalid tool result", error) }
    }

    override fun fetchPage(requestId: String, url: String, promise: Promise) {
        try { web.prepare(requestId) }
        catch (error: Exception) { promise.reject("ERR_WEB_BUSY", "Web reader is busy"); return }
        scope.launch {
            try { promise.resolve(web.fetch(requestId, url)) }
            catch (error: Exception) { promise.reject("ERR_WEB_UNAVAILABLE", "The public page could not be retrieved") }
        }
    }

    override fun cancelFetch(requestId: String, promise: Promise) {
        rendering[requestId]?.cancel()
        web.cancel(requestId)
        promise.resolve(true)
    }

    override fun renderPage(requestId: String, url: String, promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) { promise.reject("ERR_FOREGROUND", "Open the app to render this source"); return }
        val task = scope.launch(start = CoroutineStart.LAZY) {
            try {
                web.prepare(requestId)
                promise.resolve(RenderedPage.read(reactApplicationContext, activity, url, web, requestId))
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                promise.reject("ERR_RENDER", "Could not render this public page")
            }
        }
        rendering[requestId] = task
        task.invokeOnCompletion { error ->
            rendering.remove(requestId, task)
            if (error != null) promise.reject("ERR_RENDER", "Could not render this public page")
        }
        task.start()
    }

    private fun storage(promise: Promise, action: () -> Any) {
        scope.launch {
            try { promise.resolve(action()) }
            catch (error: Exception) { promise.reject("ERR_SOURCES", "Saved source operation failed", error) }
        }
    }
    override fun saveSource(url: String, promise: Promise) = storage(promise) { SaveSourceJob.enqueue(reactApplicationContext, url) }
    override fun searchSources(query: String, promise: Promise) = storage(promise) { SavedSources(reactApplicationContext).use { it.search(query) } }
    override fun sourceStatus(promise: Promise) = storage(promise) { SaveSourceJob.status(reactApplicationContext) }
    override fun clearSources(promise: Promise) = storage(promise) { SaveSourceJob.clear(reactApplicationContext); true }

    override fun addListener(eventName: String) = Unit
    override fun removeListeners(count: Double) = Unit
    override fun invalidate() {
        AgentToolBridge.configure("[]")
        web.close()
        scope.cancel()
        super.invalidate()
    }
}
