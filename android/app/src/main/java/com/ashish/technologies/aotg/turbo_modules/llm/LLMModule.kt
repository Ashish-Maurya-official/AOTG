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
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
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
    }

    private val executor: ExecutorService = Executors.newCachedThreadPool()
    private val coroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * One in-flight generation. Each run owns its own stop flag + buffer so a
     * stopped run that is still winding down natively can never leak tokens
     * into the next run.
     */
    private class GenerationSession {
        val stop = AtomicBoolean(false)
        val text = StringBuilder()
        var job: Job? = null
    }

    @Volatile private var currentSession: GenerationSession? = null

    // Real LiteRT-LM engine
    @Volatile private var engine: Engine? = null
    @Volatile private var conversation: Conversation? = null

    /** Serializes every engine lifecycle operation (load / unload / delete / reset). */
    private val lifecycleMutex = Mutex()
    private val isInitializing = AtomicBoolean(false)

    // Active Downloads tracker: modelId -> cancellation flag
    private val activeDownloads = ConcurrentHashMap<String, AtomicBoolean>()

    @Volatile private var isLoaded: Boolean = false
    @Volatile private var currentModelPath: String? = null
    private var currentBackend: String = "AUTO"
    @Volatile private var activeBackend: String = "CPU"
    private var listenerCount = 0

    /** True while a generation job is alive (including the wind-down after a stop). */
    private fun isGenerationActive(): Boolean = currentSession?.job?.isActive == true

    /** True while a generation is running and has NOT been asked to stop. */
    private fun isGenerationBusy(): Boolean {
        val s = currentSession ?: return false
        return s.job?.isActive == true && !s.stop.get()
    }

    /**
     * Ask the native runtime to stop decoding and wait until the generation job
     * has fully finished. Only after this returns is it safe to close the
     * conversation/engine (closing mid-inference is a native SIGSEGV).
     */
    private suspend fun stopGenerationAndAwait(timeoutMs: Long = STOP_TIMEOUT_MS): Boolean {
        val session = currentSession ?: return true
        val job = session.job
        if (job == null || !job.isActive) return true

        session.stop.set(true)
        var finished = false
        // Two attempts: the first cancelProcess() can land before the native
        // session has started prefill (tiny window) and be missed.
        for (attempt in 1..2) {
            try {
                conversation?.let { if (it.isAlive) it.cancelProcess() }
            } catch (t: Throwable) {
                Log.w(TAG, "cancelProcess failed (attempt $attempt): ${t.message}")
            }
            finished = withTimeoutOrNull(timeoutMs / 2) { job.join() } != null
            if (finished) break
        }
        if (!finished) {
            Log.w(TAG, "Generation did not stop within ${timeoutMs}ms — force-cancelling job")
            job.cancel()
            withTimeoutOrNull(1000L) { job.join() }
        }
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
        currentSession = null
        val after = Debug.getNativeHeapAllocatedSize()
        Log.i(TAG, "Engine released. Native heap: ${before / 1048576} MB -> ${after / 1048576} MB")
    }

    /**
     * Recreates the conversation on the live engine without acquiring the
     * lifecycle mutex. Safe to call from the generation coroutine (which is not
     * inside the mutex) after a cancelProcess() left the conversation in a
     * broken state.
     *
     * If the engine is gone (raced with an unload), this is a no-op.
     */
    private fun resetConversationInternal() {
        val eng = engine
        if (eng == null || !eng.isInitialized() || !isLoaded) return
        try {
            closeConversationSafely()
            conversation = eng.createConversation()
            Log.d(TAG, "Conversation reset after cancelled generation")
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to reset conversation after cancel: ${t.message}")
        }
    }

    /** Called by React Native when the module/bridge is torn down (e.g. dev reload). */
    override fun invalidate() {
        try {
            runBlocking { withTimeoutOrNull(4000L) { stopGenerationAndAwait(3000L) } }
            releaseEngineResources()
        } catch (t: Throwable) {
            Log.w(TAG, "invalidate cleanup failed: ${t.message}")
        }
        coroutineScope.cancel()
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
     * Delete a downloaded model file from local storage.
     * If the file backs the currently loaded engine, the engine is unloaded first
     * (serialized with any other lifecycle operation) so we never delete a
     * memory-mapped file under a live engine.
     */
    override fun deleteDownloadedModel(fileName: String, promise: Promise) {
        coroutineScope.launch {
            try {
                lifecycleMutex.withLock {
                    if (currentModelPath?.endsWith(fileName) == true) {
                        stopGenerationAndAwait()
                        releaseEngineResources()
                    }

                    val file = File(getModelsDir(), fileName)
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
    override fun initialize(modelPath: String, backend: String, promise: Promise) {
        if (!isInitializing.compareAndSet(false, true)) {
            promise.reject("ERR_BUSY", "A model is already being loaded. Please wait for it to finish.")
            return
        }

        coroutineScope.launch {
            try {
                lifecycleMutex.withLock {
                    val file = if (modelPath.startsWith("/") || modelPath.startsWith("file:")) {
                        File(modelPath.removePrefix("file://"))
                    } else {
                        File(getModelsDir(), modelPath)
                    }

                    Log.d(TAG, "Requesting initialization for: ${file.absolutePath} with requested backend: $backend")

                    if (!file.exists() || file.length() == 0L) {
                        throw Exception("Model file does not exist at ${file.absolutePath}. Please download the model first.")
                    }

                    // Make sure nothing is decoding, then free the previous engine
                    // completely BEFORE allocating the new one (models are 2–4 GB).
                    stopGenerationAndAwait()
                    releaseEngineResources()

                    val backendChain = when (backend.uppercase()) {
                        "NPU" -> listOf("NPU", "GPU", "CPU")
                        "GPU" -> listOf("GPU", "CPU")
                        "CPU" -> listOf("CPU")
                        else -> listOf("GPU", "CPU")
                    }

                    var initializedEngine: Engine? = null
                    var successfulBackend: String? = null
                    var lastInitError: Throwable? = null

                    for (targetBackend in backendChain) {
                        var eng: Engine? = null
                        try {
                            Log.d(TAG, "Attempting LiteRT-LM initialization on backend: $targetBackend...")
                            val config = EngineConfig(
                                modelPath = file.absolutePath,
                                backend = createBackend(targetBackend),
                                visionBackend = createBackend(targetBackend),
                                maxNumTokens = MAX_NUM_TOKENS,
                                maxNumImages = 1
                            )
                            eng = Engine(config)
                            eng.initialize()

                            initializedEngine = eng
                            successfulBackend = targetBackend
                            Log.i(TAG, "Successfully initialized LiteRT-LM on $targetBackend!")
                            break
                        } catch (t: Throwable) {
                            Log.e(TAG, "Backend $targetBackend failed: ${t.message}", t)
                            lastInitError = t
                            // Never leak a partially-initialized engine into the next attempt.
                            closeEngineSafely(eng)
                        }
                    }

                    if (initializedEngine == null || successfulBackend == null) {
                        val errorDetail = lastInitError?.message ?: lastInitError?.javaClass?.simpleName ?: "Unknown error"
                        throw Exception("Failed to initialize on backends (${backendChain.joinToString(", ")}): $errorDetail")
                    }

                    val conv = try {
                        initializedEngine.createConversation()
                    } catch (t: Throwable) {
                        closeEngineSafely(initializedEngine)
                        throw Exception("Engine loaded on $successfulBackend but conversation could not be created: ${t.message}", t)
                    }

                    engine = initializedEngine
                    conversation = conv
                    currentModelPath = file.absolutePath
                    currentBackend = backend
                    activeBackend = successfulBackend
                    isLoaded = true

                    val wasFallback = !successfulBackend.equals(backend, ignoreCase = true) && !backend.equals("AUTO", ignoreCase = true)

                    val params = Arguments.createMap().apply {
                        putBoolean("success", true)
                        putString("modelPath", file.absolutePath)
                        putString("requestedBackend", backend)
                        putString("actualBackend", successfulBackend)
                        putBoolean("wasFallback", wasFallback)
                    }

                    Log.i(TAG, "Model loaded. Native heap: ${Debug.getNativeHeapAllocatedSize() / 1048576} MB")
                    sendEvent(EVENT_ON_MODEL_LOADED, params)
                    promise.resolve(params)
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
     * - Rejects if a generation is actively running (not yet asked to stop).
     * - If the previous run was stopped but is still winding down natively, the
     *   new run waits for it to finish first instead of overlapping two decodes.
     * - Each run owns its own [GenerationSession] so late tokens from a stopped
     *   run can never leak into this one.
     */
    private fun startGenerationInternal(buildContents: () -> Contents, promise: Promise) {
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
        val session = GenerationSession()
        currentSession = session
        promise.resolve(true)

        session.job = coroutineScope.launch {
            try {
                // Let a stopped-but-still-decoding previous run finish natively.
                val prevJob = previous?.job
                if (prevJob != null && prevJob.isActive) {
                    val done = withTimeoutOrNull(STOP_TIMEOUT_MS) { prevJob.join() } != null
                    if (!done) {
                        throw IllegalStateException("Previous generation did not stop in time. Please try again.")
                    }
                }

                // After cancelProcess(), the LiteRT-LM conversation can get
                // stuck — sendMessageAsync() hangs silently. Recreate the
                // conversation so the next generation starts clean.
                if (previous?.stop?.get() == true) {
                    resetConversationInternal()
                }

                if (session.stop.get()) return@launch

                val conv = conversation
                if (conv == null || !conv.isAlive || !isLoaded) {
                    throw IllegalStateException("Model was unloaded before generation could start.")
                }

                Log.d(TAG, "Executing LiteRT-LM inference on backend: $activeBackend")

                conv.sendMessageAsync(buildContents()).collect { message ->
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

                // Natural completion. (After a stop, stopGeneration() already
                // emitted the terminal events with the partial text.)
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
                    // Errors surfacing while winding down after cancelProcess() are expected.
                    Log.d(TAG, "Ignoring post-stop generation error: ${t.message}")
                } else {
                    Log.e(TAG, "Generation failed: ${t.message}", t)
                    sendEvent(EVENT_ON_GENERATION_ERROR, Arguments.createMap().apply {
                        putString("error", t.message ?: "Unknown LiteRT-LM generation error")
                    })
                }
            } finally {
                // If this generation was cancelled, proactively reset the
                // conversation so it is in a clean state for the next run
                // (whether or not a new run is already waiting).
                if (session.stop.get()) {
                    resetConversationInternal()
                }
            }
        }
    }

    /**
     * Real LiteRT-LM Output Generation using streaming conversation
     */
    override fun startGeneration(prompt: String, promise: Promise) {
        startGenerationInternal({ Contents.of(Content.Text(prompt)) }, promise)
    }

    /**
     * Multimodal generation — sends a screenshot image + text prompt to a vision-capable
     * LiteRT-LM model (e.g. PaliGemma, Gemma 3n, InternVL3).
     *
     * The [imagePath] must be an absolute path to a JPEG or PNG file on the device.
     * Falls back to text-only generation if the image file is missing.
     */
    override fun startGenerationWithImage(prompt: String, imagePath: String, promise: Promise) {
        startGenerationInternal({
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
        }, promise)
    }

    /**
     * Stops the active generation. Signals the native runtime via cancelProcess()
     * (so it really stops decoding, instead of only cancelling the Kotlin flow)
     * and immediately emits the terminal events with the partial text so any JS
     * caller awaiting generate() resolves.
     */
    override fun stopGeneration(promise: Promise) {
        val session = currentSession
        if (session == null || session.job?.isActive != true || session.stop.get()) {
            promise.resolve(false)
            return
        }

        session.stop.set(true)
        try {
            conversation?.let { if (it.isAlive) it.cancelProcess() }
        } catch (t: Throwable) {
            Log.w(TAG, "cancelProcess failed: ${t.message}")
        }

        val partial = session.text.toString()
        sendEvent(EVENT_ON_GENERATION_STOPPED, Arguments.createMap().apply {
            putString("reason", "cancelled")
        })
        sendEvent(EVENT_ON_GENERATION_COMPLETE, Arguments.createMap().apply {
            putString("fullText", partial)
            putBoolean("isFinished", true)
        })
        promise.resolve(true)
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
            putInt("maxTokens", MAX_NUM_TOKENS)
            putBoolean("isLoaded", isLoaded && conv != null)
        })
    }

    /**
     * Drops the current conversation (and its KV cache) and starts a fresh one on
     * the same engine. Used when the context window is exhausted.
     */
    override fun resetConversation(promise: Promise) {
        coroutineScope.launch {
            try {
                lifecycleMutex.withLock {
                    val eng = engine
                    if (eng == null || !eng.isInitialized() || !isLoaded) {
                        promise.reject("ERR_NOT_LOADED", "No model is loaded.")
                        return@withLock
                    }
                    stopGenerationAndAwait()
                    closeConversationSafely()
                    conversation = eng.createConversation()
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
        coroutineScope.launch {
            try {
                lifecycleMutex.withLock {
                    // Stop decoding first and wait for the native runtime to
                    // actually finish — closing mid-inference is a native crash.
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
        if (reactContext.hasActiveReactInstance()) {
            mainHandler.post {
                try {
                    reactContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        ?.emit(eventName, params)
                } catch (e: Exception) {
                    Log.e(TAG, "Error emitting event $eventName: ${e.message}")
                }
            }
        }
    }
}
