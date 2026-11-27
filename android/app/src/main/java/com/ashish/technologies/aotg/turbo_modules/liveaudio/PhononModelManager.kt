package com.ashish.technologies.aotg.turbo_modules.liveaudio

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.coroutineContext

/**
 * Manages on-demand downloading, storage, verification, and deletion of
 * `ai-ecoverse/phonon-31m-en-ONNX` (Apache-2.0) inside app-private filesDir so
 * weights are never bundled in the APK and require zero storage permissions.
 */
internal class PhononModelManager(private val context: Context) {

    data class VoiceSpec(
        val id: String,
        val label: String,
        val description: String,
    )

    data class DownloadProgress(
        val status: String, // "idle" | "downloading" | "ready" | "cancelled" | "error"
        val percent: Int,
        val downloadedBytes: Long,
        val totalBytes: Long,
        val currentFile: String? = null,
        val error: String? = null,
    )

    data class StatusSnapshot(
        val isInstalled: Boolean,
        val installedVariant: String?,
        val downloadedBytes: Long,
        val expectedTotalBytes: Long,
        val downloadedVoices: List<String>,
        val modelDirPath: String,
    )

    private data class RemoteArtifact(
        val relativePath: String,
        val expectedBytes: Long,
        val minValidBytes: Long,
    )

    private val downloadInProgress = AtomicBoolean(false)
    private val cancelRequested = AtomicBoolean(false)
    private val activeConnection = AtomicReference<HttpURLConnection?>(null)

    private val modelRootDir: File
        get() = File(context.filesDir, MODEL_DIR_RELATIVE)

    fun isDownloading(): Boolean = downloadInProgress.get()

    fun cancelDownload() {
        cancelRequested.set(true)
        try {
            activeConnection.getAndSet(null)?.disconnect()
        } catch (_: Throwable) {
        }
    }

    fun getRootDirectory(): File = modelRootDir

    fun getConfigFile(): File = File(modelRootDir, "config.json")

    fun getTokenizerFile(): File = File(modelRootDir, "tokenizer.json")

    fun getTextConditionerFile(): File = File(modelRootDir, "onnx/text_conditioner.onnx")

    fun getMimiDecoderFile(): File = File(modelRootDir, "onnx/mimi_decoder.onnx")

    fun getVoiceFile(voiceId: String): File {
        val safeId = sanitizeVoiceId(voiceId)
        return File(modelRootDir, "voices/$safeId.bin")
    }

    fun isVoiceDownloaded(voiceId: String): Boolean {
        val file = getVoiceFile(voiceId)
        val len = file.length()
        return file.isFile && len >= MIN_VOICE_BYTES && (len % VOICE_FRAME_BYTES) == 0L
    }

    fun getFlowMainFile(variant: String? = null): File {
        val v = variant ?: getInstalledVariant() ?: VARIANT_Q4
        val rel = if (v == VARIANT_FP32) "onnx/flow_lm_main.onnx" else "onnx/flow_lm_main_q4.onnx"
        return File(modelRootDir, rel)
    }

    fun getFlowStepFile(variant: String? = null): File {
        val v = variant ?: getInstalledVariant() ?: VARIANT_Q4
        val rel = if (v == VARIANT_FP32) "onnx/flow_lm_flow.onnx" else "onnx/flow_lm_flow_q4.onnx"
        return File(modelRootDir, rel)
    }

    fun getInstalledVariant(): String? {
        if (!hasCoreSharedFiles()) return null
        if (hasVariantFiles(VARIANT_Q4)) return VARIANT_Q4
        if (hasVariantFiles(VARIANT_FP32)) return VARIANT_FP32
        return null
    }

    fun isCoreInstalled(): Boolean = getInstalledVariant() != null

    fun isReadyForVoice(voiceId: String = DEFAULT_VOICE_ID): Boolean {
        if (!isCoreInstalled()) return false
        return isVoiceDownloaded(voiceId) || getDownloadedVoiceIds().isNotEmpty()
    }

    fun getDownloadedVoiceIds(): List<String> {
        val voicesDir = File(modelRootDir, "voices")
        if (!voicesDir.isDirectory) return emptyList()
        val curatedOrder = CURATED_VOICES.map { it.id }
        val present = voicesDir.listFiles()
            ?.asSequence()
            ?.filter { it.isFile && it.name.endsWith(".bin") && it.length() >= MIN_VOICE_BYTES && (it.length() % VOICE_FRAME_BYTES) == 0L }
            ?.map { it.name.removeSuffix(".bin") }
            ?.toList()
            ?: emptyList()
        return present.sortedBy { id ->
            val idx = curatedOrder.indexOf(id)
            if (idx >= 0) idx else Int.MAX_VALUE
        }
    }

