package com.ashish.technologies.aotg.turbo_modules.liveaudio

import android.content.Context
import android.util.Log
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream

/**
 * Manages downloadable on-device speech synthesis models (direct ONNX models and
 * `k2-fsa/sherpa-onnx` `.tar.bz2` bundles) under `filesDir/models/tts/<modelId>/`.
 */
internal class SpeechModelManager(private val context: Context) {

    data class SpeechVoiceSpec(
        val id: String,
        val label: String,
        val description: String,
        val language: String,
        val speakerId: Int = 0,
        val perVoiceArchiveUrl: String? = null,
        val perVoiceArchiveBytes: Long = 0L,
    )

    data class DirectFileSpec(
        val relativePath: String,
        val url: String,
        val estimatedBytes: Long,
        val minValidBytes: Long,
    )

    enum class PackageKind {
        DIRECT_FILES,
        TAR_BZ2_SINGLE,
        TAR_BZ2_PER_VOICE,
    }

    data class SpeechModelSpec(
        val id: String,
        val label: String,
        val subtitle: String,
        val engineFamily: String,
        val languages: List<String>,
        val sampleRate: Int,
        val estimatedBytes: Long,
        val packageKind: PackageKind,
        val archiveUrl: String? = null,
        val directFiles: List<DirectFileSpec> = emptyList(),
        val defaultVoiceId: String,
        val voices: List<SpeechVoiceSpec>,
        val supportsHindi: Boolean,
        val supportsEnglish: Boolean,
    )

    data class DownloadProgress(
        val modelId: String,
        val state: String,
        val downloadedBytes: Long,
        val totalBytes: Long,
        val percent: Int,
        val error: String? = null,
    )

    private class ActiveDownload {
        val cancelRequested = AtomicBoolean(false)
        @Volatile var connection: HttpURLConnection? = null
        val downloadedBytes = AtomicLong(0L)
        val totalBytes = AtomicLong(0L)
        val percent = AtomicInteger(0)
    }

    private val activeDownloads = ConcurrentHashMap<String, ActiveDownload>()

    fun getModelsRootDir(): File = File(context.filesDir, ROOT_DIR_RELATIVE)

    fun getModelDir(modelId: String): File = File(getModelsRootDir(), sanitizeModelId(modelId))

    fun getVoiceDir(modelId: String, voiceId: String): File {
        val spec = findSpec(modelId)
        val cleanVoice = resolveVoiceId(modelId, voiceId)
        return if (spec?.packageKind == PackageKind.TAR_BZ2_PER_VOICE) {
            File(getModelDir(modelId), cleanVoice)
        } else {
            getModelDir(modelId)
        }
    }

    fun getAllSpecs(): List<SpeechModelSpec> = CATALOG

    fun findSpec(modelId: String?): SpeechModelSpec? {
        val clean = sanitizeModelId(modelId)
        return CATALOG_BY_ID[clean]
    }

    fun resolveVoiceId(modelId: String, requestedVoiceId: String?): String {
        val spec = findSpec(modelId) ?: return "default"
        val clean = requestedVoiceId?.trim()?.lowercase().orEmpty()
        val match = spec.voices.firstOrNull { it.id == clean }
        return match?.id ?: spec.defaultVoiceId
    }

    fun findVoiceSpec(modelId: String, voiceId: String?): SpeechVoiceSpec? {
        val spec = findSpec(modelId) ?: return null
        val resolved = resolveVoiceId(modelId, voiceId)
        return spec.voices.firstOrNull { it.id == resolved } ?: spec.voices.firstOrNull()
    }

