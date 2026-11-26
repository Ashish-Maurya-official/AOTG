package com.ashish.technologies.aotg.turbo_modules.llm

import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.ashish.technologies.aotg.NativeLLMSpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.ThinkingConfig
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class LLMModule(
    private val reactContext: ReactApplicationContext
) : NativeLLMSpec(reactContext) {

    companion object {
        const val NAME = "LLM"
        private const val TAG = "LLMModule"

        /**
         * Hard cap on the KV-cache (prompt + response tokens) per conversation.
         * Bounds native memory and lets JS reason about remaining context budget.
         */
        private const val MAX_NUM_TOKENS = 4096

        /** How long to wait for native inference to wind down after cancelProcess(). */
        private const val STOP_TIMEOUT_MS = 8000L

        // Event Names
        const val EVENT_ON_TOKEN = "onToken"
        const val EVENT_ON_GENERATION_COMPLETE = "onGenerationComplete"
        const val EVENT_ON_GENERATION_ERROR = "onGenerationError"
        const val EVENT_ON_GENERATION_STOPPED = "onGenerationStopped"
        const val EVENT_ON_MODEL_LOADED = "onModelLoaded"

        // Download Events
        const val EVENT_ON_DOWNLOAD_PROGRESS = "onDownloadProgress"
        const val EVENT_ON_DOWNLOAD_COMPLETE = "onDownloadComplete"
        const val EVENT_ON_DOWNLOAD_ERROR = "onDownloadError"
        const val EVENT_ON_DOWNLOAD_CANCELLED = "onDownloadCancelled"

        @Volatile
        internal var activeInstance: LLMModule? = null
            private set
    }

    internal data class LiveTurnMessage(
        val role: String,
        val text: String
    )

    internal interface LiveGenerationListener {
        fun onChunk(chunk: String)
        fun onComplete(fullText: String)
        fun onError(message: String)
        fun onCancelled(partialText: String)
    }

    internal data class LivePrepareResult(
        val ready: Boolean,
        val hasAudioBackend: Boolean,
        val backend: String,
        val maxTokens: Int
    )

    private data class LiveConversationSpec(
        val systemInstruction: String?,
        val initialMessages: List<LiveTurnMessage>,
        val disableThinking: Boolean
    )

    private val executor: ExecutorService = Executors.newCachedThreadPool()
    private val actorExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "AOTG-EngineActor").apply { isDaemon = true }
    }
    private val actorDispatcher: CoroutineDispatcher = actorExecutor.asCoroutineDispatcher()
    private val coroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val mainHandler = Handler(Looper.getMainLooper())

    init {
        activeInstance = this
    }

    /**
     * One in-flight generation. Each run owns its own stop flag + buffer so a
     * stopped run that is still winding down natively can never leak tokens
     * into the next run.
     */
    private class GenerationSession(
        val isLiveTurn: Boolean = false
    ) {
        val stop = AtomicBoolean(false)
        val pendingStart = AtomicBoolean(true)
        val text = StringBuilder()
        var job: Job? = null
    }

    @Volatile private var currentSession: GenerationSession? = null

    // Real LiteRT-LM engine
    @Volatile private var engine: Engine? = null
    @Volatile private var conversation: Conversation? = null

    /** Serializes every engine & conversation lifecycle operation via the Engine Actor. */
    private val lifecycleMutex = Mutex()
    private val isInitializing = AtomicBoolean(false)
    @Volatile private var conversationNeedsReset: Boolean = false
    @Volatile private var activeLiveConversationSpec: LiveConversationSpec? = null

    // Active Downloads tracker: modelId -> cancellation flag
    private val activeDownloads = ConcurrentHashMap<String, AtomicBoolean>()

    @Volatile private var isLoaded: Boolean = false
    @Volatile private var currentModelPath: String? = null
    private var currentBackend: String = "AUTO"
    private var currentBackendChain: List<String> = listOf("GPU", "CPU")
    @Volatile private var activeBackend: String = "CPU"
    @Volatile private var activeMaxTokens: Int = MAX_NUM_TOKENS
    @Volatile private var activeIsVision: Boolean = false
    @Volatile private var activeIsAudio: Boolean = false
    @Volatile private var requestedIsVision: Boolean = false
    @Volatile private var requestedIsAudio: Boolean = false
    @Volatile private var audioFallbackExhausted: Boolean = false
    private var listenerCount = 0

    /** True while a generation job is alive or scheduled (including post-stop wind-down). */
    private fun isGenerationActive(): Boolean {
        val s = currentSession ?: return false
        return s.pendingStart.get() || s.job?.isActive == true
    }

    /** True while a generation is running and has NOT been asked to stop. */
    private fun isGenerationBusy(): Boolean {
        val s = currentSession ?: return false
        return (s.pendingStart.get() || s.job?.isActive == true) && !s.stop.get()
    }

    private fun cancelProcessSafely(conv: Conversation?) {
        if (conv == null) return
        try {
            if (conv.isAlive) conv.cancelProcess()
        } catch (t: Throwable) {
            Log.w(TAG, "cancelProcess failed: ${t.message}")
        }
    }

    private fun createConfiguredConversation(
        eng: Engine,
        spec: LiveConversationSpec?
    ): Conversation {
        if (spec == null) {
            return eng.createConversation()
        }
        val extraSystem = spec.initialMessages
            .filter { it.role.equals("system", ignoreCase = true) }
            .mapNotNull { it.text.trim().takeIf { s -> s.isNotEmpty() } }
        val combinedSystem = listOfNotNull(
            spec.systemInstruction?.trim()?.takeIf { it.isNotEmpty() },
            *extraSystem.toTypedArray()
        ).joinToString("\n\n").trim()
        val sysContents = combinedSystem
            .takeIf { it.isNotEmpty() }
            ?.let { Contents.of(Content.Text(it)) }
        val seedMessages = spec.initialMessages.mapNotNull { turn ->
            val cleanText = turn.text.trim()
            if (cleanText.isEmpty()) return@mapNotNull null
            when (turn.role.lowercase()) {
                "assistant", "model" -> Message.model(cleanText)
                "system" -> null
                else -> Message.user(cleanText)
            }
        }
        val sampler = SamplerConfig(topK = 40, topP = 0.95, temperature = 0.7)
        val primaryConfig = ConversationConfig(
            systemInstruction = sysContents,
            initialMessages = seedMessages,
            samplerConfig = sampler,
            thinkingConfig = if (spec.disableThinking) {
                ThinkingConfig(enableThinking = false, thinkingTokenBudget = 0)
            } else {
                null
            }
        )
        return try {
            eng.createConversation(primaryConfig)
        } catch (t: Throwable) {
            if (spec.disableThinking) {
                Log.w(TAG, "createConversation with ThinkingConfig failed, retrying without: ${t.message}")
                eng.createConversation(
                    ConversationConfig(
                        systemInstruction = sysContents,
                        initialMessages = seedMessages,
                        samplerConfig = sampler
                    )
                )
            } else {
                throw t
            }
        }
    }

    /**
     * Strictly awaits any running/stopped generation job's completion (`job.join()`)
     * before closing and recreating the [Conversation] at most ONCE. Must be
     * called with [lifecycleMutex] held on the Engine Actor.
     */
    private suspend fun awaitSessionAndRecreateLocked(
        targetSession: GenerationSession?,
        overrideSpec: LiveConversationSpec? = null,
        clearSpecToDefault: Boolean = false,
        resetIfCancelled: Boolean = true
    ): Boolean {
        var finished = true
        val job = targetSession?.job
        if (targetSession != null && job != null && job.isActive) {
            targetSession.stop.set(true)
            conversationNeedsReset = true
            finished = false
            for (attempt in 1..2) {
                cancelProcessSafely(conversation)
                if (withTimeoutOrNull(STOP_TIMEOUT_MS / 2) { job.join() } != null) {
                    finished = true
                    break
                }
            }
            if (!finished) {
                Log.w(TAG, "Generation did not stop within ${STOP_TIMEOUT_MS}ms — force-cancelling job")
                job.cancel()
                withTimeoutOrNull(1000L) { job.join() }
            }
        } else if (targetSession?.stop?.get() == true) {
            conversationNeedsReset = true
        }

        if (clearSpecToDefault) {
            activeLiveConversationSpec = null
        }

        val eng = engine
        val shouldRecreate =
            eng != null &&
                eng.isInitialized() &&
                isLoaded &&
                ((resetIfCancelled && conversationNeedsReset) || overrideSpec != null || clearSpecToDefault)

        if (shouldRecreate && eng != null) {
            val specToApply = if (clearSpecToDefault) null else (overrideSpec ?: activeLiveConversationSpec)
            closeConversationSafely()
            conversation = createConfiguredConversation(eng, specToApply)
            if (overrideSpec != null) {
                activeLiveConversationSpec = overrideSpec
            }
            conversationNeedsReset = false
        }

        if (targetSession != null && currentSession === targetSession && targetSession.job?.isActive != true) {
            currentSession = null
        }
        return finished
    }

    /**
     * Backwards-compatible wrapper used during unload and invalidation.
     */
    private suspend fun stopGenerationAndAwait(timeoutMs: Long = STOP_TIMEOUT_MS): Boolean {
        val session = currentSession ?: return true
        val job = session.job
        if (job == null || !job.isActive) {
            currentSession = null
            return true
        }

        session.stop.set(true)
        conversationNeedsReset = true
        var finished = false
        for (attempt in 1..2) {
            cancelProcessSafely(conversation)
            finished = withTimeoutOrNull(timeoutMs / 2) { job.join() } != null
            if (finished) break
        }
        if (!finished) {
            Log.w(TAG, "Generation did not stop within ${timeoutMs}ms — force-cancelling job")
            job.cancel()
            withTimeoutOrNull(1000L) { job.join() }
        }
        currentSession = null
        return finished
    }

    private fun closeConversationSafely() {
        val conv = conversation
        conversation = null
        if (conv == null) return
        try {
            if (conv.isAlive) conv.close()
        } catch (t: Throwable) {
            Log.w(TAG, "Error closing conversation: ${t.message}")
        }
    }

    private fun closeEngineSafely(target: Engine? = engine) {
        if (target === engine) engine = null
        if (target == null) return
        try {
            if (target.isInitialized()) target.close()
        } catch (t: Throwable) {
            Log.w(TAG, "Error closing engine: ${t.message}")
        }
    }

    /**
     * Releases conversation + engine independently (a failure in one must never
     * leak the other) and resets all in-memory state. Must be called with the
     * lifecycle mutex held and with no generation running.
     */
    private fun releaseEngineResources() {
        val before = Debug.getNativeHeapAllocatedSize()
        closeConversationSafely()
        closeEngineSafely()
        isLoaded = false
        currentModelPath = null
        activeBackend = "CPU"
        activeMaxTokens = MAX_NUM_TOKENS
        activeIsVision = false
        activeIsAudio = false
        audioFallbackExhausted = false
        conversationNeedsReset = false
        activeLiveConversationSpec = null
        currentSession = null
        val after = Debug.getNativeHeapAllocatedSize()
        Log.i(TAG, "Engine released. Native heap: ${before / 1048576} MB -> ${after / 1048576} MB")
    }

    /** Called by React Native when the module/bridge is torn down (e.g. dev reload). */
    override fun invalidate() {
        if (activeInstance === this) {
            activeInstance = null
        }
        try {
            runBlocking(actorDispatcher) {
                withTimeoutOrNull(4000L) {
                    stopGenerationAndAwait(3000L)
                }
                releaseEngineResources()
            }
        } catch (t: Throwable) {
            Log.w(TAG, "invalidate cleanup failed: ${t.message}")
        }
        coroutineScope.cancel()
        actorExecutor.shutdownNow()
        executor.shutdownNow()
        super.invalidate()
    }

    /**
     * Gets or creates the local models directory
     */
    private fun getModelsDir(): File {
        val dir = File(reactContext.filesDir, "models")
        if (!dir.exists()) {
            dir.mkdirs()
        }
        return dir
    }

    /**
     * Return models directory path
     */
    override fun getModelsDirectory(promise: Promise) {
        promise.resolve(getModelsDir().absolutePath)
    }

    /**
     * Check if a model file exists on disk
     */
    override fun checkModelStatus(fileName: String, promise: Promise) {
        try {
            val file = File(getModelsDir(), fileName)
            val exists = file.exists() && file.length() > 0
            val map = Arguments.createMap().apply {
                putBoolean("isDownloaded", exists)
                putString("localPath", if (exists) file.absolutePath else "")
                putDouble("fileSizeBytes", if (exists) file.length().toDouble() else 0.0)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERR_CHECK_MODEL", e.message, e)
        }
    }

    /**
     * Check if an arbitrary file exists on disk (for validating external model paths).
     */
    override fun checkFileExists(path: String, promise: Promise) {
        try {
            val cleanPath = path.removePrefix("file://").removePrefix("content://")
            val file = File(cleanPath)
            promise.resolve(file.exists() && file.length() > 0)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * Delete a downloaded model file from local storage.
     * If the file backs the currently loaded engine, the engine is unloaded first
     * (serialized with any other lifecycle operation) so we never delete a
     * memory-mapped file under a live engine.
     */
    override fun deleteDownloadedModel(pathOrName: String, promise: Promise) {
        coroutineScope.launch {
            try {
                lifecycleMutex.withLock {
                    if (currentModelPath?.endsWith(pathOrName) == true || currentModelPath == pathOrName) {
                        stopGenerationAndAwait()
                        releaseEngineResources()
                    }

                    val file = if (pathOrName.startsWith("/") || pathOrName.startsWith("file:")) {
                        File(pathOrName.removePrefix("file://"))
                    } else {
                        File(getModelsDir(), pathOrName)
                    }

                    if (file.exists()) {
                        promise.resolve(file.delete())
                    } else {
                        promise.resolve(true)
                    }
                }
            } catch (e: Exception) {
                promise.reject("ERR_DELETE_MODEL", e.message, e)
            }
        }
    }

    /**
     * Import a model file from a content:// URI directly into the models directory.
     * Uses ContentResolver streaming to handle multi-GB files without OOM.
     * Returns the absolute path of the resulting file.
     */
    override fun importModelFile(contentUri: String, fileName: String, promise: Promise) {
        coroutineScope.launch {
            try {
                val uri = android.net.Uri.parse(contentUri)
                
                // Attempt to resolve the real absolute path without copying
                val realPath = UriUtils.getPath(reactContext, uri)
                if (realPath != null) {
                    val file = File(realPath)
                    if (file.exists() && file.canRead()) {
                        Log.i(TAG, "Resolved real path for URI: $realPath")
                        promise.resolve(realPath)
                        return@launch
                    }
                }

                // If we couldn't resolve a readable path, we must copy it to our models dir
                Log.w(TAG, "Could not resolve real path for URI, falling back to copy: $contentUri")
                val targetFile = File(getModelsDir(), fileName)

                if (targetFile.exists() && targetFile.length() > 0) {
                    promise.resolve(targetFile.absolutePath)
                    return@launch
                }

                val tempFile = File(getModelsDir(), "$fileName.importing")

                val contentResolver = reactContext.contentResolver
                val inputStream = contentResolver.openInputStream(uri)
                    ?: throw Exception("Cannot read the selected file. The file picker permission may have expired.")

                inputStream.use { input ->
                    FileOutputStream(tempFile).use { output ->
                        val buffer = ByteArray(8192)
                        var bytesRead: Int
                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            output.write(buffer, 0, bytesRead)
                        }
                        output.flush()
                    }
                }

                if (tempFile.length() == 0L) {
                    tempFile.delete()
                    throw Exception("Import resulted in an empty file. The source file may be corrupted.")
                }

                if (!tempFile.renameTo(targetFile)) {
                    tempFile.delete()
                    throw Exception("Could not finalize the imported file.")
                }

                Log.i(TAG, "Model imported (copied): ${targetFile.absolutePath} (${targetFile.length()} bytes)")
                promise.resolve(targetFile.absolutePath)
            } catch (e: Exception) {
                Log.e(TAG, "importModelFile failed: ${e.message}", e)
                promise.reject("ERR_IMPORT_MODEL", e.message ?: "Import failed", e)
            }
        }
    }

    /**
     * Performs a real HTTP/HTTPS stream download from HuggingFace directly to device storage
     */
    override fun downloadModel(modelId: String, url: String, fileName: String, promise: Promise) {
        val cancelFlag = AtomicBoolean(false)
        activeDownloads[modelId] = cancelFlag

        executor.execute {
            var inputStream: InputStream? = null
            var outputStream: FileOutputStream? = null
            var connection: HttpURLConnection? = null
            val modelsDir = getModelsDir()
            val targetFile = File(modelsDir, fileName)
            val tempFile = File(modelsDir, "$fileName.tmp")

            try {
                Log.d(TAG, "Starting download for model $modelId from $url to ${targetFile.absolutePath}")

                connection = openConnectionWithRedirects(url)
                val responseCode = connection.responseCode

                if (responseCode !in 200..299) {
                    throw Exception("Server returned HTTP $responseCode")
                }

                val contentLength = connection.contentLengthLong
                inputStream = connection.inputStream
                outputStream = FileOutputStream(tempFile)

                val buffer = ByteArray(32768) // 32 KB buffer
                var bytesRead: Int
                var totalBytesRead = 0L
                var lastProgressEmitTime = 0L
                var lastBytesForSpeed = 0L
                var currentSpeedMBs = 0.0

                while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                    if (cancelFlag.get()) {
                        Log.d(TAG, "Download cancelled for $modelId")
                        outputStream.close()
                        if (tempFile.exists()) tempFile.delete()

                        sendEvent(EVENT_ON_DOWNLOAD_CANCELLED, Arguments.createMap().apply {
                            putString("modelId", modelId)
                        })
                        promise.reject("ERR_CANCELLED", "Download was cancelled by user")
                        return@execute
                    }

                    outputStream.write(buffer, 0, bytesRead)
                    totalBytesRead += bytesRead

                    val now = System.currentTimeMillis()
                    if (now - lastProgressEmitTime >= 250) {
                        val timeDiffSec = (now - lastProgressEmitTime) / 1000.0
                        val bytesDiff = totalBytesRead - lastBytesForSpeed
                        if (timeDiffSec > 0) {
                            currentSpeedMBs = (bytesDiff / (1024.0 * 1024.0)) / timeDiffSec
                        }

                        val progressPercent = if (contentLength > 0) {
                            (totalBytesRead.toDouble() / contentLength.toDouble()) * 100.0
                        } else {
                            0.0
                        }

                        val progressMap = Arguments.createMap().apply {
                            putString("modelId", modelId)
                            putDouble("progress", progressPercent)
                            putDouble("bytesDownloaded", totalBytesRead.toDouble())
                            putDouble("totalBytes", contentLength.toDouble())
                            putDouble("speedMBs", currentSpeedMBs)
                        }
                        sendEvent(EVENT_ON_DOWNLOAD_PROGRESS, progressMap)

                        lastProgressEmitTime = now
                        lastBytesForSpeed = totalBytesRead
                    }
                }

                outputStream.flush()
                outputStream.close()
                outputStream = null

                if (targetFile.exists()) {
                    targetFile.delete()
                }
                if (!tempFile.renameTo(targetFile)) {
                    throw Exception("Failed to rename temporary download file to ${targetFile.name}")
                }

                Log.d(TAG, "Download completed successfully: ${targetFile.absolutePath} (${targetFile.length()} bytes)")

                val completeMap = Arguments.createMap().apply {
                    putString("modelId", modelId)
                    putString("localPath", targetFile.absolutePath)
                    putString("fileName", fileName)
                    putDouble("fileSizeBytes", targetFile.length().toDouble())
                }
                sendEvent(EVENT_ON_DOWNLOAD_COMPLETE, completeMap)
                promise.resolve(targetFile.absolutePath)
            } catch (e: Exception) {
                Log.e(TAG, "Error downloading model $modelId: ${e.message}", e)
                try {
                    outputStream?.close()
                } catch (_: Exception) {}
                if (tempFile.exists()) {
                    tempFile.delete()
                }

                val errMap = Arguments.createMap().apply {
                    putString("modelId", modelId)
                    putString("error", e.message ?: "Unknown download error")
                }
                sendEvent(EVENT_ON_DOWNLOAD_ERROR, errMap)
                promise.reject("ERR_DOWNLOAD", "Failed to download model: ${e.message}", e)
            } finally {
                try {
                    inputStream?.close()
                } catch (_: Exception) {}
                connection?.disconnect()
                activeDownloads.remove(modelId)
            }
        }
    }

    /**
     * Helper to follow HTTP 301/302/307/308 redirects
     */
    private fun openConnectionWithRedirects(initialUrl: String): HttpURLConnection {
        var url = initialUrl
        var connection: HttpURLConnection
        var redirects = 0
        val maxRedirects = 10

        while (true) {
            connection = URL(url).openConnection() as HttpURLConnection
            connection.connectTimeout = 30000
            connection.readTimeout = 30000
            connection.instanceFollowRedirects = true
            connection.setRequestProperty("User-Agent", "AOTG-Android-Downloader/1.0")

            val status = connection.responseCode
            if (status == HttpURLConnection.HTTP_MOVED_TEMP ||
                status == HttpURLConnection.HTTP_MOVED_PERM ||
                status == HttpURLConnection.HTTP_SEE_OTHER ||
                status == 307 || status == 308) {

                val newUrl = connection.getHeaderField("Location")
                connection.disconnect()
                if (newUrl == null || redirects >= maxRedirects) {
                    throw Exception("Too many redirects or invalid location header from $initialUrl")
                }
                url = newUrl
                redirects++
            } else {
                break
            }
        }
        return connection
    }

    /**
     * Cancel an ongoing model download
     */
    override fun cancelDownload(modelId: String, promise: Promise) {
        val flag = activeDownloads[modelId]
        if (flag != null) {
            flag.set(true)
            promise.resolve(true)
        } else {
            promise.resolve(false)
        }
    }

    /**
     * Creates a Backend instance from string name
     */
    private fun createBackend(name: String): Backend {
        return when (name.uppercase()) {
            "NPU" -> Backend.NPU(nativeLibraryDir = reactContext.applicationInfo.nativeLibraryDir)
            "GPU" -> Backend.GPU()
            else -> Backend.CPU()
        }
    }

    /**
     * Real LiteRT-LM Initialization with backend fallback.
     *
     * Fallback chains:
     *  - NPU  → NPU, GPU, CPU   (explicit user choice; NPU needs an NPU-compiled model + vendor libs)
     *  - GPU  → GPU, CPU
     *  - CPU  → CPU
     *  - AUTO → GPU, CPU        (catalog models are CPU/GPU builds — an NPU attempt would always fail)
     *
     * Every lifecycle operation is serialized through [lifecycleMutex]; a second
     * load request while one is in flight is rejected with ERR_BUSY instead of
     * racing the native runtime.
     */
    private data class EngineInitOutcome(
        val engine: Engine,
        val backend: String,
        val isVision: Boolean,
        val isAudio: Boolean
    )

    private fun tryInitEnginePass(
        file: File,
        backendChain: List<String>,
        useVision: Boolean,
        useAudio: Boolean,
        effectiveMaxTokens: Int,
        cacheDirPath: String
    ): Pair<EngineInitOutcome?, Throwable?> {
        var lastError: Throwable? = null
        for (targetBackend in backendChain) {
            var eng: Engine? = null
            try {
                Log.d(TAG, "Attempting LiteRT-LM init (backend=$targetBackend, vision=$useVision, audio=$useAudio, cacheDir=$cacheDirPath)...")
                val config = EngineConfig(
                    modelPath = file.absolutePath,
                    backend = createBackend(targetBackend),
                    visionBackend = if (useVision) createBackend(targetBackend) else null,
                    audioBackend = if (useAudio) Backend.CPU() else null,
                    maxNumTokens = effectiveMaxTokens,
                    maxNumImages = if (useVision) 1 else null,
                    cacheDir = cacheDirPath
                )
                eng = Engine(config)
                eng.initialize()
                Log.i(TAG, "Initialized LiteRT-LM on $targetBackend (vision=$useVision, audio=$useAudio)")
                return Pair(EngineInitOutcome(eng, targetBackend, useVision, useAudio), null)
            } catch (t: Throwable) {
                Log.e(TAG, "Backend $targetBackend (vision=$useVision, audio=$useAudio) failed: ${t.message}", t)
                lastError = t
                closeEngineSafely(eng)
            }
        }
        return Pair(null, lastError)
    }

    private fun initializeEngineWithFallbacksLocked(
        file: File,
        backendChain: List<String>,
        wantVision: Boolean,
        wantAudio: Boolean,
        effectiveMaxTokens: Int,
        convSpec: LiveConversationSpec?
    ): EngineInitOutcome {
        val cacheDirPath = reactContext.cacheDir.absolutePath
        var fellBackWithoutAudio = false
        var (outcome, lastError) = tryInitEnginePass(
            file, backendChain, wantVision, wantAudio, effectiveMaxTokens, cacheDirPath
        )

        if (outcome == null && wantAudio) {
            Log.w(TAG, "Initialization failed with audioBackend=CPU. Retrying with audioBackend=null...")
            fellBackWithoutAudio = true
            val retry = tryInitEnginePass(file, backendChain, wantVision, false, effectiveMaxTokens, cacheDirPath)
            outcome = retry.first
            if (retry.second != null) lastError = retry.second
        }

        if (outcome == null && wantVision) {
            Log.w(TAG, "Initialization failed with visionBackend enabled. Retrying in text-only mode...")
            val retry = tryInitEnginePass(file, backendChain, false, false, effectiveMaxTokens, cacheDirPath)
            outcome = retry.first
            if (retry.second != null) lastError = retry.second
        }

        if (outcome == null) {
            val errorDetail = lastError?.message ?: lastError?.javaClass?.simpleName ?: "Unknown error"
            throw Exception("Failed to initialize on backends (${backendChain.joinToString(", ")}): $errorDetail")
        }

        val conv = try {
            createConfiguredConversation(outcome.engine, convSpec)
        } catch (t: Throwable) {
            closeEngineSafely(outcome.engine)
            throw Exception("Engine loaded on ${outcome.backend} but conversation could not be created: ${t.message}", t)
        }

        engine = outcome.engine
        conversation = conv
        currentModelPath = file.absolutePath
        activeBackend = outcome.backend
        activeMaxTokens = effectiveMaxTokens
        activeIsVision = outcome.isVision
        activeIsAudio = outcome.isAudio
        audioFallbackExhausted = fellBackWithoutAudio && !outcome.isAudio
        activeLiveConversationSpec = convSpec
        conversationNeedsReset = false
        isLoaded = true
        return outcome
    }

    override fun initialize(
        modelPath: String,
        backend: String,
        isVision: Boolean,
        isAudio: Boolean,
        maxContextLength: Double,
        promise: Promise
    ) {
        if (!isInitializing.compareAndSet(false, true)) {
            promise.reject("ERR_BUSY", "A model is already being loaded. Please wait for it to finish.")
            return
        }

        coroutineScope.launch(actorDispatcher) {
            try {
                lifecycleMutex.withLock {
                    val file = if (modelPath.startsWith("/") || modelPath.startsWith("file:")) {
                        File(modelPath.removePrefix("file://"))
                    } else {
                        File(getModelsDir(), modelPath)
                    }

                    Log.d(TAG, "Requesting initialization for: ${file.absolutePath} (backend=$backend, isVision=$isVision, isAudio=$isAudio)")

                    if (!file.exists() || file.length() == 0L) {
                        throw Exception("Model file does not exist at ${file.absolutePath}. Please download the model first.")
                    }

                    // Make sure nothing is decoding, then free the previous engine
                    // completely BEFORE allocating the new one (models are 2–4 GB).
                    awaitSessionAndRecreateLocked(
                        targetSession = currentSession,
                        clearSpecToDefault = true,
                        resetIfCancelled = false
                    )
                    releaseEngineResources()

                    val effectiveMaxTokens = if (maxContextLength > 0) {
                        minOf(maxContextLength.toInt(), MAX_NUM_TOKENS)
                    } else {
                        MAX_NUM_TOKENS
                    }
                    Log.i(TAG, "Configuring LiteRT-LM context window: requested=$maxContextLength, effective=$effectiveMaxTokens (capped at $MAX_NUM_TOKENS)")

                    val backendChain = if (backend.contains(",")) {
                        backend.split(",").map { it.trim().uppercase() }.filter { it.isNotEmpty() }
                    } else {
                        when (backend.uppercase()) {
                            "NPU" -> listOf("NPU", "GPU", "CPU")
                            "GPU" -> listOf("GPU", "CPU")
                            "CPU" -> listOf("CPU")
                            else -> listOf("GPU", "CPU")
                        }
                    }

                    currentBackend = backend
                    currentBackendChain = backendChain
                    requestedIsVision = isVision
                    requestedIsAudio = isAudio

                    val outcome = initializeEngineWithFallbacksLocked(
                        file = file,
                        backendChain = backendChain,
                        wantVision = isVision,
                        wantAudio = isAudio,
                        effectiveMaxTokens = effectiveMaxTokens,
                        convSpec = null
                    )

                    val wasFallback = !outcome.backend.equals(backend, ignoreCase = true) && !backend.equals("AUTO", ignoreCase = true)

                    val eventParams = Arguments.createMap().apply {
                        putBoolean("success", true)
                        putString("modelPath", file.absolutePath)
                        putString("requestedBackend", backend)
                        putString("actualBackend", outcome.backend)
                        putBoolean("wasFallback", wasFallback)
                    }

                    val promiseParams = Arguments.createMap().apply {
                        putBoolean("success", true)
                        putString("modelPath", file.absolutePath)
                        putString("requestedBackend", backend)
                        putString("actualBackend", outcome.backend)
                        putBoolean("wasFallback", wasFallback)
                    }

                    Log.i(TAG, "Model loaded. Native heap: ${Debug.getNativeHeapAllocatedSize() / 1048576} MB")
                    sendEvent(EVENT_ON_MODEL_LOADED, eventParams)
                    promise.resolve(promiseParams)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize LiteRT-LM model: ${e.message}", e)
                isLoaded = false
                currentModelPath = null
                promise.reject("ERR_MODEL_INIT", "Initialization failed: ${e.message}", e)
            } finally {
                isInitializing.set(false)
            }
        }
    }

    /**
     * Shared generation runner for text and multimodal prompts.
     *
     * Serializes setup/reset against the Engine Actor ([lifecycleMutex] + [actorDispatcher])
     * so a previous cancelled run's `job.join()` always finishes before recreating
     * [Conversation] once.
     */
    private fun startGenerationInternal(
        needsVisionRestore: Boolean = false,
        buildContents: () -> Contents,
        promise: Promise
    ) {
        if (conversation == null || engine == null || !isLoaded) {
            promise.reject("ERR_NOT_LOADED", "No LiteRT-LM model is currently loaded in memory. Please download and load a model first.")
            return
        }

        if (isInitializing.get()) {
            promise.reject("ERR_BUSY", "A model is currently being loaded. Please wait.")
            return
        }

        if (isGenerationBusy()) {
            promise.reject("ERR_ALREADY_GENERATING", "Model is already generating a response.")
            return
        }

        val previous = currentSession
        val session = GenerationSession(isLiveTurn = false)
        currentSession = session
        promise.resolve(true)

        val job = coroutineScope.launch(actorDispatcher, start = CoroutineStart.LAZY) {
            try {
                var conv: Conversation? = null
                lifecycleMutex.withLock {
                    if (session.stop.get()) {
                        session.pendingStart.set(false)
                        return@withLock
                    }

                    awaitSessionAndRecreateLocked(
                        targetSession = if (previous !== session) previous else null,
                        clearSpecToDefault = activeLiveConversationSpec != null
                    )

                    if (needsVisionRestore && requestedIsVision && !activeIsVision && currentModelPath != null) {
                        val file = File(currentModelPath!!)
                        if (file.exists() && file.length() > 0L) {
                            releaseEngineResources()
                            initializeEngineWithFallbacksLocked(
                                file = file,
                                backendChain = currentBackendChain,
                                wantVision = true,
                                wantAudio = requestedIsAudio,
                                effectiveMaxTokens = activeMaxTokens,
                                convSpec = null
                            )
                        }
                    }

                    session.pendingStart.set(false)
                    if (session.stop.get()) {
                        return@withLock
                    }
                    conv = conversation
                }

                if (session.stop.get()) return@launch

                val activeConv = conv
                if (activeConv == null || !activeConv.isAlive || !isLoaded) {
                    throw IllegalStateException("Model was unloaded before generation could start.")
                }

                Log.d(TAG, "Executing LiteRT-LM inference on backend: $activeBackend")

                activeConv.sendMessageAsync(buildContents()).collect { message ->
                    val chunkText = message.toString()
                    if (session.stop.get() || chunkText.isEmpty()) {
                        return@collect
                    }

                    session.text.append(chunkText)

                    val tokenMap = Arguments.createMap().apply {
                        putString("token", chunkText)
                        putString("text", session.text.toString())
                        putBoolean("isFinished", false)
                    }
                    sendEvent(EVENT_ON_TOKEN, tokenMap)
                }

                if (!session.stop.get()) {
                    sendEvent(EVENT_ON_GENERATION_COMPLETE, Arguments.createMap().apply {
                        putString("fullText", session.text.toString())
                        putBoolean("isFinished", true)
                    })
                }
            } catch (e: CancellationException) {
                Log.d(TAG, "Generation coroutine cancelled")
            } catch (t: Throwable) {
                if (session.stop.get()) {
                    Log.d(TAG, "Ignoring post-stop generation error: ${t.message}")
                } else {
                    Log.e(TAG, "Generation failed: ${t.message}", t)
                    sendEvent(EVENT_ON_GENERATION_ERROR, Arguments.createMap().apply {
                        putString("error", t.message ?: "Unknown LiteRT-LM generation error")
                    })
                }
            } finally {
                session.pendingStart.set(false)
            }
        }
        session.job = job
        job.start()
    }

    /**
     * Real LiteRT-LM Output Generation using streaming conversation
     */
    override fun startGeneration(prompt: String, promise: Promise) {
        startGenerationInternal(buildContents = { Contents.of(Content.Text(prompt)) }, promise = promise)
    }

    /**
     * Multimodal generation — sends a screenshot image + text prompt to a vision-capable
     * LiteRT-LM model (e.g. PaliGemma, Gemma 3n, InternVL3).
     *
     * The [imagePath] must be an absolute path to a JPEG or PNG file on the device.
     * Falls back to text-only generation if the image file is missing.
     */
    override fun startGenerationWithImage(prompt: String, imagePath: String, promise: Promise) {
        startGenerationInternal(needsVisionRestore = true, buildContents = {
            val imageFile = File(imagePath)
            if (imageFile.exists() && imageFile.length() > 0) {
                Log.d(TAG, "Vision inference: using image ${imageFile.absolutePath} (${imageFile.length()} bytes)")
                Contents.of(
                    Content.ImageFile(imageFile.absolutePath),
                    Content.Text(prompt)
                )
            } else {
                Log.w(TAG, "Vision fallback: image not found at $imagePath — using text only")
                Contents.of(Content.Text(prompt))
            }
        }, promise = promise)
    }

    /**
     * Multimodal generation — sends an audio file + text prompt to an audio-capable
     * LiteRT-LM model (e.g. Gemma 4).
     *
     * The [audioPath] must be an absolute path to an audio file (WAV, MP3, etc.) on the device.
     * Falls back to text-only generation if the audio file is missing.
     */
    override fun startGenerationWithAudio(prompt: String, audioPath: String, promise: Promise) {
        startGenerationInternal(buildContents = {
            val audioFile = File(audioPath)
            if (audioFile.exists() && audioFile.length() > 0) {
                Log.d(TAG, "Audio inference: using audio ${audioFile.absolutePath} (${audioFile.length()} bytes)")
                Contents.of(
                    Content.AudioFile(audioFile.absolutePath),
                    Content.Text(prompt)
                )
            } else {
                Log.w(TAG, "Audio fallback: audio not found at $audioPath — using text only")
                Contents.of(Content.Text(prompt))
            }
        }, promise = promise)
    }

    /**
     * Stops the active generation. Signals native cancelProcess() immediately
     * and dispatches `job.join()` + single Conversation recreation on the serialized
     * Engine Actor (eliminating any dual-reset race).
     */
    override fun stopGeneration(promise: Promise) {
        val session = currentSession
        if (session == null || (!session.pendingStart.get() && session.job?.isActive != true) || session.stop.get()) {
            promise.resolve(false)
            return
        }

        session.stop.set(true)
        conversationNeedsReset = true
        cancelProcessSafely(conversation)

        val partial = session.text.toString()
        sendEvent(EVENT_ON_GENERATION_STOPPED, Arguments.createMap().apply {
            putString("reason", "cancelled")
        })
        sendEvent(EVENT_ON_GENERATION_COMPLETE, Arguments.createMap().apply {
            putString("fullText", partial)
            putBoolean("isFinished", true)
        })
        promise.resolve(true)

        coroutineScope.launch(actorDispatcher) {
            lifecycleMutex.withLock {
                if (currentSession === session || conversationNeedsReset) {
                    awaitSessionAndRecreateLocked(if (currentSession === session) session else null)
                    if (currentSession === session) {
                        currentSession = null
                    }
                }
            }
        }
    }

    /**
     * Whether a generation is currently running (and has not been asked to stop).
     */
    override fun isGenerating(promise: Promise) {
        promise.resolve(isGenerationBusy())
    }

    /**
     * Check whether model is currently loaded in memory
     */
    override fun isModelLoaded(promise: Promise) {
        promise.resolve(isLoaded && engine?.isInitialized() == true && conversation?.isAlive == true)
    }

    /**
     * KV-cache usage of the current conversation so JS can shrink the next prompt
     * before the context window overflows.
     */
    override fun getContextUsage(promise: Promise) {
        val conv = conversation
        var tokenCount = 0
        if (conv != null && conv.isAlive && !isGenerationActive()) {
            try {
                tokenCount = conv.getTokenCount()
            } catch (t: Throwable) {
                Log.w(TAG, "getTokenCount failed: ${t.message}")
            }
        }
        promise.resolve(Arguments.createMap().apply {
            putInt("tokenCount", tokenCount)
            putInt("maxTokens", activeMaxTokens)
            putBoolean("isLoaded", isLoaded && conv != null)
        })
    }

    /**
     * Drops the current conversation (and its KV cache) and starts a fresh one on
     * the same engine. Used when the context window is exhausted.
     */
    override fun resetConversation(promise: Promise) {
        coroutineScope.launch(actorDispatcher) {
            try {
                lifecycleMutex.withLock {
                    val eng = engine
                    if (eng == null || !eng.isInitialized() || !isLoaded) {
                        promise.reject("ERR_NOT_LOADED", "No model is loaded.")
                        return@withLock
                    }
                    awaitSessionAndRecreateLocked(
                        targetSession = currentSession,
                        clearSpecToDefault = true
                    )
                    currentSession = null
                    promise.resolve(true)
                }
            } catch (e: Exception) {
                Log.e(TAG, "resetConversation failed: ${e.message}", e)
                promise.reject("ERR_RESET", e.message, e)
            }
        }
    }

    /**
     * Unload model from memory. Idempotent — resolves true if nothing is loaded.
     */
    override fun unloadModel(promise: Promise) {
        coroutineScope.launch(actorDispatcher) {
            try {
                lifecycleMutex.withLock {
                    val stopped = stopGenerationAndAwait()
                    if (!stopped) {
                        Log.w(TAG, "Proceeding with unload after generation stop timeout")
                    }
                    releaseEngineResources()
                    promise.resolve(true)
                }
            } catch (e: Exception) {
                promise.reject("ERR_UNLOAD", e.message, e)
            }
        }
    }

    // -------------------------------------------------------------------------
    // Live Audio Talk Engine Actor Entry Points (In-Process JNI -> Kotlin)
    // -------------------------------------------------------------------------

    internal fun isModelLoadedSync(): Boolean =
        isLoaded && engine?.isInitialized() == true && conversation?.isAlive == true

    internal fun isAudioBackendEnabled(): Boolean = activeIsAudio

    internal fun getActiveMaxTokens(): Int = activeMaxTokens

    internal fun getLiveContextTokenCount(): Int {
        val conv = conversation
        if (conv == null || !conv.isAlive || isGenerationActive()) return 0
        return try {
            conv.getTokenCount()
        } catch (_: Throwable) {
            0
        }
    }

    /**
     * Prepares the loaded LiteRT-LM engine for Live Talk mode:
     * - Awaits any active generation cleanly.
     * - Disables [visionBackend] (`null`) if currently allocated so Vision encoders
     *   do not exhaust memory alongside Oboe + Silero VAD + TTS, reusing `cacheDir`.
     * - Ensures [audioBackend] is configured when supported.
     * - Builds the initial [Conversation] via [ConversationConfig] (system instruction,
     *   seed history, `ThinkingConfig(false, 0)`).
     */
    internal suspend fun prepareForLiveTalk(
        systemInstruction: String?,
        seedHistory: List<LiveTurnMessage>,
        requireAudioIfSupported: Boolean,
        disableVision: Boolean = true
    ): LivePrepareResult = withContext(actorDispatcher) {
        lifecycleMutex.withLock {
            val eng = engine
            val modelPath = currentModelPath
            if (eng == null || !eng.isInitialized() || !isLoaded || modelPath == null) {
                return@withLock LivePrepareResult(false, false, "", 0)
            }

            awaitSessionAndRecreateLocked(currentSession)
            currentSession = null

            val spec = LiveConversationSpec(
                systemInstruction = systemInstruction,
                initialMessages = seedHistory,
                disableThinking = true
            )

            val needReloadForVision = disableVision && activeIsVision
            val needReloadForAudio =
                requireAudioIfSupported && requestedIsAudio && !activeIsAudio && !audioFallbackExhausted

            if (needReloadForVision || needReloadForAudio) {
                val file = File(modelPath)
                if (file.exists() && file.length() > 0L) {
                    val savedBackendChain = currentBackendChain
                    val savedMaxTokens = activeMaxTokens
                    val savedReqVision = requestedIsVision
                    val savedReqAudio = requestedIsAudio || requireAudioIfSupported

                    releaseEngineResources()
                    requestedIsVision = savedReqVision
                    requestedIsAudio = savedReqAudio

                    initializeEngineWithFallbacksLocked(
                        file = file,
                        backendChain = savedBackendChain,
                        wantVision = !disableVision && savedReqVision,
                        wantAudio = savedReqAudio,
                        effectiveMaxTokens = savedMaxTokens,
                        convSpec = spec
                    )
                    return@withLock LivePrepareResult(
                        ready = true,
                        hasAudioBackend = activeIsAudio,
                        backend = activeBackend,
                        maxTokens = activeMaxTokens
                    )
                }
            }

            closeConversationSafely()
            conversation = createConfiguredConversation(eng, spec)
            activeLiveConversationSpec = spec
            conversationNeedsReset = false
            LivePrepareResult(
                ready = true,
                hasAudioBackend = activeIsAudio,
                backend = activeBackend,
                maxTokens = activeMaxTokens
            )
        }
    }

    /**
     * Signals native cancellation immediately without killing the Kotlin coroutine
     * before [stopAndRebuildLiveConversation] awaits `job.join()`.
     */
    internal fun cancelLiveGenerationNow() {
        currentSession?.let { active ->
            if (active.isLiveTurn) {
                active.stop.set(true)
                conversationNeedsReset = true
                cancelProcessSafely(conversation)
            }
        }
    }

    /**
     * Immediately cancels any in-flight Live Talk inference (`cancelProcess`),
     * strictly awaits `job.join()` on the serialized Engine Actor, and rebuilds
     * [Conversation] once with watermarked shadow history.
     */
    internal suspend fun stopAndRebuildLiveConversation(
        systemInstruction: String?,
        committedHistory: List<LiveTurnMessage>,
        disableThinking: Boolean = true
    ): Boolean {
        currentSession?.let { active ->
            active.stop.set(true)
            conversationNeedsReset = true
            cancelProcessSafely(conversation)
        }
        return withContext(actorDispatcher) {
            lifecycleMutex.withLock {
                val eng = engine
                if (eng == null || !eng.isInitialized() || !isLoaded) {
                    return@withLock false
                }
                val spec = LiveConversationSpec(
                    systemInstruction = systemInstruction,
                    initialMessages = committedHistory,
                    disableThinking = disableThinking
                )
                awaitSessionAndRecreateLocked(
                    targetSession = currentSession,
                    overrideSpec = spec
                )
                currentSession = null
                true
            }
        }
    }

    internal suspend fun endLiveTalkSession() {
        currentSession?.let { active ->
            if (active.isLiveTurn) {
                active.stop.set(true)
                conversationNeedsReset = true
                cancelProcessSafely(conversation)
            }
        }
        withContext(actorDispatcher) {
            lifecycleMutex.withLock {
                if (!isLoaded || engine == null) return@withLock
                awaitSessionAndRecreateLocked(
                    targetSession = if (currentSession?.isLiveTurn == true) currentSession else null,
                    clearSpecToDefault = true
                )
                if (currentSession?.isLiveTurn == true) {
                    currentSession = null
                }
            }
        }
    }

    /**
     * Dispatches an in-RAM 44-byte WAV ByteArray directly to LiteRT-LM on the
     * serialized Engine Actor (zero temporary disk file writes).
     */
    internal fun sendAudioBytesAsync(
        wavBytes: ByteArray,
        prompt: String,
        listener: LiveGenerationListener
    ): Job {
        val contents = if (prompt.isNotBlank()) {
            Contents.of(Content.AudioBytes(wavBytes), Content.Text(prompt))
        } else {
            Contents.of(Content.AudioBytes(wavBytes))
        }
        return startLiveTurnInternal(contents, listener)
    }

    /**
     * Text-turn Live Talk dispatch (used when device OS-ASR transcribes speech
     * for text-only `.litertlm` models).
     */
    internal fun sendLiveTextAsync(
        prompt: String,
        listener: LiveGenerationListener
    ): Job {
        return startLiveTurnInternal(Contents.of(Content.Text(prompt)), listener)
    }

    private fun startLiveTurnInternal(
        contents: Contents,
        listener: LiveGenerationListener
    ): Job {
        val previous = currentSession
        val session = GenerationSession(isLiveTurn = true)
        currentSession = session

        val job = coroutineScope.launch(actorDispatcher, start = CoroutineStart.LAZY) {
            try {
                var conv: Conversation? = null
                lifecycleMutex.withLock {
                    if (session.stop.get()) {
                        session.pendingStart.set(false)
                        return@withLock
                    }
                    awaitSessionAndRecreateLocked(
                        targetSession = if (previous !== session) previous else null
                    )
                    session.pendingStart.set(false)
                    if (session.stop.get()) {
                        return@withLock
                    }
                    conv = conversation
                }

                if (session.stop.get()) {
                    listener.onCancelled(session.text.toString())
                    return@launch
                }

                val activeConv = conv
                if (activeConv == null || !activeConv.isAlive || !isLoaded) {
                    listener.onError("No LiteRT-LM model is currently loaded.")
                    return@launch
                }

                activeConv.sendMessageAsync(contents).collect { message ->
                    if (session.stop.get()) return@collect
                    val chunkText = message.toString()
                    if (chunkText.isEmpty()) return@collect
                    session.text.append(chunkText)
                    listener.onChunk(chunkText)
                }

                if (session.stop.get()) {
                    listener.onCancelled(session.text.toString())
                } else {
                    listener.onComplete(session.text.toString())
                }
            } catch (e: CancellationException) {
                listener.onCancelled(session.text.toString())
            } catch (t: Throwable) {
                if (session.stop.get()) {
                    listener.onCancelled(session.text.toString())
                } else {
                    Log.e(TAG, "Live generation failed: ${t.message}", t)
                    listener.onError(t.message ?: "Unknown LiteRT-LM error")
                }
            } finally {
                session.pendingStart.set(false)
            }
        }
        session.job = job
        job.start()
        return job
    }

    /**
     * Event Listener Support for NativeEventEmitter
     */
    override fun addListener(eventName: String) {
        listenerCount++
    }

    override fun removeListeners(count: Double) {
        listenerCount -= count.toInt()
        if (listenerCount < 0) listenerCount = 0
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        try {
            if (reactContext.hasActiveReactInstance()) {
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit(eventName, params)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error emitting event $eventName: ${e.message}")
        }
    }
}
