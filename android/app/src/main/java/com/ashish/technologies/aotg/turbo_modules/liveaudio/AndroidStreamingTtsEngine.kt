package com.ashish.technologies.aotg.turbo_modules.liveaudio

import android.content.Context
import android.media.AudioFormat
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred

/**
 * OS-Native TextToSpeech provider implementing [StreamingTtsEngine].
 *
 * Captures real-time PCM buffers via `UtteranceProgressListener.onAudioAvailable`
 * (API 24+) while satisfying `synthesizeToFile` OEM file-seek guarantees via a
 * scoped temp cache file (immediately deleted in `finally`). If an OEM TTS engine
 * skips `onAudioAvailable`, falls back cleanly to reading the generated WAV bytes.
 */
internal class AndroidStreamingTtsEngine(private val context: Context) : StreamingTtsEngine {

    companion object {
        private const val TAG = "AndroidStreamingTts"
        private const val INIT_TIMEOUT_SEC = 5L
        private const val CLAUSE_TIMEOUT_SEC = 20L
    }

    override val name: String = "android_tts"

    private class ActiveUtterance(
        val onPcmChunk: (ByteArray, Int, Int) -> Boolean,
        val onFallbackWav: (ByteArray) -> Boolean,
        val tempFile: File
    ) {
        @Volatile var sampleRate: Int = 24000
        @Volatile var audioFormat: Int = AudioFormat.ENCODING_PCM_16BIT
        @Volatile var channels: Int = 1
        @Volatile var receivedStreamingAudio: Boolean = false
        val cancelled = AtomicBoolean(false)
        val completion = CompletableFuture<Boolean>()
    }

    @Volatile private var tts: TextToSpeech? = null
    @Volatile private var isReady: Boolean = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val seqCounter = AtomicInteger(0)
    private val activeUtterances = ConcurrentHashMap<String, ActiveUtterance>()
    @Volatile private var currentUtterance: ActiveUtterance? = null

