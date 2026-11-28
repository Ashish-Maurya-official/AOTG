package com.ashish.technologies.aotg.turbo_modules.liveaudio

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.util.Log
import java.io.File
import java.nio.LongBuffer
import java.text.Normalizer
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * On-device Neural Hindi TTS Engine powered by `Xenova/mms-tts-hin` INT8 ONNX (~38.4 MB).
 *
 * Uses direct Devanagari character tokenization (`vocab.json` + blank ID `0` interspersing per
 * `tokenizer_config.json`), runs `model_quantized.onnx` on CPU via ONNX Runtime, and streams
 * 16 kHz PCM16 frames to C++ Oboe (`gTtsResampler` resamples 16 kHz -> 24 kHz transparently).
 */
internal class MmsHindiStreamingTtsEngine(
    private val modelDirProvider: () -> File,
) : StreamingTtsEngine {

    override val name: String = ENGINE_NAME

    @Volatile private var env: OrtEnvironment? = null
    @Volatile private var session: OrtSession? = null
    @Volatile private var vocab: Map<Char, Long> = emptyMap()
    @Volatile private var sampleRate: Int = DEFAULT_SAMPLE_RATE
    @Volatile private var addBlank: Boolean = true
    @Volatile private var padId: Long = 0L

    private val engineLock = ReentrantLock()
    private val stopRequested = AtomicBoolean(false)

    fun isInitialized(): Boolean = session != null && vocab.isNotEmpty()

    override suspend fun initialize(): Boolean = withContext(Dispatchers.IO) {
        engineLock.withLock {
            if (isInitialized()) return@withLock true
            val dir = modelDirProvider()
            val modelFile = File(dir, "onnx/model_quantized.onnx")
            val vocabFile = File(dir, "vocab.json")
            val configFile = File(dir, "config.json")
            val tokConfigFile = File(dir, "tokenizer_config.json")

            if (!modelFile.isFile || !vocabFile.isFile) {
                return@withLock false
            }

            var createdSession: OrtSession? = null
            try {
                if (configFile.isFile) {
                    val cfg = JSONObject(configFile.readText(Charsets.UTF_8))
                    sampleRate = cfg.optInt("sampling_rate", DEFAULT_SAMPLE_RATE).coerceIn(8000, 48000)
                }

                val parsedVocab = parseVocab(vocabFile)
                if (parsedVocab.isEmpty()) {
                    Log.w(TAG, "MMS Hindi vocab.json is empty")
                    return@withLock false
                }

                var blankEnabled = true
                var blankTokenId = 0L
                if (tokConfigFile.isFile) {
                    val tokCfg = JSONObject(tokConfigFile.readText(Charsets.UTF_8))
                    blankEnabled = tokCfg.optBoolean("add_blank", true)
                    val padStr = tokCfg.optString("pad_token", "")
                    if (padStr.length == 1) {
                        blankTokenId = parsedVocab[padStr[0]] ?: 0L
                    }
                }

                val ortEnv = OrtEnvironment.getEnvironment()
                val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(2)
                val cpuThreads = minOf(4, maxOf(2, cores / 2))
                OrtSession.SessionOptions().use { opts ->
                    opts.setIntraOpNumThreads(cpuThreads)
                    opts.setInterOpNumThreads(1)
                    opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
                    createdSession = ortEnv.createSession(modelFile.absolutePath, opts)
                }

                env = ortEnv
                session = createdSession
                vocab = parsedVocab
                addBlank = blankEnabled
                padId = blankTokenId
                Log.i(TAG, "Initialized MMS-TTS Hindi (sr=$sampleRate, vocab=${parsedVocab.size}, threads=$cpuThreads)")
                true
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to initialize MMS-TTS Hindi", t)
                runCatching { createdSession?.close() }
                session = null
                vocab = emptyMap()
                false
            }
        }
    }

    override fun synthesizeClauseBlocking(
        clauseText: String,
        turnEpoch: Int,
        clauseId: Int,
        onPcmChunk: (pcm16Bytes: ByteArray, sampleRate: Int, channels: Int) -> Boolean,
        onFallbackWav: (wavBytes: ByteArray) -> Boolean,
    ): Boolean {
        val cleaned = HindiTextNormalizer.normalizeForHindiTts(clauseText)
        if (cleaned.isEmpty()) return true

        stopRequested.set(false)
        return engineLock.withLock {
            if (stopRequested.get()) return@withLock false
            val ortEnv = env ?: return@withLock false
            val ortSession = session ?: return@withLock false
            val tokenMap = vocab
            if (tokenMap.isEmpty()) return@withLock false

            val inputIds = encodeTokens(cleaned, tokenMap)
            if (inputIds.isEmpty()) return@withLock true

            try {
                val seqLen = inputIds.size.toLong()
                val maskIds = LongArray(inputIds.size) { 1L }
                val shape = longArrayOf(1L, seqLen)

                val idsTensor = OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(inputIds), shape)
                val maskTensor = OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(maskIds), shape)

                try {
                    val inputs = HashMap<String, OnnxTensor>(2)
                    inputs["input_ids"] = idsTensor
                    if (ortSession.inputNames.contains("attention_mask")) {
                        inputs["attention_mask"] = maskTensor
                    }

                    ortSession.run(inputs).use { result ->
                        val waveTensor = (result.get("waveform").orElse(null)
                            ?: result.get(0)) as OnnxTensor
                        val buf = waveTensor.floatBuffer
                        buf.rewind()
                        val samples = FloatArray(buf.remaining())
                        buf.get(samples)
                        return@withLock streamFloatAudioAsPcm16(samples, sampleRate, stopRequested, onPcmChunk)
                    }
                } finally {
                    idsTensor.close()
                    maskTensor.close()
                }
            } catch (t: Throwable) {
                Log.e(TAG, "MMS-TTS Hindi inference failed for clause $clauseId", t)
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
            runCatching { session?.close() }
            session = null
            vocab = emptyMap()
        }
    }

    internal fun encodeTokens(normalizedText: String, tokenMap: Map<Char, Long>): LongArray {
        val rawIds = ArrayList<Long>(normalizedText.length)
        for (ch in normalizedText) {
            val direct = tokenMap[ch]
            if (direct != null) {
                rawIds.add(direct)
                continue
            }
            // Fall back to NFD decomposition for precomposed nukta/vowel forms missing from vocab
            val nfd = Normalizer.normalize(ch.toString(), Normalizer.Form.NFD)
            for (sub in nfd) {
                tokenMap[sub]?.let { rawIds.add(it) }
            }
        }
        if (rawIds.isEmpty()) return LongArray(0)
        if (!addBlank) return rawIds.toLongArray()

        val interspersed = LongArray(rawIds.size * 2 + 1)
        var outIdx = 0
        interspersed[outIdx++] = padId
        for (id in rawIds) {
            interspersed[outIdx++] = id
            interspersed[outIdx++] = padId
        }
        return interspersed
    }

    private fun parseVocab(file: File): Map<Char, Long> {
        val json = JSONObject(file.readText(Charsets.UTF_8))
        val map = HashMap<Char, Long>(json.length())
        val keys = json.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            if (k.length == 1) {
                map[k[0]] = json.optLong(k, 0L)
            }
        }
        return map
    }

    companion object {
        private const val TAG = "MmsHindiTts"
        const val ENGINE_NAME = "mms_tts_hin"
        private const val DEFAULT_SAMPLE_RATE = 16_000
        private const val CHANNELS = 1
        private const val CHUNK_MS = 80
    }
}
