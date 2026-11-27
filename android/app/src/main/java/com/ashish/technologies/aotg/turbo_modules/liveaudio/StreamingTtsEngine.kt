package com.ashish.technologies.aotg.turbo_modules.liveaudio

import java.util.concurrent.atomic.AtomicBoolean

/**
 * Pluggable TTS synthesis interface for Live Talk (v1 uses Android OS TextToSpeech;
 * v2 neural TTS providers such as Phonon-31M, MMS-TTS, Indic-Tiny-TTS, and Sherpa-ONNX
 * implement this directly).
 */
internal interface StreamingTtsEngine {
    val name: String

    suspend fun initialize(): Boolean

    /**
     * Synthesizes a single clause and streams PCM chunks (or fallback WAV bytes)
     * synchronously until the clause finishes or is cancelled by epoch change.
     */
    fun synthesizeClauseBlocking(
        clauseText: String,
        turnEpoch: Int,
        clauseId: Int,
        onPcmChunk: (pcm16Bytes: ByteArray, sampleRate: Int, channels: Int) -> Boolean,
        onFallbackWav: (wavBytes: ByteArray) -> Boolean
    ): Boolean

    fun stopCurrent()

    fun shutdown()
}

internal fun streamFloatAudioAsPcm16(
    samples: FloatArray,
    sampleRate: Int,
    stopRequested: AtomicBoolean,
    onPcmChunk: (pcm16Bytes: ByteArray, sampleRate: Int, channels: Int) -> Boolean,
    chunkMs: Int = 80,
): Boolean {
    if (samples.isEmpty()) return true
    val chunkSamples = maxOf(320, (sampleRate * chunkMs) / 1000)
    var offset = 0
    while (offset < samples.size) {
        if (stopRequested.get()) return false
        val end = minOf(samples.size, offset + chunkSamples)
        val count = end - offset
        val pcmBytes = ByteArray(count * 2)
        var out = 0
        for (i in offset until end) {
            val clamped = samples[i].coerceIn(-1.0f, 1.0f)
            val s = (clamped * 32767.0f).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            pcmBytes[out++] = (s and 0xFF).toByte()
            pcmBytes[out++] = ((s ushr 8) and 0xFF).toByte()
        }
        if (!onPcmChunk(pcmBytes, sampleRate, 1)) {
            return false
        }
        offset = end
    }
    return true
}