    private fun getTtsCacheDir(): File {
        val dir = File(context.cacheDir, "live_tts_tmp")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    override suspend fun initialize(): Boolean {
        if (isReady && tts != null) return true

        val initResult = CompletableDeferred<Boolean>()
        val createdInstance = CompletableDeferred<TextToSpeech?>()

        mainHandler.post {
            try {
                var instance: TextToSpeech? = null
                instance = TextToSpeech(context.applicationContext) { status ->
                    if (status == TextToSpeech.SUCCESS) {
                        try {
                            val localeRes = instance?.setLanguage(Locale.getDefault())
                            if (localeRes == TextToSpeech.LANG_MISSING_DATA ||
                                localeRes == TextToSpeech.LANG_NOT_SUPPORTED
                            ) {
                                instance?.setLanguage(Locale.US)
                            }
                            instance?.setSpeechRate(1.03f)
                            instance?.setPitch(1.0f)
                            initResult.complete(true)
                        } catch (t: Throwable) {
                            Log.w(TAG, "TTS configuration error: ${t.message}")
                            initResult.complete(false)
                        }
                    } else {
                        Log.w(TAG, "TextToSpeech init failed with status=$status")
                        initResult.complete(false)
                    }
                }
                createdInstance.complete(instance)
            } catch (t: Throwable) {
                Log.w(TAG, "TextToSpeech main-thread construction error: ${t.message}")
                createdInstance.complete(null)
                initResult.complete(false)
            }
        }

        val instance = try {
            kotlinx.coroutines.withTimeoutOrNull(INIT_TIMEOUT_SEC * 1000L) {
                createdInstance.await()
            }
        } catch (_: Throwable) {
            null
        } ?: return false

        instance.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit

            override fun onBeginSynthesis(
                utteranceId: String?,
                sampleRateInHz: Int,
                audioFormat: Int,
                channelCount: Int
            ) {
                val utt = utteranceId?.let { activeUtterances[it] } ?: return
                if (sampleRateInHz >= 8000) utt.sampleRate = sampleRateInHz
                utt.audioFormat = audioFormat
                utt.channels = maxOf(1, channelCount)
            }

            override fun onAudioAvailable(utteranceId: String?, audio: ByteArray?) {
                val utt = utteranceId?.let { activeUtterances[it] } ?: return
                if (utt.cancelled.get() || audio == null || audio.isEmpty()) return
                utt.receivedStreamingAudio = true

                val pcm16Bytes = normalizeToPcm16(audio, utt.audioFormat)
                if (pcm16Bytes.isNotEmpty()) {
                    val keepGoing = utt.onPcmChunk(pcm16Bytes, utt.sampleRate, utt.channels)
                    if (!keepGoing) {
                        utt.cancelled.set(true)
                        utt.completion.complete(false)
                    }
                }
            }

            override fun onDone(utteranceId: String?) {
                val utt = utteranceId?.let { activeUtterances[it] } ?: return
                if (!utt.cancelled.get() && !utt.receivedStreamingAudio && utt.tempFile.exists() && utt.tempFile.length() > 44L) {
                    try {
                        val bytes = utt.tempFile.readBytes()
                        utt.onFallbackWav(bytes)
                    } catch (t: Throwable) {
                        Log.w(TAG, "Fallback WAV read failed: ${t.message}")
                    }
                }
                utt.completion.complete(!utt.cancelled.get())
            }

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                val utt = utteranceId?.let { activeUtterances[it] } ?: return
                utt.completion.complete(false)
            }

            override fun onError(utteranceId: String?, errorCode: Int) {
                Log.w(TAG, "TTS utterance $utteranceId error code=$errorCode")
                val utt = utteranceId?.let { activeUtterances[it] } ?: return
                utt.completion.complete(false)
            }

            override fun onStop(utteranceId: String?, interrupted: Boolean) {
                val utt = utteranceId?.let { activeUtterances[it] } ?: return
                utt.cancelled.set(true)
                utt.completion.complete(false)
            }
        })

        val ok = try {
            kotlinx.coroutines.withTimeoutOrNull(INIT_TIMEOUT_SEC * 1000L) {
                initResult.await()
            } ?: false
        } catch (_: Throwable) {
            false
        }

        if (ok) {
            tts = instance
            isReady = true
        } else {
            try { instance.shutdown() } catch (_: Throwable) {}
            tts = null
            isReady = false
        }
        return ok
    }

    override fun synthesizeClauseBlocking(
        clauseText: String,
        turnEpoch: Int,
        clauseId: Int,
        onPcmChunk: (pcm16Bytes: ByteArray, sampleRate: Int, channels: Int) -> Boolean,
        onFallbackWav: (wavBytes: ByteArray) -> Boolean
    ): Boolean {
        val engine = tts ?: return false
        val cleanText = clauseText.trim()
        if (cleanText.isEmpty()) return true

        val uttId = "aotg_${turnEpoch}_${clauseId}_${seqCounter.incrementAndGet()}"
        val tempFile = File(getTtsCacheDir(), "$uttId.wav")
        val utt = ActiveUtterance(onPcmChunk, onFallbackWav, tempFile)
        activeUtterances[uttId] = utt
        currentUtterance = utt

        return try {
            val params = Bundle()
            val status = engine.synthesizeToFile(cleanText, params, tempFile, uttId)
            if (status != TextToSpeech.SUCCESS) {
                Log.w(TAG, "synthesizeToFile rejected clause $uttId status=$status")
                false
            } else {
                utt.completion.get(CLAUSE_TIMEOUT_SEC, TimeUnit.SECONDS)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "TTS synthesis await failed for $uttId: ${t.message}")
            false
        } finally {
            if (currentUtterance === utt) {
                currentUtterance = null
            }
            activeUtterances.remove(uttId)
            try {
                if (tempFile.exists()) tempFile.delete()
            } catch (_: Throwable) {}
        }
    }

    override fun stopCurrent() {
        currentUtterance?.let {
            it.cancelled.set(true)
            it.completion.complete(false)
        }
        for ((_, utt) in activeUtterances) {
            utt.cancelled.set(true)
            utt.completion.complete(false)
        }
        try {
            tts?.stop()
        } catch (t: Throwable) {
            Log.w(TAG, "TTS stop failed: ${t.message}")
        }
    }

    override fun shutdown() {
        stopCurrent()
        isReady = false
        try {
            tts?.shutdown()
        } catch (_: Throwable) {}
        tts = null
        try {
            getTtsCacheDir().listFiles()?.forEach { it.delete() }
        } catch (_: Throwable) {}
    }

    private fun normalizeToPcm16(raw: ByteArray, encoding: Int): ByteArray {
        return when (encoding) {
            AudioFormat.ENCODING_PCM_FLOAT -> {
                val floatCount = raw.size / 4
                val inBuf = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
                val outBuf = ByteBuffer.allocate(floatCount * 2).order(ByteOrder.LITTLE_ENDIAN)
                for (i in 0 until floatCount) {
                    val sample = (inBuf.get(i).coerceIn(-1f, 1f) * 32767f).toInt().toShort()
                    outBuf.putShort(sample)
                }
                outBuf.array()
            }
            AudioFormat.ENCODING_PCM_8BIT -> {
                val outBuf = ByteBuffer.allocate(raw.size * 2).order(ByteOrder.LITTLE_ENDIAN)
                for (b in raw) {
                    val unsigned = b.toInt() and 0xFF
                    val pcm16 = ((unsigned - 128) shl 8).toShort()
                    outBuf.putShort(pcm16)
                }
                outBuf.array()
            }
            else -> raw // ENCODING_PCM_16BIT little-endian
        }
    }
}
