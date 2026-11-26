package com.ashish.technologies.aotg.turbo_modules.liveaudio

import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import java.io.IOException
import java.io.OutputStream
import java.util.Locale
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * On-device OS Speech Recognition fallback for text-only `.litertlm` models.
 *
 * On Android 13+ (API 33+), pipes Oboe's 16kHz PCM stream directly via
 * `RecognizerIntent.EXTRA_AUDIO_SOURCE` so hardware AEC remains active without
 * microphone contention.
 */
internal class OsAsrFallbackEngine(private val context: Context) {

    companion object {
        private const val TAG = "OsAsrFallbackEngine"
        private const val RESULT_TIMEOUT_MS = 6000L
    }

    private class UtteranceSession(
        val turnEpoch: Int,
        val readFd: ParcelFileDescriptor,
        val pipeOut: OutputStream,
        val future: CompletableFuture<String>
    ) {
        @Volatile var latestPartialText: String = ""
        @Volatile var recognizer: SpeechRecognizer? = null
        @Volatile var closed: Boolean = false
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val pipeExecutor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "AOTG-AsrPipeWriter").apply { isDaemon = true }
    }

    @Volatile private var activeSession: UtteranceSession? = null

    fun isPipeStreamingSupported(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            (SpeechRecognizer.isOnDeviceRecognitionAvailable(context) ||
                SpeechRecognizer.isRecognitionAvailable(context))

    fun isAnyAsrSupported(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            isPipeStreamingSupported()

    fun beginUtterance(turnEpoch: Int) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val existing = activeSession
        if (existing != null && existing.turnEpoch == turnEpoch && !existing.closed) {
            return
        }
        cancelCurrent()

        val future = CompletableFuture<String>()
        val session = try {
            val pipe = ParcelFileDescriptor.createPipe()
            UtteranceSession(
                turnEpoch = turnEpoch,
                readFd = pipe[0],
                pipeOut = ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]),
                future = future
            )
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to create ASR audio pipe: ${t.message}", t)
            future.complete("")
            return
        }
        activeSession = session

        mainHandler.post {
            if (activeSession !== session || session.closed) return@post
            try {
                val sr = if (SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
                    SpeechRecognizer.createOnDeviceSpeechRecognizer(context.applicationContext)
                } else {
                    SpeechRecognizer.createSpeechRecognizer(context.applicationContext)
                }
                sr.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) = Unit
                    override fun onBeginningOfSpeech() = Unit
                    override fun onRmsChanged(rmsdB: Float) = Unit
                    override fun onBufferReceived(buffer: ByteArray?) = Unit
                    override fun onEndOfSpeech() = Unit

                    override fun onError(error: Int) {
                        Log.w(TAG, "ASR error code=$error (partial='${session.latestPartialText}')")
                        if (!session.future.isDone) {
                            session.future.complete(session.latestPartialText.trim())
                        }
                    }

                    override fun onResults(results: Bundle?) {
                        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        val text = matches?.firstOrNull()?.trim().orEmpty()
                        if (!session.future.isDone) {
                            session.future.complete(
                                if (text.isNotEmpty()) text else session.latestPartialText.trim()
                            )
                        }
                    }

                    override fun onPartialResults(partialResults: Bundle?) {
                        val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        val text = matches?.firstOrNull()?.trim().orEmpty()
                        if (text.isNotEmpty()) {
                            session.latestPartialText = text
                        }
                    }

                    override fun onEvent(eventType: Int, params: Bundle?) = Unit
                })

                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(
                        RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                    )
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, session.readFd)
                    putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
                    putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
                    putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, 16000)
                }

                session.recognizer = sr
                sr.startListening(intent)
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to start OS ASR: ${t.message}", t)
                if (!session.future.isDone) session.future.complete("")
            }
        }
    }

    fun feedPcmFrame(pcmBytes: ByteArray) {
        val session = activeSession ?: return
        if (session.closed) return
        val copy = pcmBytes.copyOf()
        pipeExecutor.execute {
            if (session.closed) return@execute
            try {
                session.pipeOut.write(copy)
            } catch (_: IOException) {
                // Pipe closed on end/cancel
            }
        }
    }

    fun finishUtteranceAndAwaitText(turnEpoch: Int): String {
        val session = activeSession ?: return ""
        if (session.turnEpoch != turnEpoch) return ""

        pipeExecutor.execute {
            try {
                session.pipeOut.flush()
                session.pipeOut.close()
            } catch (_: Throwable) {}
        }

        return try {
            session.future.get(RESULT_TIMEOUT_MS, TimeUnit.MILLISECONDS).trim()
        } catch (_: Throwable) {
            session.latestPartialText.trim()
        } finally {
            closeSession(session)
            if (activeSession === session) {
                activeSession = null
            }
        }
    }

    fun cancelCurrent() {
        val prev = activeSession
        activeSession = null
        if (prev != null) {
            prev.future.complete("")
            closeSession(prev)
        }
    }

    fun shutdown() {
        cancelCurrent()
        pipeExecutor.shutdownNow()
    }

    private fun closeSession(session: UtteranceSession) {
        if (session.closed) return
        session.closed = true
        try { session.pipeOut.close() } catch (_: Throwable) {}
        try { session.readFd.close() } catch (_: Throwable) {}
        mainHandler.post {
            try {
                session.recognizer?.cancel()
            } catch (_: Throwable) {}
            try {
                session.recognizer?.destroy()
            } catch (_: Throwable) {}
            session.recognizer = null
        }
    }
}
