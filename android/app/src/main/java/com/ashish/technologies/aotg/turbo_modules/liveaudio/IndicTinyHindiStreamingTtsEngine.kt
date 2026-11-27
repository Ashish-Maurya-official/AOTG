package com.ashish.technologies.aotg.turbo_modules.liveaudio

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.util.Log
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.text.Normalizer
import java.util.Random
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * On-device Neural Hindi TTS Engine powered by `sulabhkatiyar/indic-tiny-tts-hindi`
 * (3-graph Matcha flow matching + complex-STFT Vocos vocoder, 24 kHz native, ~91 MB).
 *
 * Supports `female` (`hi_F`) and `male` (`hi_M`) Hindi voices.
 */
internal class IndicTinyHindiStreamingTtsEngine(
    private val modelDirProvider: () -> File,
) : StreamingTtsEngine {

    override val name: String = ENGINE_NAME

    @Volatile private var env: OrtEnvironment? = null
    @Volatile private var textEncoderSession: OrtSession? = null
    @Volatile private var flowDecoderSession: OrtSession? = null
    @Volatile private var vocoderSession: OrtSession? = null

    @Volatile private var symbolMap: Map<Char, Long> = emptyMap()
    @Volatile private var blankId: Long = 0L
    @Volatile private var unkId: Long = 1L
    @Volatile private var addBlank: Boolean = true

    @Volatile private var sampleRate: Int = DEFAULT_SAMPLE_RATE
    @Volatile private var languageId: Long = 1L
    @Volatile private var styleId: Long = 0L
    @Volatile private var femaleSpeakerId: Long = 2L
    @Volatile private var maleSpeakerId: Long = 3L
    @Volatile private var currentVoiceId: String = DEFAULT_VOICE_ID

    @Volatile private var nTimesteps: Int = 4
    @Volatile private var temperature: Float = 0.667f
    @Volatile private var melMean: Float = -1.73840439f
    @Volatile private var melStd: Float = 2.35213526f
    @Volatile private var frameMultiple: Int = 2
    @Volatile private var nFft: Int = 1024
    @Volatile private var hopLength: Int = 256
    @Volatile private var melBins: Int = 100

    private val engineLock = ReentrantLock()
    private val stopRequested = AtomicBoolean(false)
    private val rng = Random(42L)

    fun isInitialized(): Boolean =
        textEncoderSession != null && flowDecoderSession != null && vocoderSession != null && symbolMap.isNotEmpty()

    fun setPreferredVoice(voiceId: String?) {
        currentVoiceId = sanitizeVoiceId(voiceId)
    }

    override suspend fun initialize(): Boolean = withContext(Dispatchers.IO) {
        engineLock.withLock {
            if (isInitialized()) return@withLock true
            val dir = modelDirProvider()
            val configFile = File(dir, "config.json")
            val textEncFile = File(dir, "onnx/text_encoder.onnx")
            val flowDecFile = File(dir, "onnx/flow_decoder.onnx")
            val vocoderFile = File(dir, "onnx/vocoder.onnx")

            if (!configFile.isFile || !textEncFile.isFile || !flowDecFile.isFile || !vocoderFile.isFile) {
                return@withLock false
            }

            var createdTextEnc: OrtSession? = null
            var createdFlowDec: OrtSession? = null
            var createdVocoder: OrtSession? = null
            try {
                parseConfig(configFile)
                if (symbolMap.isEmpty()) {
                    Log.w(TAG, "indic-tiny config.json has empty symbols table")
                    return@withLock false
                }

                val ortEnv = OrtEnvironment.getEnvironment()
                val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(2)
                val cpuThreads = minOf(4, maxOf(2, cores / 2))
                fun buildOpts(): OrtSession.SessionOptions = OrtSession.SessionOptions().apply {
                    setIntraOpNumThreads(cpuThreads)
                    setInterOpNumThreads(1)
                    setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
                }

                buildOpts().use { opts -> createdTextEnc = ortEnv.createSession(textEncFile.absolutePath, opts) }
                buildOpts().use { opts -> createdFlowDec = ortEnv.createSession(flowDecFile.absolutePath, opts) }
                buildOpts().use { opts -> createdVocoder = ortEnv.createSession(vocoderFile.absolutePath, opts) }

                env = ortEnv
                textEncoderSession = createdTextEnc
                flowDecoderSession = createdFlowDec
                vocoderSession = createdVocoder
                Log.i(TAG, "Initialized Indic-Tiny-TTS Hindi (sr=$sampleRate, steps=$nTimesteps, threads=$cpuThreads)")
                true
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to initialize Indic-Tiny-TTS Hindi", t)
                runCatching { createdTextEnc?.close() }
                runCatching { createdFlowDec?.close() }
                runCatching { createdVocoder?.close() }
                closeSessionsLocked()
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
            val teSession = textEncoderSession ?: return@withLock false
            val fdSession = flowDecoderSession ?: return@withLock false
            val vocSession = vocoderSession ?: return@withLock false

            val tokenIds = encodeTokens(cleaned)
            if (tokenIds.isEmpty()) return@withLock true

            try {
                val speakerId = if (currentVoiceId == VOICE_MALE) maleSpeakerId else femaleSpeakerId
                val (muX, muBins, logw, cond) = runTextEncoder(ortEnv, teSession, tokenIds, speakerId)
                if (stopRequested.get()) return@withLock false

                val tLen = tokenIds.size
                val durations = IntArray(tLen) { idx ->
                    val raw = exp(logw[idx].toDouble())
                    maxOf(1, ceil(raw).toInt())
                }
                val rawYLen = durations.sum().coerceIn(1, MAX_FRAMES)
                val mult = frameMultiple.coerceAtLeast(1)
                val yPad = ((rawYLen + mult - 1) / mult) * mult

                // Expand [1, muBins, T] -> [1, muBins, yPad]
                val muY = FloatArray(muBins * yPad)
                val yMask = FloatArray(yPad)
                var outFrame = 0
                for (tokIdx in 0 until tLen) {
                    val dur = durations[tokIdx]
                    for (d in 0 until dur) {
                        if (outFrame >= rawYLen) break
                        yMask[outFrame] = 1.0f
                        for (c in 0 until muBins) {
                            muY[c * yPad + outFrame] = muX[c * tLen + tokIdx]
                        }
                        outFrame++
                    }
                    if (outFrame >= rawYLen) break
                }

                val x = FloatArray(muBins * yPad)
                for (c in 0 until muBins) {
                    val rowBase = c * yPad
                    for (f in 0 until rawYLen) {
                        x[rowBase + f] = (rng.nextGaussian().toFloat()) * temperature
                    }
                }

                val steps = nTimesteps.coerceIn(1, 16)
                val dt = 1.0f / steps.toFloat()
                for (step in 0 until steps) {
                    if (stopRequested.get()) return@withLock false
                    val tScalar = step.toFloat() * dt
                    val vel = runFlowStep(ortEnv, fdSession, x, yMask, muY, cond, muBins, yPad, tScalar)
                    for (c in 0 until muBins) {
                        val rowBase = c * yPad
                        for (f in 0 until rawYLen) {
                            x[rowBase + f] += dt * vel[rowBase + f]
                        }
                    }
                }
                if (stopRequested.get()) return@withLock false

                // Crop & unnormalize mel to [1, muBins, rawYLen]
                val mel = FloatArray(muBins * rawYLen)
                for (c in 0 until muBins) {
                    val srcBase = c * yPad
                    val dstBase = c * rawYLen
                    for (f in 0 until rawYLen) {
                        mel[dstBase + f] = x[srcBase + f] * melStd + melMean
                    }
                }

                val (realStft, imagStft, nBins, stftFrames) = runVocoder(ortEnv, vocSession, mel, muBins, rawYLen)
                if (stopRequested.get()) return@withLock false

                val audio = complexStftToWaveform(realStft, imagStft, nBins, stftFrames)
                streamFloatAudioAsPcm16(audio, sampleRate, stopRequested, onPcmChunk)
            } catch (t: Throwable) {
                Log.e(TAG, "Indic-Tiny-TTS inference failed for clause $clauseId", t)
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
            closeSessionsLocked()
        }
    }

    private fun closeSessionsLocked() {
        runCatching { textEncoderSession?.close() }
        runCatching { flowDecoderSession?.close() }
        runCatching { vocoderSession?.close() }
        textEncoderSession = null
        flowDecoderSession = null
        vocoderSession = null
        symbolMap = emptyMap()
    }

    private data class TextEncOut(
        val muX: FloatArray,
        val bins: Int,
        val logw: FloatArray,
        val cond: FloatArray,
    )

    private fun runTextEncoder(
        ortEnv: OrtEnvironment,
        session: OrtSession,
        tokenIds: LongArray,
        speakerId: Long,
    ): TextEncOut {
        val len = tokenIds.size.toLong()
        val tokTensor = OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(tokenIds), longArrayOf(1L, len))
        val lenTensor = OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(longArrayOf(len)), longArrayOf(1L))
        val langTensor = OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(longArrayOf(languageId)), longArrayOf(1L))
        val spkTensor = OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(longArrayOf(speakerId)), longArrayOf(1L))
        val styTensor = OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(longArrayOf(styleId)), longArrayOf(1L))

        return try {
            val inputs = hashMapOf(
                "tokens" to tokTensor,
                "token_lengths" to lenTensor,
                "language" to langTensor,
                "speaker" to spkTensor,
                "style" to styTensor,
            )
            session.run(inputs).use { result ->
                val muTensor = result.get("mu_x").get() as OnnxTensor
                val muShape = muTensor.info.shape
                val bins = if (muShape.size >= 2 && muShape[1] > 0L) muShape[1].toInt() else melBins
                val muArr = extractFloats(muTensor)
                val logwArr = extractFloats(result.get("logw").get() as OnnxTensor)
                val condArr = extractFloats(result.get("cond").get() as OnnxTensor)
                TextEncOut(muArr, bins, logwArr, condArr)
            }
        } finally {
            tokTensor.close()
            lenTensor.close()
            langTensor.close()
            spkTensor.close()
            styTensor.close()
        }
    }

    private fun runFlowStep(
        ortEnv: OrtEnvironment,
        session: OrtSession,
        x: FloatArray,
        mask: FloatArray,
        mu: FloatArray,
        cond: FloatArray,
        bins: Int,
        frames: Int,
        tScalar: Float,
    ): FloatArray {
        val xTensor = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(x), longArrayOf(1L, bins.toLong(), frames.toLong()))
        val mTensor = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(mask), longArrayOf(1L, 1L, frames.toLong()))
        val muTensor = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(mu), longArrayOf(1L, bins.toLong(), frames.toLong()))
        val tTensor = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(floatArrayOf(tScalar)), longArrayOf(1L))
        val cTensor = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(cond), longArrayOf(1L, cond.size.toLong()))

        return try {
            val inputs = hashMapOf(
                "x" to xTensor,
                "mask" to mTensor,
                "mu" to muTensor,
                "t" to tTensor,
                "cond" to cTensor,
            )
            session.run(inputs).use { result ->
                val outTensor = (result.get("v").orElse(null) ?: result.get(0)) as OnnxTensor
                extractFloats(outTensor)
            }
        } finally {
            xTensor.close()
            mTensor.close()
            muTensor.close()
            tTensor.close()
            cTensor.close()
        }
    }

    private data class VocoderOut(
        val real: FloatArray,
        val imag: FloatArray,
        val nBins: Int,
        val frames: Int,
    )

    private fun runVocoder(
        ortEnv: OrtEnvironment,
        session: OrtSession,
        mel: FloatArray,
        bins: Int,
        frames: Int,
    ): VocoderOut {
        val melTensor = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(mel), longArrayOf(1L, bins.toLong(), frames.toLong()))
        return try {
            session.run(mapOf("mel" to melTensor)).use { result ->
                val realTensor = result.get("real").get() as OnnxTensor
                val imagTensor = result.get("imag").get() as OnnxTensor
                val rShape = realTensor.info.shape
                val nBins = if (rShape.size >= 2 && rShape[1] > 0L) rShape[1].toInt() else (nFft / 2 + 1)
                val outFrames = if (rShape.size >= 3 && rShape[2] > 0L) rShape[2].toInt() else frames
                VocoderOut(
                    real = extractFloats(realTensor),
                    imag = extractFloats(imagTensor),
                    nBins = nBins,
                    frames = outFrames,
                )
            }
        } finally {
            melTensor.close()
        }
    }

    /**
     * Exact center-padded periodic-Hann real ISTFT matching `vocoder.onnx` STFT heads (`n_fft=1024`, `hop=256`).
     */
    internal fun complexStftToWaveform(
        real: FloatArray,
        imag: FloatArray,
        nBins: Int,
        frames: Int,
    ): FloatArray {
        if (frames <= 0 || nBins <= 1) return FloatArray(0)
        val fftSize = nFft
        val hop = hopLength
        val half = fftSize / 2
        val paddedLen = (frames - 1) * hop + fftSize
        val out = DoubleArray(paddedLen)
        val winSq = DoubleArray(paddedLen)

        val hann = DoubleArray(fftSize) { n ->
            0.5 * (1.0 - cos(2.0 * PI * n / fftSize))
        }
        val frameRe = DoubleArray(fftSize)
        val frameIm = DoubleArray(fftSize)
        val validBins = minOf(nBins, half + 1)

        for (f in 0 until frames) {
            frameRe.fill(0.0)
            frameIm.fill(0.0)
            for (k in 0 until validBins) {
                val idx = k * frames + f
                val r = real[idx].toDouble()
                val im = imag[idx].toDouble()
                frameRe[k] = r
                frameIm[k] = im
                if (k in 1 until half) {
                    val mirror = fftSize - k
                    frameRe[mirror] = r
                    frameIm[mirror] = -im
                }
            }
            // Enforce purely real DC & Nyquist for safety
            frameIm[0] = 0.0
            if (half < fftSize) frameIm[half] = 0.0

            radix2IfftInPlace(frameRe, frameIm)

            val pos = f * hop
            for (n in 0 until fftSize) {
                val w = hann[n]
                out[pos + n] += frameRe[n] * w
                winSq[pos + n] += w * w
            }
        }

        val startTrim = half
        val endTrim = paddedLen - half
        if (endTrim <= startTrim) return FloatArray(0)
        val trimmed = FloatArray(endTrim - startTrim)
        for (i in startTrim until endTrim) {
            val denom = winSq[i]
            val v = if (denom > 1e-8) (out[i] / denom).toFloat() else 0.0f
            trimmed[i - startTrim] = v.coerceIn(-1.0f, 1.0f)
        }
        return trimmed
    }

    private fun radix2IfftInPlace(re: DoubleArray, im: DoubleArray) {
        val n = re.size
        // Bit-reversal permutation
        var j = 0
        for (i in 1 until n) {
            var bit = n shr 1
            while (j and bit != 0) {
                j = j xor bit
                bit = bit shr 1
            }
            j = j xor bit
            if (i < j) {
                val tr = re[i]; re[i] = re[j]; re[j] = tr
                val ti = im[i]; im[i] = im[j]; im[j] = ti
            }
        }
        // Cooley-Tukey inverse FFT (+2*pi*k*n/N)
        var len = 2
        while (len <= n) {
            val ang = 2.0 * PI / len
            val wLenRe = cos(ang)
            val wLenIm = sin(ang)
            var i = 0
            while (i < n) {
                var wRe = 1.0
                var wIm = 0.0
                val halfLen = len shr 1
                for (k in 0 until halfLen) {
                    val even = i + k
                    val odd = even + halfLen
                    val uRe = re[even]
                    val uIm = im[even]
                    val vRe = re[odd] * wRe - im[odd] * wIm
                    val vIm = re[odd] * wIm + im[odd] * wRe
                    re[even] = uRe + vRe
                    im[even] = uIm + vIm
                    re[odd] = uRe - vRe
                    im[odd] = uIm - vIm
                    val nextWRe = wRe * wLenRe - wIm * wLenIm
                    wIm = wRe * wLenIm + wIm * wLenRe
                    wRe = nextWRe
                }
                i += len
            }
            len = len shl 1
        }
        val invN = 1.0 / n.toDouble()
        for (i in 0 until n) {
            re[i] *= invN
        }
    }

    private fun encodeTokens(normalizedText: String): LongArray {
        val map = symbolMap
        val raw = ArrayList<Long>(normalizedText.length)
        for (ch in normalizedText) {
            val direct = map[ch]
            if (direct != null) {
                raw.add(direct)
                continue
            }
            val nfd = Normalizer.normalize(ch.toString(), Normalizer.Form.NFD)
            var matchedAny = false
            for (sub in nfd) {
                val subId = map[sub]
                if (subId != null) {
                    raw.add(subId)
                    matchedAny = true
                }
            }
            if (!matchedAny) {
                raw.add(unkId)
            }
        }
        if (raw.isEmpty()) return LongArray(0)
        if (!addBlank) return raw.toLongArray()

        val interspersed = LongArray(raw.size * 2 + 1)
        var outIdx = 0
        interspersed[outIdx++] = blankId
        for (id in raw) {
            interspersed[outIdx++] = id
            interspersed[outIdx++] = blankId
        }
        return interspersed
    }

    private fun parseConfig(file: File) {
        val json = JSONObject(file.readText(Charsets.UTF_8))
        sampleRate = json.optInt("sample_rate", DEFAULT_SAMPLE_RATE).coerceIn(8000, 48000)

        json.optJSONObject("languages")?.let { langs ->
            languageId = langs.optLong("hi", 1L)
        }
        json.optJSONObject("styles")?.let { styles ->
            styleId = styles.optLong("read", 0L)
        }
        val spkMap = json.optJSONObject("speakers")
        val voicesMap = json.optJSONObject("voices")
        if (spkMap != null) {
            val fTag = voicesMap?.optString("female", "hi_F") ?: "hi_F"
            val mTag = voicesMap?.optString("male", "hi_M") ?: "hi_M"
            femaleSpeakerId = spkMap.optLong(fTag, 2L)
            maleSpeakerId = spkMap.optLong(mTag, 3L)
        }

        val decodeObj = json.optJSONObject("decode")
        if (decodeObj != null) {
            nTimesteps = decodeObj.optInt("n_timesteps", 4)
            temperature = decodeObj.optDouble("temperature", 0.667).toFloat()
            frameMultiple = decodeObj.optInt("frame_multiple", 2)
            decodeObj.optJSONArray("mel_stats")?.let { stats ->
                if (stats.length() >= 2) {
                    melMean = stats.optDouble(0, -1.73840439).toFloat()
                    melStd = stats.optDouble(1, 2.35213526).toFloat()
                }
            }
        }

        val stftObj = json.optJSONObject("stft")
        if (stftObj != null) {
            nFft = stftObj.optInt("n_fft", 1024)
            hopLength = stftObj.optInt("hop_length", 256)
        }

        val modelObj = json.optJSONObject("model")
        if (modelObj != null) {
            melBins = modelObj.optInt("n_feats", 100)
        }

        val vocabObj = json.optJSONObject("vocab")
        addBlank = vocabObj?.optBoolean("add_blank", true) ?: true

        val symbolsArr = json.optJSONArray("symbols") ?: return
        val parsed = HashMap<Char, Long>(symbolsArr.length())
        for (i in 0 until symbolsArr.length()) {
            val sym = symbolsArr.optString(i, "")
            when {
                sym == "<blank>" -> blankId = i.toLong()
                sym == "<unk>" -> unkId = i.toLong()
                sym.startsWith("c:") && sym.length >= 3 -> parsed[sym[2]] = i.toLong()
            }
        }
        symbolMap = parsed
    }

    private fun extractFloats(tensor: OnnxTensor): FloatArray {
        val buf = tensor.floatBuffer
        buf.rewind()
        val arr = FloatArray(buf.remaining())
        buf.get(arr)
        return arr
    }

    companion object {
        private const val TAG = "IndicTinyHindiTts"
        const val ENGINE_NAME = "indic_tiny_hi"
        const val VOICE_FEMALE = "female"
        const val VOICE_MALE = "male"
        const val DEFAULT_VOICE_ID = VOICE_FEMALE
        private const val DEFAULT_SAMPLE_RATE = 24_000
        private const val CHANNELS = 1
        private const val CHUNK_MS = 80
        private const val MAX_FRAMES = 4000

        fun sanitizeVoiceId(raw: String?): String {
            return if (raw?.trim()?.lowercase() == VOICE_MALE) VOICE_MALE else VOICE_FEMALE
        }
    }
}