    fun isModelInstalled(modelId: String, voiceId: String? = null): Boolean {
        val spec = findSpec(modelId) ?: return false
        return when (spec.packageKind) {
            PackageKind.DIRECT_FILES -> {
                val root = getModelDir(spec.id)
                spec.directFiles.all { f ->
                    val file = File(root, f.relativePath)
                    file.isFile && file.length() >= f.minValidBytes
                }
            }
            PackageKind.TAR_BZ2_SINGLE -> {
                val root = getModelDir(spec.id)
                isExtractedBundleValid(spec.id, root)
            }
            PackageKind.TAR_BZ2_PER_VOICE -> {
                if (!voiceId.isNullOrBlank()) {
                    val vDir = getVoiceDir(spec.id, voiceId)
                    if (isExtractedBundleValid(spec.id, vDir)) return true
                }
                val root = getModelDir(spec.id)
                spec.voices.any { v -> isExtractedBundleValid(spec.id, File(root, v.id)) }
            }
        }
    }

    fun isVoiceInstalled(modelId: String, voiceId: String): Boolean {
        val spec = findSpec(modelId) ?: return false
        val resolved = resolveVoiceId(spec.id, voiceId)
        return if (spec.packageKind == PackageKind.TAR_BZ2_PER_VOICE) {
            isExtractedBundleValid(spec.id, File(getModelDir(spec.id), resolved))
        } else {
            isModelInstalled(spec.id)
        }
    }

    fun resolveInstalledVoiceId(modelId: String, preferredVoiceId: String?): String? {
        val spec = findSpec(modelId) ?: return null
        val requested = resolveVoiceId(spec.id, preferredVoiceId)
        if (isVoiceInstalled(spec.id, requested)) return requested
        return if (spec.packageKind == PackageKind.TAR_BZ2_PER_VOICE) {
            spec.voices.firstOrNull { isVoiceInstalled(spec.id, it.id) }?.id
        } else if (isModelInstalled(spec.id)) {
            requested
        } else {
            null
        }
    }

    fun getInstalledBytes(modelId: String): Long {
        val dir = getModelDir(modelId)
        if (!dir.exists()) return 0L
        return walkDirectoryBytes(dir)
    }

    fun isDownloading(modelId: String): Boolean = activeDownloads.containsKey(sanitizeModelId(modelId))

    fun getDownloadPercent(modelId: String): Int =
        activeDownloads[sanitizeModelId(modelId)]?.percent?.get() ?: 0

    fun getInstalledVoices(modelId: String): List<String> {
        val spec = findSpec(modelId) ?: return emptyList()
        if (spec.packageKind != PackageKind.TAR_BZ2_PER_VOICE) {
            return if (isModelInstalled(spec.id)) spec.voices.map { it.id } else emptyList()
        }
        val root = getModelDir(spec.id)
        return spec.voices.filter { isExtractedBundleValid(spec.id, File(root, it.id)) }.map { it.id }
    }

    fun cancelDownload(modelId: String? = null) {
        if (modelId.isNullOrBlank()) {
            for ((_, active) in activeDownloads) {
                active.cancelRequested.set(true)
                runCatching { active.connection?.disconnect() }
            }
            return
        }
        val active = activeDownloads[sanitizeModelId(modelId)] ?: return
        active.cancelRequested.set(true)
        runCatching { active.connection?.disconnect() }
    }

    fun deleteModel(modelId: String): Boolean {
        val clean = sanitizeModelId(modelId)
        cancelDownload(clean)
        val dir = getModelDir(clean)
        val deleted = if (dir.exists()) dir.deleteRecursively() else true
        return deleted && !dir.exists()
    }

