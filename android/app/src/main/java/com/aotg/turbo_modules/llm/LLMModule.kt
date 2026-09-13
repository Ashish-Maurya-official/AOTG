package com.aotg.turbo_modules.llm

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.aotg.NativeLLMSpec
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

class LLMModule(
    private val reactContext: ReactApplicationContext
) : NativeLLMSpec(reactContext) {

    companion object {
        const val NAME = "LLM"
        private const val TAG = "LLMModule"

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
    private val isGenerating = AtomicBoolean(false)
    private val shouldStop = AtomicBoolean(false)

    // Real LiteRT-LM engine
    private var engine: Engine? = null
    private var conversation: Conversation? = null
    private val accumulatedResponse = StringBuilder()

    // Active Downloads tracker: modelId -> cancellation flag
    private val activeDownloads = ConcurrentHashMap<String, AtomicBoolean>()

    private var isLoaded: Boolean = false
    private var currentModelPath: String? = null
    private var currentBackend: String = "AUTO"
    private var activeBackend: String = "CPU"
    private var listenerCount = 0

    // Active generation job for cancellation
    private var generationJob: Job? = null


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
     * Delete a downloaded model file from local storage
     */
    override fun deleteDownloadedModel(fileName: String, promise: Promise) {
        try {
            if (currentModelPath?.endsWith(fileName) == true) {
                try {
                    conversation?.close()
                    engine?.close()
                } catch (_: Exception) {}
                conversation = null
                engine = null
                isLoaded = false
                currentModelPath = null
            }

            val file = File(getModelsDir(), fileName)
            if (file.exists()) {
                val deleted = file.delete()
                promise.resolve(deleted)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("ERR_DELETE_MODEL", e.message, e)
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
     * Real LiteRT-LM Initialization with NPU -> GPU -> CPU Fallback
     */
    override fun initialize(modelPath: String, backend: String, promise: Promise) {
        coroutineScope.launch {
            try {
                val file = if (modelPath.startsWith("/") || modelPath.startsWith("file:")) {
                    File(modelPath.removePrefix("file://"))
                } else {
                    File(getModelsDir(), modelPath)
                }

                Log.d(TAG, "Requesting initialization for: ${file.absolutePath} with requested backend: $backend")

                if (!file.exists() || file.length() == 0L) {
                    throw Exception("Model file does not exist at ${file.absolutePath}. Please download the model first.")
                }

                // Close any existing engine
                try {
                    conversation?.close()
                    engine?.close()
                } catch (e: Exception) {
                    Log.w(TAG, "Error closing previous engine: ${e.message}")
                }
                conversation = null
                engine = null

                // Determine fallback chain based on user preference
                val backendChain = when (backend.uppercase()) {
                    "NPU" -> listOf("NPU", "GPU", "CPU")
                    "GPU" -> listOf("GPU", "CPU")
                    "CPU" -> listOf("CPU")
                    else -> listOf("NPU", "GPU", "CPU") // AUTO: try all backends
                }

                var initializedEngine: Engine? = null
                var successfulBackend: String? = null
                var lastInitError: Throwable? = null

                for (targetBackend in backendChain) {
                    try {
                        Log.d(TAG, "Attempting LiteRT-LM initialization on backend: $targetBackend...")

                        val backendInstance = createBackend(targetBackend)
                        val config = EngineConfig(
                            modelPath = file.absolutePath,
                            backend = backendInstance
                        )

                        val eng = Engine(config)
                        eng.initialize()

                        initializedEngine = eng
                        successfulBackend = targetBackend
                        Log.i(TAG, "Successfully initialized LiteRT-LM on $targetBackend!")
                        break
                    } catch (t: Throwable) {
                        Log.e(TAG, "Backend $targetBackend failed: ${t.message}", t)
                        lastInitError = t
                    }
                }

                if (initializedEngine == null || successfulBackend == null) {
                    val errorDetail = lastInitError?.message ?: lastInitError?.javaClass?.simpleName ?: "Unknown error"
                    throw Exception("Failed to initialize on backends (${backendChain.joinToString(", ")}): $errorDetail")
                }

                engine = initializedEngine
                currentModelPath = file.absolutePath
                currentBackend = backend
                activeBackend = successfulBackend
                isLoaded = true

                // Create initial conversation
                conversation = initializedEngine.createConversation()

                val wasFallback = !successfulBackend.equals(backend, ignoreCase = true) && !backend.equals("AUTO", ignoreCase = true)

                val params = Arguments.createMap().apply {
                    putBoolean("success", true)
                    putString("modelPath", file.absolutePath)
                    putString("requestedBackend", backend)
                    putString("actualBackend", successfulBackend)
                    putBoolean("wasFallback", wasFallback)
                }

                sendEvent(EVENT_ON_MODEL_LOADED, params)
                promise.resolve(params)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize LiteRT-LM model: ${e.message}", e)
                isLoaded = false
                engine = null
                conversation = null
                promise.reject("ERR_MODEL_INIT", "Initialization failed: ${e.message}", e)
            }
        }
    }

    /**
     * Real LiteRT-LM Output Generation using streaming conversation
     */
    override fun startGeneration(prompt: String, promise: Promise) {
        val conv = conversation
        val eng = engine
        if (conv == null || eng == null || !isLoaded) {
            promise.reject("ERR_NOT_LOADED", "No LiteRT-LM model is currently loaded in memory. Please download and load a model first.")
            return
        }

        if (isGenerating.get()) {
            promise.reject("ERR_ALREADY_GENERATING", "Model is already generating a response.")
            return
        }

        isGenerating.set(true)
        shouldStop.set(false)
        accumulatedResponse.setLength(0)
        promise.resolve(true)

        generationJob = coroutineScope.launch {
            try {
                Log.d(TAG, "Executing real LiteRT-LM inference on backend: $activeBackend for prompt: $prompt")

                conv.sendMessageAsync(prompt).collect { message ->
                    val chunkText = message.toString()
                    if (shouldStop.get() || chunkText.isEmpty()) {
                        return@collect
                    }

                    accumulatedResponse.append(chunkText)

                    val tokenMap = Arguments.createMap().apply {
                        putString("token", chunkText)
                        putString("text", accumulatedResponse.toString())
                        putBoolean("isFinished", false)
                    }
                    sendEvent(EVENT_ON_TOKEN, tokenMap)
                }

                // Generation completed
                if (!shouldStop.get()) {
                    val completeMap = Arguments.createMap().apply {
                        putString("fullText", accumulatedResponse.toString())
                        putBoolean("isFinished", true)
                    }
                    sendEvent(EVENT_ON_GENERATION_COMPLETE, completeMap)
                }
                isGenerating.set(false)
            } catch (e: CancellationException) {
                Log.d(TAG, "Generation was cancelled")
                isGenerating.set(false)
            } catch (e: Exception) {
                Log.e(TAG, "Real generation execution failed: ${e.message}", e)
                isGenerating.set(false)
                val errMap = Arguments.createMap().apply {
                    putString("error", e.message ?: "Unknown LiteRT-LM generation error")
                }
                sendEvent(EVENT_ON_GENERATION_ERROR, errMap)
            }
        }
    }

    /**
     * Multimodal generation — sends a screenshot image + text prompt to a vision-capable
     * LiteRT-LM model (e.g. PaliGemma, Gemma 3n, InternVL3).
     *
     * The [imagePath] must be an absolute path to a JPEG or PNG file on the device.
     * Falls back to text-only generation if the image file is missing or the model
     * doesn't support vision.
     */
    override fun startGenerationWithImage(prompt: String, imagePath: String, promise: Promise) {
        val conv = conversation
        val eng = engine
        if (conv == null || eng == null || !isLoaded) {
            promise.reject("ERR_NOT_LOADED", "No LiteRT-LM model loaded. Please load a model first.")
            return
        }

        if (isGenerating.get()) {
            promise.reject("ERR_ALREADY_GENERATING", "Model is already generating a response.")
            return
        }

        isGenerating.set(true)
        shouldStop.set(false)
        accumulatedResponse.setLength(0)
        promise.resolve(true)

        generationJob = coroutineScope.launch {
            try {
                val imageFile = File(imagePath)
                val contents = if (imageFile.exists() && imageFile.length() > 0) {
                    Log.d(TAG, "Vision inference: using image ${imageFile.absolutePath} (${imageFile.length()} bytes)")
                    Contents.of(
                        Content.ImageFile(imageFile.absolutePath),
                        Content.Text(prompt)
                    )
                } else {
                    // Graceful fallback to text-only if image is missing
                    Log.w(TAG, "Vision fallback: image not found at $imagePath — using text only")
                    Contents.of(Content.Text(prompt))
                }

                conv.sendMessageAsync(contents).collect { message ->
                    val chunkText = message.toString()
                    if (shouldStop.get() || chunkText.isEmpty()) return@collect

                    accumulatedResponse.append(chunkText)

                    val tokenMap = Arguments.createMap().apply {
                        putString("token", chunkText)
                        putString("text", accumulatedResponse.toString())
                        putBoolean("isFinished", false)
                    }
                    sendEvent(EVENT_ON_TOKEN, tokenMap)
                }

                if (!shouldStop.get()) {
                    val completeMap = Arguments.createMap().apply {
                        putString("fullText", accumulatedResponse.toString())
                        putBoolean("isFinished", true)
                    }
                    sendEvent(EVENT_ON_GENERATION_COMPLETE, completeMap)
                }
                isGenerating.set(false)
            } catch (e: CancellationException) {
                Log.d(TAG, "Vision generation cancelled")
                isGenerating.set(false)
            } catch (e: Exception) {
                Log.e(TAG, "Vision generation failed: ${e.message}", e)
                isGenerating.set(false)
                val errMap = Arguments.createMap().apply {
                    putString("error", e.message ?: "Unknown vision generation error")
                }
                sendEvent(EVENT_ON_GENERATION_ERROR, errMap)
            }
        }
    }


    override fun stopGeneration(promise: Promise) {
        if (isGenerating.get()) {
            shouldStop.set(true)
            generationJob?.cancel()
            isGenerating.set(false)
            val partial = accumulatedResponse.toString()
            sendEvent(EVENT_ON_GENERATION_STOPPED, Arguments.createMap().apply {
                putString("reason", "cancelled")
            })
            // Emit a final completion carrying whatever text was produced so far.
            // Without this, any JS caller awaiting generate()/generateWithVision()
            // would hang forever after a stop (no complete/error ever arrives).
            sendEvent(EVENT_ON_GENERATION_COMPLETE, Arguments.createMap().apply {
                putString("fullText", partial)
                putBoolean("isFinished", true)
            })
            promise.resolve(true)
        } else {
            promise.resolve(false)
        }
    }

    /**
     * Check whether model is currently loaded in memory
     */
    override fun isModelLoaded(promise: Promise) {
        promise.resolve(isLoaded && engine != null)
    }

    /**
     * Unload model from memory
     */
    override fun unloadModel(promise: Promise) {
        coroutineScope.launch {
            try {
                // Step 1: Signal generation to stop
                shouldStop.set(true)

                // Step 2: Cancel and wait for the generation job to finish
                val job = generationJob
                if (job != null && job.isActive) {
                    job.cancel()
                    try {
                        withTimeout(3000L) {
                            job.join()
                        }
                    } catch (e: TimeoutCancellationException) {
                        Log.w(TAG, "Generation job did not finish within timeout, proceeding with unload")
                    }
                }
                generationJob = null
                isGenerating.set(false)

                // Step 3: Now safe to close resources — generation is fully stopped
                try {
                    conversation?.close()
                    engine?.close()
                } catch (e: Exception) {
                    Log.w(TAG, "Error closing engine: ${e.message}")
                }
                conversation = null
                engine = null
                isLoaded = false
                currentModelPath = null
                promise.resolve(true)
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
