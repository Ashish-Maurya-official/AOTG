package com.ashish.technologies.aotg.turbo_modules.liveaudio

import android.util.Log
import com.k2fsa.sherpa.onnx.GenerationConfig
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKittenModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsPocketModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Unified [StreamingTtsEngine] backed by `sherpa-onnx` [OfflineTts] across all Sherpa-supported
 * downloaded bundles: `piper_hi`, `kokoro_multi`, `piper_en`, `kitten_en`, and `pocket_tts`.
 *
 * Streams PCM16 chunks progressively via `OfflineTts.generateWithCallback` /
 * `generateWithConfigAndCallback`, allowing immediate C++ barge-in interruption (`callback -> 0`).
 */
internal class SherpaStreamingTtsEngine(
    private val modelManager: SpeechModelManager,
) : StreamingTtsEngine {

    override val name: String
        get() = currentModelId

    @Volatile private var currentModelId: String = SpeechModelManager.PIPER_HI_ID
    @Volatile private var currentVoiceId: String = "rohan"

    @Volatile private var activeTts: OfflineTts? = null
    @Volatile private var loadedKey: String = ""
    @Volatile private var sampleRate: Int = 22_050

    private var cachedPocketRefAudio: FloatArray? = null
    private var cachedPocketRefSampleRate: Int = 24_000

    private val engineLock = ReentrantLock()
    private val stopRequested = AtomicBoolean(false)

    fun configure(modelId: String, voiceId: String?) {
        val cleanModel = SpeechModelManager.sanitizeModelId(modelId)
        val cleanVoice = modelManager.resolveVoiceId(cleanModel, voiceId)
        currentModelId = cleanModel
        currentVoiceId = cleanVoice
    }

    fun getConfiguredModelId(): String = currentModelId

    fun getConfiguredVoiceId(): String = currentVoiceId

    override suspend fun initialize(): Boolean = withContext(Dispatchers.IO) {
        engineLock.withLock {
            initializeForLocked(currentModelId, currentVoiceId)
        }
    }

    suspend fun initializeFor(modelId: String, voiceId: String?): Boolean = withContext(Dispatchers.IO) {
        engineLock.withLock {
            configure(modelId, voiceId)
            initializeForLocked(currentModelId, currentVoiceId)
        }
    }

    private fun initializeForLocked(modelId: String, voiceId: String): Boolean {
        val spec = modelManager.findSpec(modelId) ?: return false
        val installedVoice = modelManager.resolveInstalledVoiceId(spec.id, voiceId) ?: return false
        val dir = modelManager.getVoiceDir(spec.id, installedVoice)
        val desiredKey = "${spec.id}::${dir.absolutePath}"

        if (activeTts != null && loadedKey == desiredKey) {
            currentVoiceId = installedVoice
            return true
        }

        releaseActiveLocked()

        return try {
            val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(2)
            val cpuThreads = minOf(4, maxOf(2, cores / 2))
            val modelCfg = buildModelConfig(spec, dir, cpuThreads) ?: return false
            val ttsConfig = OfflineTtsConfig(
                model = modelCfg,
                ruleFsts = "",
                ruleFars = "",
                maxNumSentences = 1,
                silenceScale = 0.2f,
            )

            val instance = OfflineTts(null, ttsConfig)
            sampleRate = instance.sampleRate().coerceIn(8_000, 48_000)

            if (spec.id == SpeechModelManager.POCKET_TTS_ID) {
                loadPocketReferenceWav(dir)
            }

            activeTts = instance
            loadedKey = desiredKey
            currentModelId = spec.id
            currentVoiceId = installedVoice
            Log.i(TAG, "Initialized Sherpa OfflineTts for ${spec.id} (voice=$installedVoice, sr=$sampleRate, speakers=${instance.numSpeakers()})")
            true
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to initialize Sherpa OfflineTts for ${spec.id}", t)
            releaseActiveLocked()
            false
        }
    }

    override fun synthesizeClauseBlocking(
        clauseText: String,
        turnEpoch: Int,
        clauseId: Int,
        onPcmChunk: (pcm16Bytes: ByteArray, sampleRate: Int, channels: Int) -> Boolean,
        onFallbackWav: (wavBytes: ByteArray) -> Boolean,
    ): Boolean {
        val spec = modelManager.findSpec(currentModelId)
        val cleanText = if (spec != null && spec.supportsHindi && AndroidStreamingTtsEngine.containsDevanagari(clauseText)) {
            HindiTextNormalizer.normalizeForHindiTts(clauseText)
        } else {
            clauseText.trim()
        }
        if (cleanText.isEmpty()) return true

        stopRequested.set(false)
        return engineLock.withLock {
            if (stopRequested.get()) return@withLock false
            val tts = activeTts ?: return@withLock false
            val activeSpec = modelManager.findSpec(currentModelId) ?: return@withLock false
            val effectiveSr = tts.sampleRate().takeIf { it >= 8_000 } ?: sampleRate

            val sid = resolveSpeakerIdForClause(activeSpec, cleanText, tts.numSpeakers())
            val callbackAborted = AtomicBoolean(false)

            val chunkCallback: (FloatArray) -> Int = { samples ->
                if (stopRequested.get() || callbackAborted.get()) {
                    0
                } else {
                    val ok = streamFloatAudioAsPcm16(samples, effectiveSr, stopRequested, onPcmChunk)
                    if (!ok) {
                        callbackAborted.set(true)
                        0
                    } else {
                        1
                    }
                }
            }

            try {
                if (activeSpec.id == SpeechModelManager.POCKET_TTS_ID) {
                    val refAudio = cachedPocketRefAudio
                    val genCfg = GenerationConfig().apply {
                        speed = 1.0f
                        numSteps = 4
                        silenceScale = 0.2f
                        if (refAudio != null && refAudio.isNotEmpty()) {
                            referenceAudio = refAudio
                            referenceSampleRate = cachedPocketRefSampleRate
                        }
                    }
                    tts.generateWithConfigAndCallback(cleanText, genCfg, chunkCallback)
                } else {
                    tts.generateWithCallback(cleanText, sid, 1.03f, chunkCallback)
                }
                !stopRequested.get() && !callbackAborted.get()
            } catch (t: Throwable) {
                Log.e(TAG, "Sherpa TTS synthesis failed for ${activeSpec.id} clause $clauseId", t)
                false
            }
        }
    }

    override fun stopCurrent() {
        stopRequested.set(true)
    }

    override fun shutdown() {
        stopRequested.set(true)
        engineLock.withLock {
            releaseActiveLocked()
        }
    }

    private fun releaseActiveLocked() {
        runCatching { activeTts?.release() }
        activeTts = null
        loadedKey = ""
        cachedPocketRefAudio = null
    }

    private fun resolveSpeakerIdForClause(
        spec: SpeechModelManager.SpeechModelSpec,
        clauseText: String,
        numSpeakers: Int,
    ): Int {
        if (numSpeakers <= 1) return 0
        val voiceSpec = modelManager.findVoiceSpec(spec.id, currentVoiceId) ?: return 0

        // For bilingual Kokoro, automatically use a Hindi speaker for Devanagari text if current
        // voice is English, and an English speaker for purely Latin text if current voice is Hindi.
        val resolvedSid = if (spec.id == SpeechModelManager.KOKORO_MULTI_ID) {
            val isDev = AndroidStreamingTtsEngine.containsDevanagari(clauseText)
            if (isDev && voiceSpec.language != "hi") {
                spec.voices.firstOrNull { it.language == "hi" }?.speakerId ?: voiceSpec.speakerId
            } else if (!isDev && voiceSpec.language == "hi") {
                spec.voices.firstOrNull { it.language == "en" }?.speakerId ?: voiceSpec.speakerId
            } else {
                voiceSpec.speakerId
            }
        } else {
            voiceSpec.speakerId
        }
        return resolvedSid.coerceIn(0, numSpeakers - 1)
    }

    private fun buildModelConfig(
        spec: SpeechModelManager.SpeechModelSpec,
        dir: File,
        numThreads: Int,
    ): OfflineTtsModelConfig? {
        val espeakDir = File(dir, "espeak-ng-data").let { if (it.isDirectory) it.absolutePath else "" }
        val tokensPath = File(dir, "tokens.txt").let { if (it.isFile) it.absolutePath else "" }
        val voicesBinPath = File(dir, "voices.bin").let { if (it.isFile) it.absolutePath else "" }
        val onnxModelPath = findPrimaryOnnx(dir)

        return when (spec.engineFamily) {
            "sherpa_vits" -> {
                if (onnxModelPath.isEmpty() || tokensPath.isEmpty()) return null
                val lexiconPath = File(dir, "lexicon.txt").let { if (it.isFile) it.absolutePath else "" }
                OfflineTtsModelConfig(
                    vits = OfflineTtsVitsModelConfig(
                        model = onnxModelPath,
                        lexicon = lexiconPath,
                        tokens = tokensPath,
                        dataDir = espeakDir,
                        dictDir = "",
                        noiseScale = 0.667f,
                        noiseScaleW = 0.8f,
                        lengthScale = 1.0f,
                    ),
                    numThreads = numThreads,
                    debug = false,
                    provider = "cpu",
                )
            }
            "sherpa_kokoro" -> {
                if (onnxModelPath.isEmpty() || voicesBinPath.isEmpty() || tokensPath.isEmpty()) return null
                val lexiconFiles = dir.listFiles()
                    ?.filter { it.isFile && it.name.startsWith("lexicon") && it.name.endsWith(".txt") }
                    ?.sortedBy { it.name }
                    ?.joinToString(",") { it.absolutePath }
                    .orEmpty()
                OfflineTtsModelConfig(
                    kokoro = OfflineTtsKokoroModelConfig(
                        model = onnxModelPath,
                        voices = voicesBinPath,
                        tokens = tokensPath,
                        dataDir = espeakDir,
                        lexicon = lexiconFiles,
                        lang = "",
                        dictDir = "",
                        lengthScale = 1.0f,
                    ),
                    numThreads = numThreads,
                    debug = false,
                    provider = "cpu",
                )
            }
            "sherpa_kitten" -> {
                if (onnxModelPath.isEmpty() || voicesBinPath.isEmpty() || tokensPath.isEmpty()) return null
                OfflineTtsModelConfig(
                    kitten = OfflineTtsKittenModelConfig(
                        model = onnxModelPath,
                        voices = voicesBinPath,
                        tokens = tokensPath,
                        dataDir = espeakDir,
                        lengthScale = 1.0f,
                        lexicon = "",
                    ),
                    numThreads = numThreads,
                    debug = false,
                    provider = "cpu",
                )
            }
            "sherpa_pocket" -> {
                val lmFlow = findMatchingOnnx(dir, "lm_flow") ?: return null
                val lmMain = findMatchingOnnx(dir, "lm_main") ?: return null
                val encoder = findMatchingOnnx(dir, "encoder") ?: return null
                val decoder = findMatchingOnnx(dir, "decoder") ?: return null
                val textCond = findMatchingOnnx(dir, "text_conditioner") ?: return null
                val vocabJson = File(dir, "vocab.json").takeIf { it.isFile }?.absolutePath ?: return null
                val tokenScores = File(dir, "token_scores.json").takeIf { it.isFile }?.absolutePath ?: return null
                OfflineTtsModelConfig(
                    pocket = OfflineTtsPocketModelConfig(
                        lmFlow = lmFlow,
                        lmMain = lmMain,
                        encoder = encoder,
                        decoder = decoder,
                        textConditioner = textCond,
                        vocabJson = vocabJson,
                        tokenScoresJson = tokenScores,
                        voiceEmbeddingCacheCapacity = 8,
                    ),
                    numThreads = numThreads,
                    debug = false,
                    provider = "cpu",
                )
            }
            else -> null
        }
    }

    private fun findPrimaryOnnx(dir: File): String {
        val files = dir.listFiles()?.filter { it.isFile && it.name.endsWith(".onnx") }.orEmpty()
        val int8 = files.firstOrNull { it.name.contains("int8") }
        return (int8 ?: files.firstOrNull())?.absolutePath.orEmpty()
    }

    private fun findMatchingOnnx(dir: File, prefix: String): String? {
        val files = dir.listFiles()
            ?.filter { it.isFile && it.name.startsWith(prefix) && it.name.endsWith(".onnx") }
            .orEmpty()
        return (files.firstOrNull { it.name.contains("int8") } ?: files.firstOrNull())?.absolutePath
    }

    private fun loadPocketReferenceWav(dir: File) {
        val wavDir = File(dir, "test_wavs")
        val candidates = (wavDir.listFiles()?.filter { it.isFile && it.name.endsWith(".wav") }
            ?: dir.listFiles()?.filter { it.isFile && it.name.endsWith(".wav") })
            .orEmpty()
            .sortedBy { it.name }
        val chosen = candidates.firstOrNull { it.name.contains("bria", ignoreCase = true) }
            ?: candidates.firstOrNull()
            ?: return
        val parsed = readWavMonoFloat(chosen) ?: return
        cachedPocketRefAudio = parsed.first
        cachedPocketRefSampleRate = parsed.second
    }

    private fun readWavMonoFloat(file: File): Pair<FloatArray, Int>? {
        return try {
            val bytes = file.readBytes()
            if (bytes.size < 44) return null
            val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            if (bytes[0] != 'R'.code.toByte() || bytes[1] != 'I'.code.toByte() ||
                bytes[2] != 'F'.code.toByte() || bytes[3] != 'F'.code.toByte()
            ) return null

            var channels = 1
            var sr = 24_000
            var bitsPerSample = 16
            var audioFormat = 1
            var offset = 12

            while (offset + 8 <= bytes.size) {
                val chunkId = String(bytes, offset, 4, Charsets.US_ASCII)
                val chunkSize = bb.getInt(offset + 4).coerceAtLeast(0)
                val bodyOffset = offset + 8
                if (chunkId == "fmt " && bodyOffset + 16 <= bytes.size) {
                    audioFormat = bb.getShort(bodyOffset).toInt() and 0xFFFF
                    channels = (bb.getShort(bodyOffset + 2).toInt() and 0xFFFF).coerceAtLeast(1)
                    sr = bb.getInt(bodyOffset + 4).coerceIn(8_000, 48_000)
                    bitsPerSample = bb.getShort(bodyOffset + 14).toInt() and 0xFFFF
                } else if (chunkId == "data" && bodyOffset + chunkSize <= bytes.size) {
                    val samples = when {
                        audioFormat == 3 && bitsPerSample == 32 -> {
                            val totalFloats = chunkSize / 4
                            val frameCount = totalFloats / channels
                            FloatArray(frameCount) { f ->
                                var acc = 0f
                                for (c in 0 until channels) {
                                    acc += bb.getFloat(bodyOffset + (f * channels + c) * 4)
                                }
                                (acc / channels).coerceIn(-1f, 1f)
                            }
                        }
                        else -> {
                            val totalShorts = chunkSize / 2
                            val frameCount = totalShorts / channels
                            FloatArray(frameCount) { f ->
                                var acc = 0f
                                for (c in 0 until channels) {
                                    acc += bb.getShort(bodyOffset + (f * channels + c) * 2).toFloat() / 32768f
                                }
                                (acc / channels).coerceIn(-1f, 1f)
                            }
                        }
                    }
                    return samples to sr
                }
                offset = bodyOffset + chunkSize + (chunkSize and 1)
            }
            null
        } catch (t: Throwable) {
            Log.w(TAG, "Failed reading PocketTTS reference wav ${file.name}: ${t.message}")
            null
        }
    }

    companion object {
        private const val TAG = "SherpaStreamingTts"
        private const val CHUNK_MS = 80
    }
}
