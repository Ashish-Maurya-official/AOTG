package com.ashish.technologies.aotg.turbo_modules.liveaudio

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.util.Log
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.LongBuffer

/**
 * Wraps Silero VAD v5 (`[1, 576]` = 64 rolling context + 512 samples @ 16kHz)
 * with ONNX Runtime direct ByteBuffers (zero per-frame heap allocation of raw buffers).
 *
 * If `silero_vad.onnx` is not bundled in `assets/` or `${filesDir}/models/`,
 * `evaluate()` returns `-1f` so the C++ engine falls back cleanly to its built-in
 * adaptive energy+ZCR VAD.
 */
internal class SileroVadEngine(private val context: Context) {

    companion object {
        private const val TAG = "SileroVadEngine"
        private const val MODEL_FILE_NAME = "silero_vad.onnx"
        private const val SAMPLE_RATE = 16000L
        private const val INPUT_LEN = 576
        private const val STATE_SIZE = 2 * 1 * 128
    }

    private var env: OrtEnvironment? = null
    private var session: OrtSession? = null
    private var useScalarSr: Boolean = true

    private val inputByteBuf: ByteBuffer =
        ByteBuffer.allocateDirect(INPUT_LEN * 4).order(ByteOrder.nativeOrder())
    private val inputFloats: FloatBuffer = inputByteBuf.asFloatBuffer()

    private val stateByteBuf: ByteBuffer =
        ByteBuffer.allocateDirect(STATE_SIZE * 4).order(ByteOrder.nativeOrder())
    private val stateFloats: FloatBuffer = stateByteBuf.asFloatBuffer()

    private val srBuf: LongBuffer =
        ByteBuffer.allocateDirect(8).order(ByteOrder.nativeOrder()).asLongBuffer().apply {
            put(0, SAMPLE_RATE)
        }

    private val stateTmp = FloatArray(STATE_SIZE)

    @Volatile
    var isAvailable: Boolean = false
        private set

    fun initialize(): Boolean {
        if (isAvailable && session != null) return true
        return try {
            val modelBytes = loadModelBytes() ?: return false
            val ortEnv = OrtEnvironment.getEnvironment()
            val opts = OrtSession.SessionOptions().apply {
                setIntraOpNumThreads(1)
                setInterOpNumThreads(1)
                setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            }
            val ortSession = ortEnv.createSession(modelBytes, opts)
            opts.close()

            env = ortEnv
            session = ortSession
            resetState()
            isAvailable = true
            Log.i(TAG, "Silero VAD v5 ONNX session initialized")
            true
        } catch (t: Throwable) {
            Log.w(TAG, "Silero VAD v5 unavailable (using DSP fallback): ${t.message}")
            close()
            false
        }
    }

    fun resetState() {
        for (i in 0 until STATE_SIZE) {
            stateFloats.put(i, 0f)
        }
    }

    /**
     * Evaluates one `[1, 576]` window and updates recurrent `[2, 1, 128]` state in-place.
     * Returns speech probability `[0..1]`, or `-1f` when ONNX model is absent.
     */
    fun evaluate(samples576: FloatArray): Float {
        val ortEnv = env ?: return -1f
        val ortSession = session ?: return -1f
        if (!isAvailable || samples576.size != INPUT_LEN) return -1f

        inputFloats.clear()
        inputFloats.put(samples576)
        inputFloats.rewind()

        stateFloats.rewind()
        srBuf.rewind()

        var inputTensor: OnnxTensor? = null
        var stateTensor: OnnxTensor? = null
        var srTensor: OnnxTensor? = null
        var result: OrtSession.Result? = null

        return try {
            inputTensor = OnnxTensor.createTensor(ortEnv, inputFloats, longArrayOf(1L, INPUT_LEN.toLong()))
            stateTensor = OnnxTensor.createTensor(ortEnv, stateFloats, longArrayOf(2L, 1L, 128L))
            srTensor = createSrTensor(ortEnv)

            result = try {
                ortSession.run(
                    mapOf(
                        "input" to inputTensor,
                        "state" to stateTensor,
                        "sr" to srTensor
                    )
                )
            } catch (e: Throwable) {
                if (useScalarSr) {
                    useScalarSr = false
                    srTensor.close()
                    srTensor = OnnxTensor.createTensor(ortEnv, srBuf, longArrayOf(1L))
                    ortSession.run(
                        mapOf(
                            "input" to inputTensor,
                            "state" to stateTensor,
                            "sr" to srTensor
                        )
                    )
                } else {
                    throw e
                }
            }

            val prob = extractProbability(result)
            extractNextState(result)
            prob
        } catch (t: Throwable) {
            Log.w(TAG, "Silero VAD inference error: ${t.message}")
            -1f
        } finally {
            try { result?.close() } catch (_: Throwable) {}
            try { inputTensor?.close() } catch (_: Throwable) {}
            try { stateTensor?.close() } catch (_: Throwable) {}
            try { srTensor?.close() } catch (_: Throwable) {}
        }
    }