    suspend fun downloadModel(
        modelId: String,
        voiceId: String? = null,
        onProgress: (DownloadProgress) -> Unit,
    ): Result<String> = withContext(Dispatchers.IO) {
        val spec = findSpec(modelId)
            ?: return@withContext Result.failure(IllegalArgumentException("Unknown speech model: $modelId"))

        val targetVoiceId = resolveVoiceId(spec.id, voiceId)
        if (isVoiceInstalled(spec.id, targetVoiceId)) {
            val total = getInstalledBytes(spec.id)
            onProgress(
                DownloadProgress(
                    modelId = spec.id,
                    state = "completed",
                    downloadedBytes = total,
                    totalBytes = total,
                    percent = 100,
                )
            )
            return@withContext Result.success("Already installed")
        }

        val session = ActiveDownload()
        if (activeDownloads.putIfAbsent(spec.id, session) != null) {
            return@withContext Result.failure(IllegalStateException("Download already in progress for ${spec.label}"))
        }

        try {
            when (spec.packageKind) {
                PackageKind.DIRECT_FILES -> downloadDirectFiles(spec, session, onProgress)
                PackageKind.TAR_BZ2_SINGLE -> {
                    val url = spec.archiveUrl ?: throw IOException("Missing archive URL for ${spec.id}")
                    downloadAndExtractTarBz2(
                        spec = spec,
                        archiveUrl = url,
                        expectedBytes = spec.estimatedBytes,
                        destDir = getModelDir(spec.id),
                        session = session,
                        onProgress = onProgress,
                    )
                }
                PackageKind.TAR_BZ2_PER_VOICE -> {
                    val voiceSpec = findVoiceSpec(spec.id, targetVoiceId)
                        ?: throw IllegalArgumentException("Unknown voice $targetVoiceId for ${spec.id}")
                    val url = voiceSpec.perVoiceArchiveUrl
                        ?: throw IOException("Missing archive URL for voice ${voiceSpec.id}")
                    downloadAndExtractTarBz2(
                        spec = spec,
                        archiveUrl = url,
                        expectedBytes = voiceSpec.perVoiceArchiveBytes,
                        destDir = getVoiceDir(spec.id, voiceSpec.id),
                        session = session,
                        onProgress = onProgress,
                    )
                }
            }
            Result.success("${spec.label} downloaded cleanly")
        } catch (ce: CancellationException) {
            onProgress(
                DownloadProgress(
                    modelId = spec.id,
                    state = "cancelled",
                    downloadedBytes = session.downloadedBytes.get(),
                    totalBytes = session.totalBytes.get(),
                    percent = session.percent.get(),
                )
            )
            Result.failure(ce)
        } catch (t: Throwable) {
            Log.e(TAG, "Failed downloading speech model ${spec.id}", t)
            onProgress(
                DownloadProgress(
                    modelId = spec.id,
                    state = "error",
                    downloadedBytes = session.downloadedBytes.get(),
                    totalBytes = session.totalBytes.get(),
                    percent = session.percent.get(),
                    error = t.message ?: "Download failed",
                )
            )
            Result.failure(t)
        } finally {
            activeDownloads.remove(spec.id)
        }
    }

    private fun downloadDirectFiles(
        spec: SpeechModelSpec,
        session: ActiveDownload,
        onProgress: (DownloadProgress) -> Unit,
    ) {
        val modelDir = getModelDir(spec.id)
        if (!modelDir.exists() && !modelDir.mkdirs()) {
            throw IOException("Unable to create model directory: ${modelDir.absolutePath}")
        }
        val estimatedTotal = spec.directFiles.sumOf { it.estimatedBytes }.coerceAtLeast(1L)
        session.totalBytes.set(estimatedTotal)

        var completedPrefix = 0L
        var lastEmitAt = 0L
        onProgress(DownloadProgress(spec.id, "downloading", 0L, estimatedTotal, 0))

        for (fileSpec in spec.directFiles) {
            if (session.cancelRequested.get()) throw CancellationException("Download cancelled")
            val dest = File(modelDir, fileSpec.relativePath)
            if (dest.isFile && dest.length() >= fileSpec.minValidBytes) {
                completedPrefix += dest.length()
                continue
            }
            val size = downloadSingleFile(fileSpec.url, dest, fileSpec.minValidBytes, session) { fileBytes, _ ->
                val done = completedPrefix + fileBytes
                val pct = ((done * 100L) / estimatedTotal).toInt().coerceIn(0, 99)
                session.downloadedBytes.set(done)
                session.percent.set(pct)
                val now = System.currentTimeMillis()
                if (now - lastEmitAt >= 180L) {
                    lastEmitAt = now
                    onProgress(DownloadProgress(spec.id, "downloading", done, estimatedTotal, pct))
                }
            }
            completedPrefix += size
        }

        if (!isModelInstalled(spec.id)) {
            throw IOException("Verification failed after downloading ${spec.label}")
        }
        session.downloadedBytes.set(completedPrefix)
        session.totalBytes.set(completedPrefix)
        session.percent.set(100)
        onProgress(DownloadProgress(spec.id, "completed", completedPrefix, completedPrefix, 100))
    }