    fun getExpectedTotalBytes(variant: String = VARIANT_Q4, voiceCount: Int = 1): Long {
        val artifacts = buildArtifactsForVariant(variant)
        return artifacts.sumOf { it.expectedBytes } + voiceCount.coerceAtLeast(0) * VOICE_FILE_BYTES
    }

    fun getBytesOnDisk(): Long {
        if (!modelRootDir.exists()) return 0L
        return walkDirectoryBytes(modelRootDir)
    }

    fun getStatusSnapshot(): StatusSnapshot {
        val variant = getInstalledVariant()
        val downloadedVoices = getDownloadedVoiceIds()
        return StatusSnapshot(
            isInstalled = variant != null && downloadedVoices.isNotEmpty(),
            installedVariant = variant,
            downloadedBytes = getBytesOnDisk(),
            expectedTotalBytes = getExpectedTotalBytes(variant ?: VARIANT_Q4, 1),
            downloadedVoices = downloadedVoices,
            modelDirPath = modelRootDir.absolutePath,
        )
    }

    suspend fun downloadModel(
        variant: String = VARIANT_Q4,
        initialVoiceId: String = DEFAULT_VOICE_ID,
        onProgress: (DownloadProgress) -> Unit,
    ): Boolean = withContext(Dispatchers.IO) {
        if (!downloadInProgress.compareAndSet(false, true)) {
            onProgress(
                DownloadProgress(
                    status = "error",
                    percent = 0,
                    downloadedBytes = 0L,
                    totalBytes = getExpectedTotalBytes(variant, 1),
                    error = "Phonon-31M download already in progress.",
                ),
            )
            return@withContext false
        }

        cancelRequested.set(false)
        val normalizedVariant = if (variant == VARIANT_FP32) VARIANT_FP32 else VARIANT_Q4
        val normalizedVoice = sanitizeVoiceId(initialVoiceId)

        val artifacts = buildArtifactsForVariant(normalizedVariant) + RemoteArtifact(
            relativePath = "voices/$normalizedVoice.bin",
            expectedBytes = VOICE_FILE_BYTES,
            minValidBytes = MIN_VOICE_BYTES,
        )
        val totalBytes = artifacts.sumOf { it.expectedBytes }

        var completedBeforeCurrent = 0L
        var lastEmitMs = 0L
        var lastEmitPercent = -1

        try {
            if (!modelRootDir.exists() && !modelRootDir.mkdirs()) {
                throw IOException("Failed to create model directory: ${modelRootDir.absolutePath}")
            }

            onProgress(
                DownloadProgress(
                    status = "downloading",
                    percent = 0,
                    downloadedBytes = 0L,
                    totalBytes = totalBytes,
                    currentFile = artifacts.firstOrNull()?.relativePath,
                ),
            )

            for (artifact in artifacts) {
                coroutineContext.ensureActive()
                if (cancelRequested.get()) {
                    throw CancellationException("Download cancelled by user.")
                }

                val targetFile = File(modelRootDir, artifact.relativePath)
                if (isArtifactValid(targetFile, artifact.minValidBytes)) {
                    completedBeforeCurrent += artifact.expectedBytes
                    val pct = ((completedBeforeCurrent * 100L) / totalBytes.coerceAtLeast(1L)).toInt().coerceIn(0, 99)
                    onProgress(
                        DownloadProgress(
                            status = "downloading",
                            percent = pct,
                            downloadedBytes = completedBeforeCurrent,
                            totalBytes = totalBytes,
                            currentFile = artifact.relativePath,
                        ),
                    )
                    continue
                }

                val urlString = BASE_RESOLVE_URL + artifact.relativePath
                val bytesWritten = downloadSingleFile(
                    urlString = urlString,
                    targetFile = targetFile,
                    minValidBytes = artifact.minValidBytes,
                    onBytes = { fileDownloaded, _ ->
                        val overall = (completedBeforeCurrent + fileDownloaded).coerceAtMost(totalBytes)
                        val pct = ((overall * 100L) / totalBytes.coerceAtLeast(1L)).toInt().coerceIn(0, 99)
                        val now = System.currentTimeMillis()
                        if (pct != lastEmitPercent || (now - lastEmitMs) >= 180L) {
                            lastEmitPercent = pct
                            lastEmitMs = now
                            onProgress(
                                DownloadProgress(
                                    status = "downloading",
                                    percent = pct,
                                    downloadedBytes = overall,
                                    totalBytes = totalBytes,
                                    currentFile = artifact.relativePath,
                                ),
                            )
                        }
                    },
                )
                completedBeforeCurrent += maxOf(artifact.expectedBytes, bytesWritten)
            }

            onProgress(
                DownloadProgress(
                    status = "ready",
                    percent = 100,
                    downloadedBytes = totalBytes,
                    totalBytes = totalBytes,
                    currentFile = null,
                ),
            )
            true
        } catch (_: CancellationException) {
            onProgress(
                DownloadProgress(
                    status = "cancelled",
                    percent = 0,
                    downloadedBytes = 0L,
                    totalBytes = totalBytes,
                    error = "Download cancelled.",
                ),
            )
            false
        } catch (t: Throwable) {
            if (cancelRequested.get()) {
                onProgress(
                    DownloadProgress(
                        status = "cancelled",
                        percent = 0,
                        downloadedBytes = 0L,
                        totalBytes = totalBytes,
                        error = "Download cancelled.",
                    ),
                )
            } else {
                Log.e(TAG, "Phonon-31M download failed", t)
                onProgress(
                    DownloadProgress(
                        status = "error",
                        percent = 0,
                        downloadedBytes = 0L,
                        totalBytes = totalBytes,
                        error = t.message ?: "Failed to download Phonon-31M TTS model.",
                    ),
                )
            }
            false
        } finally {
            activeConnection.set(null)
            downloadInProgress.set(false)
            cancelRequested.set(false)
        }
    }