    private fun createSrTensor(ortEnv: OrtEnvironment): OnnxTensor {
        val shape = if (useScalarSr) LongArray(0) else longArrayOf(1L)
        return OnnxTensor.createTensor(ortEnv, srBuf, shape)
    }

    private fun extractProbability(result: OrtSession.Result): Float {
        val tensor = result.get(0) as? OnnxTensor
        val fb = tensor?.floatBuffer
        if (fb != null && fb.remaining() > 0) {
            return fb.get(fb.position())
        }
        val outVal = result.get(0)?.value ?: return 0f
        return when (outVal) {
            is Array<*> -> (outVal.firstOrNull() as? FloatArray)?.firstOrNull() ?: 0f
            is FloatArray -> outVal.firstOrNull() ?: 0f
            else -> 0f
        }
    }

    private fun extractNextState(result: OrtSession.Result) {
        if (result.size() < 2) return
        val tensor = result.get(1) as? OnnxTensor
        val fb = tensor?.floatBuffer
        if (fb != null && fb.remaining() >= STATE_SIZE) {
            val dup = fb.duplicate()
            dup.rewind()
            dup.limit(STATE_SIZE)
            stateFloats.clear()
            stateFloats.put(dup)
            stateFloats.rewind()
            return
        }
        val nextVal = result.get(1)?.value ?: return
        val flat = when (nextVal) {
            is Array<*> -> {
                var idx = 0
                for (a in nextVal) {
                    val bArr = a as? Array<*> ?: continue
                    for (b in bArr) {
                        val cArr = b as? FloatArray ?: continue
                        val count = minOf(cArr.size, STATE_SIZE - idx)
                        System.arraycopy(cArr, 0, stateTmp, idx, count)
                        idx += count
                    }
                }
                idx == STATE_SIZE
            }
            is FloatArray -> {
                val count = minOf(nextVal.size, STATE_SIZE)
                System.arraycopy(nextVal, 0, stateTmp, 0, count)
                count == STATE_SIZE
            }
            else -> false
        }
        if (flat) {
            stateFloats.clear()
            stateFloats.put(stateTmp)
            stateFloats.rewind()
        }
    }

    private fun loadModelBytes(): ByteArray? {
        val localFile = File(File(context.filesDir, "models"), MODEL_FILE_NAME)
        if (localFile.exists() && localFile.length() > 0L) {
            return localFile.readBytes()
        }
        return try {
            context.assets.open(MODEL_FILE_NAME).use { it.readBytes() }
        } catch (_: Throwable) {
            null
        }
    }

    fun hasBundledOrLocalModel(): Boolean {
        val localFile = File(File(context.filesDir, "models"), MODEL_FILE_NAME)
        if (localFile.exists() && localFile.length() > 0L) return true
        return try {
            context.assets.open(MODEL_FILE_NAME).use { true }
        } catch (_: Throwable) {
            false
        }
    }

    fun close() {
        isAvailable = false
        try { session?.close() } catch (_: Throwable) {}
        session = null
        env = null
    }
}
