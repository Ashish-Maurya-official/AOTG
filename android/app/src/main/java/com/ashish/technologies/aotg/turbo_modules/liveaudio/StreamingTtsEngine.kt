package com.ashish.technologies.aotg.turbo_modules.liveaudio

/**
 * Pluggable TTS synthesis interface for Live Talk (v1 uses Android OS TextToSpeech;
 * v2 neural TTS providers such as Phonon-31M can implement this directly).
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