    suspend fun ensureVoiceDownloaded(voiceId: String): Boolean = withContext(Dispatchers.IO) {
        val safeId = sanitizeVoiceId(voiceId)
        val target = getVoiceFile(safeId)
        if (isVoiceDownloaded(safeId)) return@withContext true

        try {
            val urlString = "${BASE_RESOLVE_URL}voices/$safeId.bin"
            downloadSingleFile(
                urlString = urlString,
                targetFile = target,
                minValidBytes = MIN_VOICE_BYTES,
                onBytes = { _, _ -> },
            )
            isVoiceDownloaded(safeId)
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to download voice '$safeId'", t)
            false
        } finally {
            activeConnection.set(null)
        }
    }

    fun deleteModel(): Boolean {
        cancelDownload()
        return try {
            if (!modelRootDir.exists()) return true
            modelRootDir.deleteRecursively()
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to delete Phonon model directory", t)
            false
        }
    }

    private fun hasCoreSharedFiles(): Boolean {
        val config = getConfigFile()
        val tokenizer = getTokenizerFile()
        val textCond = getTextConditionerFile()
        val mimi = getMimiDecoderFile()
        return isArtifactValid(config, 1_000L) &&
            isArtifactValid(tokenizer, 50_000L) &&
            isArtifactValid(textCond, 1_000_000L) &&
            isArtifactValid(mimi, 10_000_000L)
    }

    private fun hasVariantFiles(variant: String): Boolean {
        return isArtifactValid(getFlowMainFile(variant), 1_000_000L) &&
            isArtifactValid(getFlowStepFile(variant), 1_000_000L)
    }

    private fun isArtifactValid(file: File, minBytes: Long): Boolean {
        return file.isFile && file.length() >= minBytes
    }

    private fun buildArtifactsForVariant(variant: String): List<RemoteArtifact> {
        val flowMain = if (variant == VARIANT_FP32) {
            RemoteArtifact("onnx/flow_lm_main.onnx", 75_640_448L, 10_000_000L)
        } else {
            RemoteArtifact("onnx/flow_lm_main_q4.onnx", 11_942_080L, 1_000_000L)
        }
        val flowStep = if (variant == VARIANT_FP32) {
            RemoteArtifact("onnx/flow_lm_flow.onnx", 38_344_551L, 5_000_000L)
        } else {
            RemoteArtifact("onnx/flow_lm_flow_q4.onnx", 6_332_829L, 1_000_000L)
        }
        return listOf(
            RemoteArtifact("config.json", 13_636L, 1_000L),
            RemoteArtifact("tokenizer.json", 277_967L, 50_000L),
            RemoteArtifact("onnx/text_conditioner.onnx", 8_462_330L, 1_000_000L),
            flowMain,
            flowStep,
            RemoteArtifact("onnx/mimi_decoder.onnx", 41_277_021L, 10_000_000L),
        )
    }