    private fun downloadAndExtractTarBz2(
        spec: SpeechModelSpec,
        archiveUrl: String,
        expectedBytes: Long,
        destDir: File,
        session: ActiveDownload,
        onProgress: (DownloadProgress) -> Unit,
    ) {
        val parent = destDir.parentFile ?: getModelsRootDir()
        if (!parent.exists() && !parent.mkdirs()) {
            throw IOException("Unable to create directory: ${parent.absolutePath}")
        }

        val archiveTmp = File(parent, "${destDir.name}.tar.bz2.tmp")
        val stagingDir = File(parent, "${destDir.name}.staging")
        if (archiveTmp.exists()) archiveTmp.delete()
        if (stagingDir.exists()) stagingDir.deleteRecursively()

        val estimated = expectedBytes.coerceAtLeast(1_000_000L)
        session.totalBytes.set(estimated)
        var lastEmitAt = 0L
        onProgress(DownloadProgress(spec.id, "downloading", 0L, estimated, 0))

        try {
            val downloaded = downloadSingleFile(
                urlString = archiveUrl,
                targetFile = archiveTmp,
                minValidBytes = 1_000_000L,
                session = session,
            ) { fileBytes, contentLen ->
                val total = if (contentLen > 0L) contentLen else estimated
                // Reserve top 10% of bar for tar.bz2 extraction
                val pct = ((fileBytes * 90L) / total).toInt().coerceIn(0, 90)
                session.downloadedBytes.set(fileBytes)
                session.totalBytes.set(total)
                session.percent.set(pct)
                val now = System.currentTimeMillis()
                if (now - lastEmitAt >= 180L) {
                    lastEmitAt = now
                    onProgress(DownloadProgress(spec.id, "downloading", fileBytes, total, pct))
                }
            }

            if (session.cancelRequested.get()) throw CancellationException("Download cancelled")
            session.percent.set(92)
            onProgress(DownloadProgress(spec.id, "extracting", downloaded, downloaded, 92))

            extractTarBz2Safely(archiveTmp, stagingDir, session)

            if (!stagingDir.mkdirs() && !stagingDir.isDirectory) {
                throw IOException("Staging directory invalid")
            }
            File(stagingDir, READY_MARKER).writeText("ok", Charsets.UTF_8)

            if (destDir.exists()) {
                destDir.deleteRecursively()
            }
            if (!stagingDir.renameTo(destDir)) {
                stagingDir.copyRecursively(destDir, overwrite = true)
                stagingDir.deleteRecursively()
            }

            if (!isExtractedBundleValid(spec.id, destDir)) {
                throw IOException("Extracted bundle verification failed for ${spec.label}")
            }

            val finalBytes = walkDirectoryBytes(destDir)
            session.downloadedBytes.set(finalBytes)
            session.totalBytes.set(finalBytes)
            session.percent.set(100)
            onProgress(DownloadProgress(spec.id, "completed", finalBytes, finalBytes, 100))
        } finally {
            if (archiveTmp.exists()) archiveTmp.delete()
            if (stagingDir.exists()) stagingDir.deleteRecursively()
        }
    }

