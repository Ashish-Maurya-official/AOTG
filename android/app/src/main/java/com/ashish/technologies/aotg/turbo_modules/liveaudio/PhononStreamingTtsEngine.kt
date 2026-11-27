package com.ashish.technologies.aotg.turbo_modules.liveaudio

import ai.onnxruntime.OnnxJavaType
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.util.Random
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.sqrt

/**
 * On-device neural CPU TTS engine powered by `ai-ecoverse/phonon-31m-en-ONNX`
 * (Apache-2.0) running on ONNX Runtime CPU threads so LiteRT-LM owns GPU/NPU
 * without delegate contention.
 *
 * Implements the existing [StreamingTtsEngine] contract and emits 24 kHz mono
 * PCM16 audio one 80 ms Mimi frame (1,920 samples) at a time directly into
 * [OboeAudioEngine]'s lock-free playback ring buffer.
 */
internal class PhononStreamingTtsEngine(
    private val modelManager: PhononModelManager,
) : StreamingTtsEngine {

    private data class TensorPayload(
        val floats: FloatArray? = null,
        val longs: LongArray? = null,
        val shape: LongArray,
    ) {
        fun createTensor(env: OrtEnvironment): OnnxTensor {
            return if (floats != null) {
                OnnxTensor.createTensor(env, FloatBuffer.wrap(floats), shape)
            } else {
                OnnxTensor.createTensor(env, LongBuffer.wrap(longs ?: LongArray(0)), shape)
            }
        }
    }

    private data class VoiceKvSnapshot(
        val voiceId: String,
        val kvEntries: Map<String, TensorPayload>,
    )

    override val name: String = ENGINE_NAME

    private val engineLock = ReentrantLock()
    private val stopRequested = AtomicBoolean(false)
    private val rng = Random()

    @Volatile
    private var env: OrtEnvironment? = null

    @Volatile
    private var textCondSession: OrtSession? = null

    @Volatile
    private var flowMainSession: OrtSession? = null

    @Volatile
    private var flowStepSession: OrtSession? = null

    @Volatile
    private var mimiSession: OrtSession? = null

    @Volatile
    private var tokenizer: PhononTokenizer? = null

    @Volatile
    private var activeVariant: String? = null

    @Volatile
    private var currentVoiceId: String = PhononModelManager.DEFAULT_VOICE_ID

    @Volatile
    private var cachedVoiceKv: VoiceKvSnapshot? = null

    @Volatile
    private var lastError: String? = null

    private var eosThreshold: Float = 4.0f
    private var temperature: Float = 0.8f
    private var embedDim: Int = 512
    private var latentDim: Int = 32
    private var numLayers: Int = 6
    private var numHeads: Int = 8
    private var headDim: Int = 64

    fun isInitialized(): Boolean =
        textCondSession != null && flowMainSession != null && flowStepSession != null && mimiSession != null && tokenizer != null

    fun getLastError(): String? = lastError

    fun getActiveVariant(): String? = activeVariant

    fun getSelectedVoiceId(): String = currentVoiceId

    fun setPreferredVoiceId(voiceId: String) {
        val clean = PhononModelManager.sanitizeVoiceId(voiceId)
        if (clean != currentVoiceId) {
            currentVoiceId = clean
            cachedVoiceKv = null
        }
    }

    override suspend fun initialize(): Boolean = withContext(Dispatchers.IO) {
        engineLock.withLock {
            if (isInitialized()) {
                val targetVoice = currentVoiceId
                if (cachedVoiceKv?.voiceId != targetVoice && modelManager.isVoiceDownloaded(targetVoice)) {
                    runCatching { prewarmVoiceKvLocked(targetVoice) }
                }
                return@withContext true
            }

            val variant = modelManager.getInstalledVariant()
            if (variant == null) {
                lastError = "Phonon-31M model files are not downloaded yet."
                return@withContext false
            }

            var createdTextCond: OrtSession? = null
            var createdFlowMain: OrtSession? = null
            var createdFlowStep: OrtSession? = null
            var createdMimi: OrtSession? = null

            try {
                lastError = null
                val configFile = modelManager.getConfigFile()
                parseConfig(configFile)

                val tok = PhononTokenizer.fromFile(modelManager.getTokenizerFile())
                val ortEnv = OrtEnvironment.getEnvironment()
                val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(2)
                val cpuThreads = minOf(4, maxOf(2, cores / 2))

                fun createCpuSessionOptions(): OrtSession.SessionOptions {
                    return OrtSession.SessionOptions().apply {
                        setIntraOpNumThreads(cpuThreads)
                        setInterOpNumThreads(1)
                        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
                    }
                }

                createCpuSessionOptions().use { opts ->
                    createdTextCond = ortEnv.createSession(modelManager.getTextConditionerFile().absolutePath, opts)
                }
                createCpuSessionOptions().use { opts ->
                    createdFlowMain = ortEnv.createSession(modelManager.getFlowMainFile(variant).absolutePath, opts)
                }
                createCpuSessionOptions().use { opts ->
                    createdFlowStep = ortEnv.createSession(modelManager.getFlowStepFile(variant).absolutePath, opts)
                }
                createCpuSessionOptions().use { opts ->
                    createdMimi = ortEnv.createSession(modelManager.getMimiDecoderFile().absolutePath, opts)
                }

                detectFlowDimensions(createdFlowMain!!)

                env = ortEnv
                tokenizer = tok
                textCondSession = createdTextCond
                flowMainSession = createdFlowMain
                flowStepSession = createdFlowStep
                mimiSession = createdMimi
                activeVariant = variant

                val voiceToWarm = when {
                    modelManager.isVoiceDownloaded(currentVoiceId) -> currentVoiceId
                    else -> modelManager.getDownloadedVoiceIds().firstOrNull()
                }
                if (voiceToWarm != null) {
                    currentVoiceId = voiceToWarm
                    prewarmVoiceKvLocked(voiceToWarm)
                }

                Log.i(TAG, "Initialized Phonon-31M ($variant) with $cpuThreads CPU threads, voice=$currentVoiceId")
                true
            } catch (t: Throwable) {
                lastError = t.message ?: "Failed to load Phonon-31M ONNX sessions."
                Log.e(TAG, "Failed to initialize Phonon-31M ($variant)", t)
                runCatching { createdTextCond?.close() }
                runCatching { createdFlowMain?.close() }
                runCatching { createdFlowStep?.close() }
                runCatching { createdMimi?.close() }
                closeSessionsLocked()
                false
            }
        }
    }

    suspend fun switchVoice(voiceId: String): Boolean {
        val clean = PhononModelManager.sanitizeVoiceId(voiceId)
        if (!modelManager.isVoiceDownloaded(clean)) {
            val ok = modelManager.ensureVoiceDownloaded(clean)
            if (!ok) return false
        }
        return withContext(Dispatchers.IO) {
            engineLock.withLock {
                currentVoiceId = clean
                cachedVoiceKv = null
                if (isInitialized()) {
                    runCatching { prewarmVoiceKvLocked(clean) }.isSuccess
                } else {
                    true
                }
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
        val cleaned = clauseText.trim()
        if (cleaned.isEmpty()) return true

        stopRequested.set(false)

        return engineLock.withLock {
            if (stopRequested.get()) return@withLock false
            val ortEnv = env ?: return@withLock false
            val tok = tokenizer ?: return@withLock false
            val tcSession = textCondSession ?: return@withLock false
            val fmSession = flowMainSession ?: return@withLock false
            val fsSession = flowStepSession ?: return@withLock false
            val mdSession = mimiSession ?: return@withLock false

            try {
                val voiceKv = ensureVoiceSnapshotLocked(currentVoiceId) ?: return@withLock false
                val chunks = PhononTextNormalizer.planChunks(tok, cleaned, FRAME_RATE_HZ)
                if (chunks.isEmpty()) return@withLock true

                val noiseStd = sqrt(temperature.toDouble().coerceAtLeast(1e-4)).toFloat()

                for (chunk in chunks) {
                    if (stopRequested.get()) return@withLock false
                    if (chunk.tokens.isEmpty()) continue

                    val ok = synthesizeSingleChunkLocked(
                        env = ortEnv,
                        tcSession = tcSession,
                        fmSession = fmSession,
                        fsSession = fsSession,
                        mdSession = mdSession,
                        voiceKv = voiceKv,
                        chunk = chunk,
                        noiseStd = noiseStd,
                        onPcmChunk = onPcmChunk,
                    )
                    if (!ok) return@withLock false
                }
                true
            } catch (t: Throwable) {
                lastError = t.message ?: "Phonon-31M synthesis failed."
                Log.e(TAG, "Error synthesizing clause $clauseId (epoch=$turnEpoch)", t)
                false
            }
        }
    }

    override fun stopCurrent() {
        stopRequested.set(true)
    }

    fun releaseMemoryIfIdle() {
        if (engineLock.tryLock()) {
            try {
                closeSessionsLocked()
            } finally {
                engineLock.unlock()
            }
        }
    }

    override fun shutdown() {
        stopRequested.set(true)
        engineLock.withLock {
            closeSessionsLocked()
        }
    }

    private fun closeSessionsLocked() {
        runCatching { textCondSession?.close() }
        runCatching { flowMainSession?.close() }
        runCatching { flowStepSession?.close() }
        runCatching { mimiSession?.close() }
        textCondSession = null
        flowMainSession = null
        flowStepSession = null
        mimiSession = null
        tokenizer = null
        cachedVoiceKv = null
        activeVariant = null
    }

    private fun parseConfig(configFile: File) {
        if (!configFile.isFile) return
        val json = JSONObject(configFile.readText(Charsets.UTF_8))
        eosThreshold = json.optDouble("eos_threshold", eosThreshold.toDouble()).toFloat()
        temperature = json.optDouble("temp", temperature.toDouble()).toFloat()
        val onnxObj = json.optJSONObject("onnx") ?: return
        numLayers = onnxObj.optInt("num_layers", numLayers)
        numHeads = onnxObj.optInt("num_heads", numHeads)
        headDim = onnxObj.optInt("head_dim", headDim)
        latentDim = onnxObj.optInt("latent_dim", latentDim)
        embedDim = numHeads * headDim
    }

    private fun detectFlowDimensions(fmSession: OrtSession) {
        var detectedLayers = 0
        while (fmSession.inputNames.contains("past_key_values.$detectedLayers.key")) {
            detectedLayers++
        }
        if (detectedLayers > 0) {
            numLayers = detectedLayers
        }
        val keyInfo = fmSession.inputInfo["past_key_values.0.key"]?.info as? TensorInfo
        if (keyInfo != null && keyInfo.shape.size == 4) {
            if (keyInfo.shape[1] > 0) numHeads = keyInfo.shape[1].toInt()
            if (keyInfo.shape[3] > 0) headDim = keyInfo.shape[3].toInt()
            embedDim = numHeads * headDim
        }
    }

    private fun ensureVoiceSnapshotLocked(voiceId: String): VoiceKvSnapshot? {
        cachedVoiceKv?.let { if (it.voiceId == voiceId) return it }
        val resolvedVoice = if (modelManager.isVoiceDownloaded(voiceId)) {
            voiceId
        } else {
            modelManager.getDownloadedVoiceIds().firstOrNull() ?: return null
        }
        currentVoiceId = resolvedVoice
        return prewarmVoiceKvLocked(resolvedVoice)
    }

    private fun prewarmVoiceKvLocked(voiceId: String): VoiceKvSnapshot {
        val ortEnv = env ?: error("ORT environment not initialized")
        val fmSession = flowMainSession ?: error("flow_lm_main session not initialized")
        val voiceFile = modelManager.getVoiceFile(voiceId)
        val rawBytes = voiceFile.readBytes()
        val floatCount = rawBytes.size / 4
        require(floatCount >= embedDim && (floatCount % embedDim) == 0) {
            "Invalid voice embedding file size for $voiceId: ${rawBytes.size} bytes"
        }

        val voiceFrames = floatCount / embedDim
        val voiceFloats = FloatArray(floatCount)
        ByteBuffer.wrap(rawBytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(voiceFloats)

        val emptyPast = HashMap<String, TensorPayload>(numLayers * 2)
        val emptyShape = longArrayOf(1L, numHeads.toLong(), 0L, headDim.toLong())
        for (layer in 0 until numLayers) {
            emptyPast["past_key_values.$layer.key"] = TensorPayload(floats = FloatArray(0), shape = emptyShape)
            emptyPast["past_key_values.$layer.value"] = TensorPayload(floats = FloatArray(0), shape = emptyShape)
        }

        val nextKv = runFlowMainStep(
            env = ortEnv,
            fmSession = fmSession,
            inputsEmbeds = TensorPayload(
                floats = voiceFloats,
                shape = longArrayOf(1L, voiceFrames.toLong(), embedDim.toLong()),
            ),
            pastKv = emptyPast,
        ).second

        val snapshot = VoiceKvSnapshot(voiceId = voiceId, kvEntries = nextKv)
        cachedVoiceKv = snapshot
        return snapshot
    }

    private fun synthesizeSingleChunkLocked(
        env: OrtEnvironment,
        tcSession: OrtSession,
        fmSession: OrtSession,
        fsSession: OrtSession,
        mdSession: OrtSession,
        voiceKv: VoiceKvSnapshot,
        chunk: PhononChunkPlan,
        noiseStd: Float,
        onPcmChunk: (pcm16Bytes: ByteArray, sampleRate: Int, channels: Int) -> Boolean,
    ): Boolean {
        // 1. Run text_conditioner -> (inputs_embeds, bos_embeds)
        val (textEmbeds, bosEmbeds) = runTextConditioner(env, tcSession, chunk.tokens)

        // 2. Prompt flow_lm_main with text embeddings atop cached voice KV state
        var kvState = runFlowMainStep(
            env = env,
            fmSession = fmSession,
            inputsEmbeds = textEmbeds,
            pastKv = voiceKv.kvEntries,
        ).second

        // 3. Initialize Mimi streaming decoder state (zeros) and offset
        var offset = 0L
        val offsetShape = (mdSession.inputInfo["offset"]?.info as? TensorInfo)?.shape ?: longArrayOf()
        var mimiState = createInitialMimiState(mdSession)

        var stepEmbed = bosEmbeds
        var eosStep: Int? = null
        val maxFrames = chunk.frameBudget.coerceAtLeast(8)
        val hiddenInputShape = (fsSession.inputInfo["hidden"]?.info as? TensorInfo)?.shape
            ?: longArrayOf(1L, embedDim.toLong())

        for (step in 0 until maxFrames) {
            if (stopRequested.get()) return false

            // 4a. Autoregressive flow_lm_main step -> (hidden, eos_logit, updated KV)
            val (mainOut, updatedKv) = runFlowMainStep(
                env = env,
                fmSession = fmSession,
                inputsEmbeds = stepEmbed,
                pastKv = kvState,
            )
            kvState = updatedKv

            if (eosStep == null && mainOut.eosLogit > eosThreshold) {
                eosStep = step
            }

            if (stopRequested.get()) return false

            // 4b. Flow sampling head -> (latent [1,1,32], next_embeds [1,1,512])
            val (latentPayload, nextEmbedsPayload) = runFlowStep(
                env = env,
                fsSession = fsSession,
                hidden = mainOut.hidden,
                hiddenShape = hiddenInputShape,
                noiseStd = noiseStd,
            )
            stepEmbed = nextEmbedsPayload

            if (stopRequested.get()) return false

            // 4c. Mimi streaming vocoder -> 1,920 float32 samples (80 ms @ 24 kHz)
            val mimiOut = runMimiStep(
                env = env,
                mdSession = mdSession,
                latent = latentPayload,
                offset = offset,
                offsetShape = offsetShape,
                state = mimiState,
            )
            offset = mimiOut.nextOffset
            mimiState = mimiOut.nextState

            val pcmBytes = floatAudioToPcm16(mimiOut.audioSamples)
            if (!onPcmChunk(pcmBytes, SAMPLE_RATE, CHANNELS)) {
                return false
            }

            if (eosStep != null && step >= eosStep + chunk.framesAfterEos) {
                break
            }
        }
        return true
    }

    private fun runTextConditioner(
        env: OrtEnvironment,
        tcSession: OrtSession,
        tokens: IntArray,
    ): Pair<TensorPayload, TensorPayload> {
        val idsLong = LongArray(tokens.size) { tokens[it].toLong() }
        val inputIdsTensor = OnnxTensor.createTensor(
            env,
            LongBuffer.wrap(idsLong),
            longArrayOf(1L, tokens.size.toLong()),
        )
        val deltaTensor = OnnxTensor.createTensor(
            env,
            FloatBuffer.wrap(floatArrayOf(0.0f)),
            longArrayOf(1L),
        )
        return try {
            val inputs = HashMap<String, OnnxTensor>(2)
            inputs["input_ids"] = inputIdsTensor
            if (tcSession.inputNames.contains("duration_delta")) {
                inputs["duration_delta"] = deltaTensor
            }
            tcSession.run(inputs).use { result ->
                val embedsTensor = result.get("inputs_embeds").get() as OnnxTensor
                val bosTensor = result.get("bos_embeds").get() as OnnxTensor
                extractFloatPayload(embedsTensor) to extractFloatPayload(bosTensor)
            }
        } finally {
            inputIdsTensor.close()
            deltaTensor.close()
        }
    }

    private data class FlowMainOutputs(
        val hidden: FloatArray,
        val eosLogit: Float,
    )

    private fun runFlowMainStep(
        env: OrtEnvironment,
        fmSession: OrtSession,
        inputsEmbeds: TensorPayload,
        pastKv: Map<String, TensorPayload>,
    ): Pair<FlowMainOutputs, Map<String, TensorPayload>> {
        val openTensors = ArrayList<OnnxTensor>(1 + pastKv.size)
        return try {
            val inputs = HashMap<String, OnnxTensor>(1 + pastKv.size)
            val embedsTensor = inputsEmbeds.createTensor(env)
            openTensors.add(embedsTensor)
            inputs["inputs_embeds"] = embedsTensor

            for ((name, payload) in pastKv) {
                val tensor = payload.createTensor(env)
                openTensors.add(tensor)
                inputs[name] = tensor
            }

            fmSession.run(inputs).use { result ->
                val hiddenTensor = result.get("hidden").get() as OnnxTensor
                val hiddenPayload = extractFloatPayload(hiddenTensor)

                val eosTensor = result.get("eos_logit").get() as OnnxTensor
                val eosBuf = eosTensor.floatBuffer
                eosBuf.rewind()
                val eosLogit = if (eosBuf.hasRemaining()) eosBuf.get() else Float.NEGATIVE_INFINITY

                val nextKv = HashMap<String, TensorPayload>(numLayers * 2)
                for (layer in 0 until numLayers) {
                    val presentKey = result.get("present.$layer.key").get() as OnnxTensor
                    val presentValue = result.get("present.$layer.value").get() as OnnxTensor
                    nextKv["past_key_values.$layer.key"] = extractFloatPayload(presentKey)
                    nextKv["past_key_values.$layer.value"] = extractFloatPayload(presentValue)
                }

                FlowMainOutputs(hidden = hiddenPayload.floats ?: FloatArray(0), eosLogit = eosLogit) to nextKv
            }
        } finally {
            for (tensor in openTensors) {
                runCatching { tensor.close() }
            }
        }
    }

    private fun runFlowStep(
        env: OrtEnvironment,
        fsSession: OrtSession,
        hidden: FloatArray,
        hiddenShape: LongArray,
        noiseStd: Float,
    ): Pair<TensorPayload, TensorPayload> {
        val effectiveHiddenShape = if (hiddenShape.size == 3) {
            longArrayOf(1L, 1L, hidden.size.toLong())
        } else {
            longArrayOf(1L, hidden.size.toLong())
        }
        val noise = FloatArray(latentDim) { (rng.nextGaussian().toFloat()) * noiseStd }

        val hiddenTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(hidden), effectiveHiddenShape)
        val noiseTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(noise), longArrayOf(1L, latentDim.toLong()))
        val deltaTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(floatArrayOf(0.0f)), longArrayOf(1L))

        return try {
            val inputs = HashMap<String, OnnxTensor>(3)
            inputs["hidden"] = hiddenTensor
            inputs["noise"] = noiseTensor
            if (fsSession.inputNames.contains("duration_delta")) {
                inputs["duration_delta"] = deltaTensor
            }
            fsSession.run(inputs).use { result ->
                val latentTensor = result.get("latent").get() as OnnxTensor
                val nextEmbedsTensor = result.get("next_embeds").get() as OnnxTensor
                extractFloatPayload(latentTensor) to extractFloatPayload(nextEmbedsTensor)
            }
        } finally {
            hiddenTensor.close()
            noiseTensor.close()
            deltaTensor.close()
        }
    }

    private data class MimiOutputs(
        val audioSamples: FloatArray,
        val nextOffset: Long,
        val nextState: Map<String, TensorPayload>,
    )

    private fun createInitialMimiState(mdSession: OrtSession): Map<String, TensorPayload> {
        val stateMap = HashMap<String, TensorPayload>(16)
        for ((name, nodeInfo) in mdSession.inputInfo) {
            if (!name.startsWith("state.")) continue
            val tInfo = nodeInfo.info as? TensorInfo ?: continue
            val concreteShape = LongArray(tInfo.shape.size) { idx ->
                val dim = tInfo.shape[idx]
                if (dim > 0L) dim else 1L
            }
            val count = concreteShape.fold(1L) { acc, d -> acc * d }.toInt().coerceAtLeast(0)
            stateMap[name] = if (tInfo.type == OnnxJavaType.INT64) {
                TensorPayload(longs = LongArray(count), shape = concreteShape)
            } else {
                TensorPayload(floats = FloatArray(count), shape = concreteShape)
            }
        }
        return stateMap
    }

    private fun runMimiStep(
        env: OrtEnvironment,
        mdSession: OrtSession,
        latent: TensorPayload,
        offset: Long,
        offsetShape: LongArray,
        state: Map<String, TensorPayload>,
    ): MimiOutputs {
        val openTensors = ArrayList<OnnxTensor>(2 + state.size)
        return try {
            val inputs = HashMap<String, OnnxTensor>(2 + state.size)
            val latentTensor = latent.createTensor(env)
            openTensors.add(latentTensor)
            inputs["latent"] = latentTensor

            val offsetTensor = OnnxTensor.createTensor(
                env,
                LongBuffer.wrap(longArrayOf(offset)),
                offsetShape,
            )
            openTensors.add(offsetTensor)
            inputs["offset"] = offsetTensor

            for ((name, payload) in state) {
                val tensor = payload.createTensor(env)
                openTensors.add(tensor)
                inputs[name] = tensor
            }

            mdSession.run(inputs).use { result ->
                val audioTensor = result.get("audio").get() as OnnxTensor
                val audioPayload = extractFloatPayload(audioTensor)

                val nextOffsetTensor = result.get("next_offset").get() as OnnxTensor
                val nextOffsetBuf = nextOffsetTensor.longBuffer
                nextOffsetBuf.rewind()
                val nextOffset = if (nextOffsetBuf.hasRemaining()) nextOffsetBuf.get() else (offset + 1L)

                val nextState = HashMap<String, TensorPayload>(state.size)
                for (stateName in state.keys) {
                    val outName = "next_$stateName"
                    val outTensor = result.get(outName).get() as OnnxTensor
                    nextState[stateName] = if (outTensor.info.type == OnnxJavaType.INT64) {
                        extractLongPayload(outTensor)
                    } else {
                        extractFloatPayload(outTensor)
                    }
                }

                MimiOutputs(
                    audioSamples = audioPayload.floats ?: FloatArray(0),
                    nextOffset = nextOffset,
                    nextState = nextState,
                )
            }
        } finally {
            for (tensor in openTensors) {
                runCatching { tensor.close() }
            }
        }
    }

    private fun extractFloatPayload(tensor: OnnxTensor): TensorPayload {
        val shape = tensor.info.shape
        val buf = tensor.floatBuffer
        buf.rewind()
        val arr = FloatArray(buf.remaining())
        buf.get(arr)
        return TensorPayload(floats = arr, shape = shape)
    }

    private fun extractLongPayload(tensor: OnnxTensor): TensorPayload {
        val shape = tensor.info.shape
        val buf = tensor.longBuffer
        buf.rewind()
        val arr = LongArray(buf.remaining())
        buf.get(arr)
        return TensorPayload(longs = arr, shape = shape)
    }

    private fun floatAudioToPcm16(samples: FloatArray): ByteArray {
        val buffer = ByteArray(samples.size * 2)
        var pos = 0
        for (sample in samples) {
            val clamped = sample.coerceIn(-1.0f, 1.0f)
            val s = (clamped * 32767.0f).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            buffer[pos++] = (s and 0xFF).toByte()
            buffer[pos++] = ((s ushr 8) and 0xFF).toByte()
        }
        return buffer
    }

    companion object {
        private const val TAG = "PhononTtsEngine"
        const val ENGINE_NAME = "phonon_31m"
        const val SAMPLE_RATE = 24_000
        const val CHANNELS = 1
        private const val FRAME_RATE_HZ = 12.5f
    }
}