    private fun downloadSingleFile(
        urlString: String,
        targetFile: File,
        minValidBytes: Long,
        onBytes: (downloaded: Long, totalForFile: Long) -> Unit,
    ): Long {
        targetFile.parentFile?.let { parent ->
            if (!parent.exists() && !parent.mkdirs()) {
                throw IOException("Unable to create directory: ${parent.absolutePath}")
            }
        }

        val tmpFile = File(targetFile.parentFile, "${targetFile.name}.tmp")
        if (tmpFile.exists()) {
            tmpFile.delete()
        }

        val conn = openConnectionWithRedirects(urlString)
        activeConnection.set(conn)

        return try {
            val code = conn.responseCode
            if (code !in 200..299) {
                throw IOException("HTTP $code while fetching $urlString")
            }

            val contentLength = conn.contentLengthLong
            var downloaded = 0L
            val buffer = ByteArray(16 * 1024)

            BufferedInputStream(conn.inputStream, 32 * 1024).use { input ->
                FileOutputStream(tmpFile).use { output ->
                    while (true) {
                        if (cancelRequested.get()) {
                            throw CancellationException("Download cancelled.")
                        }
                        val read = input.read(buffer)
                        if (read == -1) break
                        output.write(buffer, 0, read)
                        downloaded += read
                        onBytes(downloaded, contentLength)
                    }
                    output.flush()
                }
            }

            if (cancelRequested.get()) {
                throw CancellationException("Download cancelled.")
            }

            if (contentLength > 0L && downloaded != contentLength) {
                throw IOException("Incomplete download for ${targetFile.name}: $downloaded / $contentLength bytes")
            }
            if (downloaded < minValidBytes) {
                throw IOException("Downloaded file ${targetFile.name} is unexpectedly small ($downloaded bytes)")
            }

            if (targetFile.exists() && !targetFile.delete()) {
                throw IOException("Could not replace existing file ${targetFile.absolutePath}")
            }
            if (!tmpFile.renameTo(targetFile)) {
                throw IOException("Failed to finalize ${targetFile.name}")
            }
            downloaded
        } catch (t: Throwable) {
            try {
                if (tmpFile.exists()) tmpFile.delete()
            } catch (_: Throwable) {
            }
            throw t
        } finally {
            try {
                conn.disconnect()
            } catch (_: Throwable) {
            }
        }
    }

    private fun openConnectionWithRedirects(initialUrl: String): HttpURLConnection {
        var currentUrl = initialUrl
        var redirects = 0
        while (redirects < MAX_REDIRECTS) {
            if (cancelRequested.get()) {
                throw CancellationException("Download cancelled.")
            }
            val url = URL(currentUrl)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 20_000
                readTimeout = 30_000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "AOTG-Android/1.0")
            }
            val status = conn.responseCode
            if (status in listOf(
                    HttpURLConnection.HTTP_MOVED_PERM,
                    HttpURLConnection.HTTP_MOVED_TEMP,
                    HttpURLConnection.HTTP_SEE_OTHER,
                    307,
                    308,
                )
            ) {
                val location = conn.getHeaderField("Location")
                conn.disconnect()
                if (location.isNullOrBlank()) {
                    throw IOException("Redirect without Location header from $currentUrl")
                }
                currentUrl = URL(url, location).toString()
                redirects++
                continue
            }
            return conn
        }
        throw IOException("Too many redirects while fetching $initialUrl")
    }

    private fun walkDirectoryBytes(dir: File): Long {
        var sum = 0L
        val files = dir.listFiles() ?: return 0L
        for (f in files) {
            sum += if (f.isDirectory) {
                walkDirectoryBytes(f)
            } else if (!f.name.endsWith(".tmp")) {
                f.length()
            } else {
                0L
            }
        }
        return sum
    }

    companion object {
        private const val TAG = "PhononModelManager"
        private const val MODEL_DIR_RELATIVE = "models/phonon-31m-en"
        private const val BASE_RESOLVE_URL = "https://huggingface.co/ai-ecoverse/phonon-31m-en-ONNX/resolve/main/"
        private const val MAX_REDIRECTS = 10

        const val VARIANT_Q4 = "q4"
        const val VARIANT_FP32 = "fp32"
        const val DEFAULT_VOICE_ID = "easton"
        private const val VOICE_FRAME_BYTES = 512L * 4L
        private const val VOICE_FILE_BYTES = 125L * VOICE_FRAME_BYTES
        private const val MIN_VOICE_BYTES = VOICE_FRAME_BYTES

        val CURATED_VOICES: List<VoiceSpec> = listOf(
            VoiceSpec("easton", "Easton", "Warm & clear"),
            VoiceSpec("juniper", "Juniper", "Bright & friendly"),
            VoiceSpec("zoey", "Zoey", "Crisp & expressive"),
            VoiceSpec("harper", "Harper", "Calm narrator"),
            VoiceSpec("micah", "Micah", "Steady & natural"),
            VoiceSpec("freya", "Freya", "Soft conversational"),
            VoiceSpec("alfie", "Alfie", "Upbeat & brisk"),
            VoiceSpec("delia", "Delia", "Balanced & studio"),
        )

        fun sanitizeVoiceId(raw: String?): String {
            val cleaned = raw?.trim()?.lowercase()?.replace(Regex("[^a-z0-9_-]"), "").orEmpty()
            return if (cleaned.isNotEmpty()) cleaned else DEFAULT_VOICE_ID
        }
    }
}