    private fun extractTarBz2Safely(archiveFile: File, destDir: File, session: ActiveDownload) {
        if (!destDir.exists() && !destDir.mkdirs()) {
            throw IOException("Unable to create extraction dir: ${destDir.absolutePath}")
        }
        val destCanonical = destDir.canonicalFile
        val destPrefix = destCanonical.path + File.separator
        val buf = ByteArray(32 * 1024)
        var commonTopPrefix: String? = null

        BufferedInputStream(archiveFile.inputStream(), 64 * 1024).use { rawIn ->
            BZip2CompressorInputStream(rawIn).use { bzIn ->
                TarArchiveInputStream(bzIn).use { tarIn ->
                    while (true) {
                        if (session.cancelRequested.get()) {
                            throw CancellationException("Download cancelled")
                        }
                        val entry: TarArchiveEntry = tarIn.nextEntry ?: break
                        var entryName = entry.name
                            .replace('\\', '/')
                            .trimStart('/')
                        if (entryName.startsWith("./")) {
                            entryName = entryName.removePrefix("./")
                        }
                        if (entryName.isEmpty() || entryName == ".") continue

                        val slashIdx = entryName.indexOf('/')
                        if (commonTopPrefix == null && slashIdx > 0) {
                            commonTopPrefix = entryName.substring(0, slashIdx + 1)
                        }
                        val strippedName = if (commonTopPrefix != null && entryName.startsWith(commonTopPrefix!!)) {
                            entryName.removePrefix(commonTopPrefix!!)
                        } else {
                            entryName
                        }.trimStart('/')

                        if (strippedName.isEmpty()) continue
                        if (entry.isSymbolicLink || entry.isLink) continue

                        val target = File(destCanonical, strippedName).canonicalFile
                        if (target.path != destCanonical.path && !target.path.startsWith(destPrefix)) {
                            throw SecurityException("Blocked unsafe tar entry path: ${entry.name}")
                        }

                        if (entry.isDirectory) {
                            if (!target.exists()) target.mkdirs()
                            continue
                        }

                        target.parentFile?.let { p ->
                            if (!p.exists()) p.mkdirs()
                        }
                        FileOutputStream(target).use { out ->
                            while (true) {
                                if (session.cancelRequested.get()) {
                                    throw CancellationException("Download cancelled")
                                }
                                val r = tarIn.read(buf)
                                if (r == -1) break
                                out.write(buf, 0, r)
                            }
                        }
                    }
                }
            }
        }
    }

    private fun downloadSingleFile(
        urlString: String,
        targetFile: File,
        minValidBytes: Long,
        session: ActiveDownload,
        onBytes: (downloaded: Long, totalForFile: Long) -> Unit,
    ): Long {
        targetFile.parentFile?.let { parent ->
            if (!parent.exists() && !parent.mkdirs()) {
                throw IOException("Unable to create directory: ${parent.absolutePath}")
            }
        }

        val tmpFile = File(targetFile.parentFile, "${targetFile.name}.tmp")
        if (tmpFile.exists()) tmpFile.delete()

        val conn = openConnectionWithRedirects(urlString, session)
        session.connection = conn

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
                        if (session.cancelRequested.get()) {
                            throw CancellationException("Download cancelled")
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

            if (session.cancelRequested.get()) throw CancellationException("Download cancelled")
            if (contentLength > 0L && downloaded != contentLength) {
                throw IOException("Incomplete download for ${targetFile.name}: $downloaded / $contentLength")
            }
            if (downloaded < minValidBytes) {
                throw IOException("Downloaded file ${targetFile.name} is unexpectedly small ($downloaded B)")
            }

            if (targetFile.exists() && !targetFile.delete()) {
                throw IOException("Unable to replace ${targetFile.name}")
            }
            if (!tmpFile.renameTo(targetFile)) {
                throw IOException("Unable to finalize ${targetFile.name}")
            }
            downloaded
        } catch (t: Throwable) {
            if (tmpFile.exists()) tmpFile.delete()
            throw t
        } finally {
            runCatching { conn.disconnect() }
            if (session.connection === conn) {
                session.connection = null
            }
        }
    }

    private fun openConnectionWithRedirects(initialUrl: String, session: ActiveDownload): HttpURLConnection {
        var currentUrl = initialUrl
        var redirects = 0
        while (redirects < MAX_REDIRECTS) {
            if (session.cancelRequested.get()) throw CancellationException("Download cancelled")
            val url = URL(currentUrl)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 20_000
                readTimeout = 45_000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "AOTG-Android/1.0")
            }
            session.connection = conn
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
        throw IOException("Too many redirects fetching $initialUrl")
    }

    private fun isExtractedBundleValid(modelId: String, dir: File): Boolean {
        if (!dir.isDirectory || !File(dir, READY_MARKER).isFile) return false
        val files = dir.listFiles() ?: return false
        return when (modelId) {
            POCKET_TTS_ID -> files.any { it.name.startsWith("lm_main") && it.name.endsWith(".onnx") } &&
                File(dir, "vocab.json").isFile
            KOKORO_MULTI_ID, KITTEN_EN_ID -> {
                files.any { it.name.endsWith(".onnx") } &&
                    File(dir, "tokens.txt").isFile &&
                    File(dir, "voices.bin").isFile
            }
            else -> {
                files.any { it.name.endsWith(".onnx") } && File(dir, "tokens.txt").isFile
            }
        }
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
        private const val TAG = "SpeechModelManager"
        private const val ROOT_DIR_RELATIVE = "models/tts"
        private const val READY_MARKER = ".ready"
        private const val MAX_REDIRECTS = 10

        const val MMS_TTS_HIN_ID = "mms_tts_hin"
        const val INDIC_TINY_HI_ID = "indic_tiny_hi"
        const val PIPER_HI_ID = "piper_hi"
        const val KOKORO_MULTI_ID = "kokoro_multi"
        const val PIPER_EN_ID = "piper_en"
        const val KITTEN_EN_ID = "kitten_en"
        const val POCKET_TTS_ID = "pocket_tts"

        private const val HF_MMS_BASE = "https://huggingface.co/Xenova/mms-tts-hin/resolve/main/"
        private const val HF_INDIC_BASE = "https://huggingface.co/sulabhkatiyar/indic-tiny-tts-hindi/resolve/main/"
        private const val SHERPA_BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/"

        val CATALOG: List<SpeechModelSpec> = listOf(
            SpeechModelSpec(
                id = MMS_TTS_HIN_ID,
                label = "Xenova MMS-TTS Hindi",
                subtitle = "Meta VITS INT8 · Fast pure-Devanagari Hindi (16 kHz)",
                engineFamily = "onnx_vits",
                languages = listOf("hi"),
                sampleRate = 16_000,
                estimatedBytes = 38_371_388L,
                packageKind = PackageKind.DIRECT_FILES,
                directFiles = listOf(
                    DirectFileSpec("config.json", "${HF_MMS_BASE}config.json", 1_656L, 200L),
                    DirectFileSpec("tokenizer_config.json", "${HF_MMS_BASE}tokenizer_config.json", 654L, 100L),
                    DirectFileSpec("vocab.json", "${HF_MMS_BASE}vocab.json", 907L, 200L),
                    DirectFileSpec("onnx/model_quantized.onnx", "${HF_MMS_BASE}onnx/model_quantized.onnx", 38_368_171L, 20_000_000L),
                ),
                defaultVoiceId = "default",
                voices = listOf(
                    SpeechVoiceSpec("default", "MMS Hindi", "Natural native Hindi speaker", "hi"),
                ),
                supportsHindi = true,
                supportsEnglish = false,
            ),
            SpeechModelSpec(
                id = INDIC_TINY_HI_ID,
                label = "Indic-Tiny-TTS Hindi",
                subtitle = "Matcha + Vocos 24 kHz studio Hindi (Female & Male)",
                engineFamily = "onnx_matcha",
                languages = listOf("hi"),
                sampleRate = 24_000,
                estimatedBytes = 91_021_687L,
                packageKind = PackageKind.DIRECT_FILES,
                directFiles = listOf(
                    DirectFileSpec("config.json", "${HF_INDIC_BASE}config.json", 3_443L, 500L),
                    DirectFileSpec("onnx/onnx_manifest.json", "${HF_INDIC_BASE}onnx/onnx_manifest.json", 3_117L, 500L),
                    DirectFileSpec("onnx/text_encoder.onnx", "${HF_INDIC_BASE}onnx/text_encoder.onnx", 17_695_838L, 10_000_000L),
                    DirectFileSpec("onnx/flow_decoder.onnx", "${HF_INDIC_BASE}onnx/flow_decoder.onnx", 19_169_253L, 10_000_000L),
                    DirectFileSpec("onnx/vocoder.onnx", "${HF_INDIC_BASE}onnx/vocoder.onnx", 54_150_036L, 30_000_000L),
                ),
                defaultVoiceId = "female",
                voices = listOf(
                    SpeechVoiceSpec("female", "Hindi Female", "Expressive studio female", "hi", speakerId = 2),
                    SpeechVoiceSpec("male", "Hindi Male", "Warm clear male", "hi", speakerId = 3),
                ),
                supportsHindi = true,
                supportsEnglish = false,
            ),
            SpeechModelSpec(
                id = PIPER_HI_ID,
                label = "Piper Hindi (VITS INT8)",
                subtitle = "Ultra-fast ~21 MB Hindi voices with eSpeak phonemizer",
                engineFamily = "sherpa_vits",
                languages = listOf("hi"),
                sampleRate = 22_050,
                estimatedBytes = 21_064_499L,
                packageKind = PackageKind.TAR_BZ2_PER_VOICE,
                defaultVoiceId = "rohan",
                voices = listOf(
                    SpeechVoiceSpec(
                        id = "rohan",
                        label = "Rohan (Medium)",
                        description = "Clear conversational male",
                        language = "hi",
                        perVoiceArchiveUrl = "${SHERPA_BASE}vits-piper-hi_IN-rohan-medium-int8.tar.bz2",
                        perVoiceArchiveBytes = 21_064_499L,
                    ),
                    SpeechVoiceSpec(
                        id = "pratham",
                        label = "Pratham (Medium)",
                        description = "Deep balanced Hindi male",
                        language = "hi",
                        perVoiceArchiveUrl = "${SHERPA_BASE}vits-piper-hi_IN-pratham-medium-int8.tar.bz2",
                        perVoiceArchiveBytes = 20_987_965L,
                    ),
                    SpeechVoiceSpec(
                        id = "priyamvada",
                        label = "Priyamvada (Medium)",
                        description = "Natural expressive female",
                        language = "hi",
                        perVoiceArchiveUrl = "${SHERPA_BASE}vits-piper-hi_IN-priyamvada-medium-int8.tar.bz2",
                        perVoiceArchiveBytes = 21_097_319L,
                    ),
                ),
                supportsHindi = true,
                supportsEnglish = false,
            ),
            SpeechModelSpec(
                id = KOKORO_MULTI_ID,
                label = "Kokoro-82M Multi-Lang INT8",
                subtitle = "Bilingual English + Hindi 24 kHz studio neural voices",
                engineFamily = "sherpa_kokoro",
                languages = listOf("hi", "en"),
                sampleRate = 24_000,
                estimatedBytes = 132_353_410L,
                packageKind = PackageKind.TAR_BZ2_SINGLE,
                archiveUrl = "${SHERPA_BASE}kokoro-int8-multi-lang-v1_0.tar.bz2",
                defaultVoiceId = "af_heart",
                voices = listOf(
                    SpeechVoiceSpec("hf_alpha", "Alpha (Hindi F)", "Natural Hindi female", "hi", speakerId = 32),
                    SpeechVoiceSpec("hf_beta", "Beta (Hindi F)", "Soft Hindi female", "hi", speakerId = 33),
                    SpeechVoiceSpec("hm_omega", "Omega (Hindi M)", "Warm Hindi male", "hi", speakerId = 34),
                    SpeechVoiceSpec("hm_psi", "Psi (Hindi M)", "Clear Hindi male", "hi", speakerId = 35),
                    SpeechVoiceSpec("af_heart", "Heart (EN F)", "Expressive US female", "en", speakerId = 3),
                    SpeechVoiceSpec("af_bella", "Bella (EN F)", "Warm US female", "en", speakerId = 2),
                    SpeechVoiceSpec("am_adam", "Adam (EN M)", "Crisp US male", "en", speakerId = 11),
                    SpeechVoiceSpec("bf_emma", "Emma (EN UK F)", "Clear British female", "en", speakerId = 21),
                    SpeechVoiceSpec("bm_george", "George (EN UK M)", "Steady British male", "en", speakerId = 26),
                ),
                supportsHindi = true,
                supportsEnglish = true,
            ),
            SpeechModelSpec(
                id = PIPER_EN_ID,
                label = "Piper English (VITS INT8)",
                subtitle = "Ultra-fast ~21 MB US English voices for low-RAM devices",
                engineFamily = "sherpa_vits",
                languages = listOf("en"),
                sampleRate = 22_050,
                estimatedBytes = 20_969_179L,
                packageKind = PackageKind.TAR_BZ2_PER_VOICE,
                defaultVoiceId = "lessac",
                voices = listOf(
                    SpeechVoiceSpec(
                        id = "lessac",
                        label = "Lessac (US Medium)",
                        description = "Articulate balanced neutral",
                        language = "en",
                        perVoiceArchiveUrl = "${SHERPA_BASE}vits-piper-en_US-lessac-medium-int8.tar.bz2",
                        perVoiceArchiveBytes = 20_969_179L,
                    ),
                    SpeechVoiceSpec(
                        id = "amy",
                        label = "Amy (US Medium)",
                        description = "Warm conversational US female",
                        language = "en",
                        perVoiceArchiveUrl = "${SHERPA_BASE}vits-piper-en_US-amy-medium-int8.tar.bz2",
                        perVoiceArchiveBytes = 21_028_122L,
                    ),
                ),
                supportsHindi = false,
                supportsEnglish = true,
            ),
            SpeechModelSpec(
                id = KITTEN_EN_ID,
                label = "KittenTTS Nano v0.8 INT8",
                subtitle = "Tiny 31 MB 8-voice expressive English generator",
                engineFamily = "sherpa_kitten",
                languages = listOf("en"),
                sampleRate = 24_000,
                estimatedBytes = 31_220_690L,
                packageKind = PackageKind.TAR_BZ2_SINGLE,
                archiveUrl = "${SHERPA_BASE}kitten-nano-en-v0_8-int8.tar.bz2",
                defaultVoiceId = "jasper",
                voices = listOf(
                    SpeechVoiceSpec("bella", "Bella", "Warm expressive female", "en", speakerId = 0),
                    SpeechVoiceSpec("jasper", "Jasper", "Balanced studio male", "en", speakerId = 1),
                    SpeechVoiceSpec("luna", "Luna", "Soft gentle female", "en", speakerId = 2),
                    SpeechVoiceSpec("bruno", "Bruno", "Deep steady male", "en", speakerId = 3),
                    SpeechVoiceSpec("rosie", "Rosie", "Upbeat friendly female", "en", speakerId = 4),
                    SpeechVoiceSpec("hugo", "Hugo", "Crisp narrator male", "en", speakerId = 5),
                    SpeechVoiceSpec("kiki", "Kiki", "Bright energetic female", "en", speakerId = 6),
                    SpeechVoiceSpec("leo", "Leo", "Conversational male", "en", speakerId = 7),
                ),
                supportsHindi = false,
                supportsEnglish = true,
            ),
            SpeechModelSpec(
                id = POCKET_TTS_ID,
                label = "PocketTTS INT8 (Kyutai)",
                subtitle = "High-fidelity zero-shot voice-conditioned English (24 kHz)",
                engineFamily = "sherpa_pocket",
                languages = listOf("en"),
                sampleRate = 24_000,
                estimatedBytes = 98_337_865L,
                packageKind = PackageKind.TAR_BZ2_SINGLE,
                archiveUrl = "${SHERPA_BASE}sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2",
                defaultVoiceId = "default",
                voices = listOf(
                    SpeechVoiceSpec("default", "Pocket Studio", "Default zero-shot reference voice", "en"),
                ),
                supportsHindi = false,
                supportsEnglish = true,
            ),
        )

        private val CATALOG_BY_ID: Map<String, SpeechModelSpec> = CATALOG.associateBy { it.id }

        fun sanitizeModelId(raw: String?): String {
            return raw?.trim()?.lowercase()?.replace(Regex("[^a-z0-9_-]"), "").orEmpty()
        }
    }
}
