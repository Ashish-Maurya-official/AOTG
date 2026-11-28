package com.ashish.technologies.aotg.turbo_modules.liveaudio

import android.Manifest
import android.content.BroadcastReceiver
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.annotation.Keep
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import com.ashish.technologies.aotg.NativeLiveAudioSpec
import com.ashish.technologies.aotg.services.AgentForegroundService
import com.ashish.technologies.aotg.turbo_modules.llm.LLMModule
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class LiveAudioModule(
    private val reactContext: ReactApplicationContext
) : NativeLiveAudioSpec(reactContext) {

    companion object {
        const val NAME = "LiveAudio"
        private const val TAG = "LiveAudioModule"

        private const val STATE_IDLE = 0
        private const val STATE_LISTENING = 1
        private const val STATE_THINKING = 2
        private const val STATE_SPEAKING = 3
        private const val STATE_INTERRUPTED = 4

        private const val EVENT_AUDIO_LEVEL = "onAudioLevel"
        private const val EVENT_TRANSCRIPT_DELTA = "onTranscriptDelta"
        private const val EVENT_STATE_CHANGE = "onStateChange"
        private const val EVENT_TURN_COMMITTED = "onTurnCommitted"
        private const val EVENT_ROUTE_OR_FOCUS_CHANGE = "onRouteOrFocusChange"
        private const val EVENT_TTS_DOWNLOAD_PROGRESS = "onTtsDownloadProgress"
        private const val EVENT_TTS_CONFIG_CHANGED = "onTtsConfigChanged"
        private const val EVENT_ERROR = "onError"
        private const val ENGINE_ANDROID_TTS = "android_tts"

        private val AUTO_HINDI_PRIORITY = listOf(
            SpeechModelManager.KOKORO_MULTI_ID,
            SpeechModelManager.INDIC_TINY_HI_ID,
            SpeechModelManager.PIPER_HI_ID,
            SpeechModelManager.MMS_TTS_HIN_ID,
        )

        private val AUTO_ENGLISH_PRIORITY = listOf(
            SpeechModelManager.KOKORO_MULTI_ID,
            PhononStreamingTtsEngine.ENGINE_NAME,
            SpeechModelManager.POCKET_TTS_ID,
            SpeechModelManager.KITTEN_EN_ID,
            SpeechModelManager.PIPER_EN_ID,
        )

        private const val SPOKEN_STYLE_DIRECTIVE =
            "You are in a live voice conversation. Detect the language of the user's message and respond naturally in that exact same language using its standard script in clear, natural spoken sentences without markdown, asterisks, bullet lists, code blocks, or emojis."
        private const val SPOKEN_STYLE_DIRECTIVE_EN =
            "You are in a live voice conversation. Always respond in clear, natural English spoken sentences without markdown, asterisks, bullet lists, code blocks, or emojis."
        private const val SPOKEN_STYLE_DIRECTIVE_HI =
            "You are in a live voice conversation. Always respond naturally in Hindi using Devanagari script in clear, natural spoken sentences without markdown, asterisks, bullet lists, code blocks, or emojis."

        @Volatile
        private var nativeLibLoaded = false

        @Volatile
        internal var isLiveSessionRunning = false
            private set
        @Volatile internal var isLiveSessionStarting = false
            private set

        private fun ensureNativeLoaded(): Boolean {
            if (nativeLibLoaded) return true
            return try {
                System.loadLibrary("aotg_live_audio")
                nativeLibLoaded = true
                true
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to load libaotg_live_audio.so: ${t.message}", t)
                false
            }
        }
    }

    // Native JNI declarations (bound to libaotg_live_audio.so)
    private external fun nativeInitBridge()
    private external fun nativeDestroyBridge()
    private external fun nativeStartAudio(useOsAsrFallback: Boolean, vadSensitivity: Float): Boolean
    private external fun nativeStopAudio()
    private external fun nativeSetMuted(muted: Boolean)
    private external fun nativeSetState(stateInt: Int)
    private external fun nativeCommitTurn()
    private external fun nativeInterruptPlayback(): Int
    private external fun nativeGetTurnEpoch(): Int
    private external fun nativeGetHwSampleRate(): Int
    private external fun nativeNotifyRouteChanged()
    private external fun nativeEnqueueWavClause(
        wavBytes: ByteArray,
        turnEpoch: Int,
        clauseId: Int,
        charStartOffset: Int,
        charEndOffset: Int
    ): Boolean

    private external fun nativeEnqueuePcmChunk(
        pcmBytes: ByteArray,
        sampleRate: Int,
        channels: Int,
        turnEpoch: Int,
        clauseId: Int,
        charStartOffset: Int,
        charEndOffset: Int
    ): Boolean

    private external fun nativeMarkTtsFinished(turnEpoch: Int)
    private external fun nativeResetChunker()
    private external fun nativePushChunkerToken(rawToken: String, isFinalFlush: Boolean): Array<String>

    private data class QueuedClause(
        val turnEpoch: Int,
        val clauseId: Int,
        val charStartOffset: Int,
        val charEndOffset: Int,
        val text: String,
        val isSentinelDone: Boolean = false
    )

    private val moduleScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val mainHandler = Handler(Looper.getMainLooper())
    private val audioManager =
        reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private val vadEngine = SileroVadEngine(reactContext)
    private val androidTtsEngine = AndroidStreamingTtsEngine(reactContext)
    private val phononModelManager = PhononModelManager(reactContext)
    private val phononTtsEngine = PhononStreamingTtsEngine(phononModelManager)
    private val speechModelManager = SpeechModelManager(reactContext)
    private val mmsHindiTtsEngine = MmsHindiStreamingTtsEngine {
        speechModelManager.getModelDir(SpeechModelManager.MMS_TTS_HIN_ID)
    }
    private val indicTinyHindiTtsEngine = IndicTinyHindiStreamingTtsEngine {
        speechModelManager.getModelDir(SpeechModelManager.INDIC_TINY_HI_ID)
    }
    private val sherpaTtsEngine = SherpaStreamingTtsEngine(speechModelManager)
    private val selectedVoicesByModel = ConcurrentHashMap<String, String>()
    @Volatile private var activeTtsEngine: StreamingTtsEngine = androidTtsEngine
    @Volatile private var ttsEnginePref: String = "auto"
    @Volatile private var selectedVoiceId: String = PhononModelManager.DEFAULT_VOICE_ID
    @Volatile private var memoryPressureDegraded: Boolean = false
    private val asrEngine = OsAsrFallbackEngine(reactContext)

    private val memoryCallbacks = object : ComponentCallbacks2 {
        @Suppress("DEPRECATION")
        override fun onTrimMemory(level: Int) {
            if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL || level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE) {
                if (!memoryPressureDegraded) {
                    Log.w(TAG, "Low memory trim (level=$level) — releasing idle neural TTS sessions")
                    memoryPressureDegraded = true
                    phononTtsEngine.releaseMemoryIfIdle()
                    if (!isSessionActive.get()) {
                        mmsHindiTtsEngine.shutdown()
                        indicTinyHindiTtsEngine.shutdown()
                        sherpaTtsEngine.shutdown()
                        if (activeTtsEngine !== androidTtsEngine) {
                            activeTtsEngine = androidTtsEngine
                        }
                    }
                    emitTtsConfigChangedEvent()
                }
            }
        }

        override fun onConfigurationChanged(newConfig: Configuration) {}

        @Suppress("DEPRECATION")
        override fun onLowMemory() {
            onTrimMemory(ComponentCallbacks2.TRIM_MEMORY_COMPLETE)
        }
    }

    init {
        reactContext.registerComponentCallbacks(memoryCallbacks)
        androidTtsEngine.onLanguageWarning = { msg ->
            if (isSessionActive.get()) {
                emitErrorEvent("WARN_TTS_LANGUAGE", msg, true)
            }
        }
    }

    private val isSessionActive = AtomicBoolean(false)
    private val isSessionStarting = AtomicBoolean(false)
    private val sessionControlMutex = Mutex()
    @Volatile private var startSessionCancelRequested: Boolean = false
    private val isMuted = AtomicBoolean(false)
    private val vadSpeechActive = AtomicBoolean(false)
    private val activeTurnEpoch = AtomicInteger(1)
    private val currentStateRef = AtomicReference("IDLE")

    @Volatile private var inputMode: String = "audio_bytes"
    @Volatile private var activeRoutePref: String = "auto"
    @Volatile private var activeOutputRoute: String = "speaker"
    @Volatile private var activeLanguagePref: String = "auto"
    @Volatile private var userSystemPromptPref: String = ""
    @Volatile private var pendingDirectiveRefresh: Boolean = false
    @Volatile private var effectiveSystemInstruction: String = SPOKEN_STYLE_DIRECTIVE
    @Volatile private var useOsAsrFallback: Boolean = false

    @Volatile private var activeTurnId: String = ""
    @Volatile private var currentTurnUserText: String = ""
    @Volatile private var currentTurnFullSanitized: String = ""
    @Volatile private var activeLlmJob: Job? = null
    @Volatile private var pendingRecoveryGate: CompletableDeferred<Unit>? = null

    private val committedTurnIds = ConcurrentHashMap.newKeySet<String>()
    private val committedShadowHistory = CopyOnWriteArrayList<LLMModule.LiveTurnMessage>()

    // 60ms coalescing for onTranscriptDelta
    private val deltaLock = Any()
    private val pendingDeltaBuf = StringBuilder()
    @Volatile private var lastTranscriptEmitMs = 0L
    private var pendingDeltaRunnable: Runnable? = null

    // 30Hz guard onAudioLevel
    @Volatile private var lastAudioLevelEmitMs = 0L

    // Audio hardware & focus state
    @Volatile private var aecEffect: AcousticEchoCanceler? = null
    @Volatile private var nsEffect: NoiseSuppressor? = null
    @Volatile private var aecActive: Boolean = false
    @Volatile private var audioFocusRequest: AudioFocusRequest? = null
    @Volatile private var savedAudioMode: Int = AudioManager.MODE_NORMAL
    @Volatile private var savedSpeakerphoneOn: Boolean = false
    @Volatile private var sessionConfiguredAtMs: Long = 0L
    private var deviceCallback: AudioDeviceCallback? = null
    private var commDeviceListener: Any? = null
    private var noisyReceiverRegistered = false

    // Sequential TTS synthesis queue per turn
    @Volatile private var ttsChannel: Channel<QueuedClause>? = null
    @Volatile private var ttsWorkerJob: Job? = null

    private var listenerCount = 0

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY && isSessionActive.get()) {
                Log.i(TAG, "Audio becoming noisy (headset disconnected) — interrupting playback for privacy")
                performInterrupt("route_noisy")
                applyOutputRouteInternal(activeRoutePref)
                nativeNotifyRouteChanged()
                emitRouteOrFocusEvent(activeOutputRoute, "headset_unplugged")
            }
        }
    }

    private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        if (!isSessionActive.get()) return@OnAudioFocusChangeListener
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                performInterrupt("audio_focus_lost", terminateAfter = true)
                emitRouteOrFocusEvent(activeOutputRoute, "focus_lost")
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                performInterrupt("audio_focus_lost", terminateAfter = false)
                emitRouteOrFocusEvent(activeOutputRoute, "focus_lost")
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                emitRouteOrFocusEvent(activeOutputRoute, "focus_gained")
            }
        }
    }

    override fun getName(): String = NAME

    override fun startSession(config: ReadableMap, promise: Promise) {
        if (!ensureNativeLoaded()) {
            promise.reject("ERR_NATIVE_LOAD", "Could not load native Live Audio engine library.")
            return
        }

        if (AgentForegroundService.isRunning || LLMModule.activeInstance?.hasAgentOwner() == true) {
            promise.reject(
                "ERR_AGENT_RUNNING",
                "Cannot start Live Voice Talk while the Accessibility Agent is running."
            )
            return
        }

        if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            promise.reject("ERR_PERMISSION_DENIED", "Microphone permission is required for Live Talk.")
            return
        }

        val llm = LLMModule.activeInstance
        if (llm == null || !llm.isModelLoadedSync()) {
            promise.reject("ERR_MODEL_NOT_LOADED", "Load an on-device model before starting Live Talk.")
            return
        }

        if (isSessionActive.get() || !isSessionStarting.compareAndSet(false, true)) {
            promise.reject("ERR_SESSION_ACTIVE", "A Live Talk session is already active or starting.")
            return
        }
        startSessionCancelRequested = false
        isLiveSessionStarting = true

        moduleScope.launch {
            sessionControlMutex.withLock {
                try {
                    if (startSessionCancelRequested) {
                        promise.reject("ERR_SESSION_CANCELLED", "Live Talk session start was cancelled.")
                        return@withLock
                    }
                    committedTurnIds.clear()
                    pendingRecoveryGate = null
                    val modelSupportsAudio = if (config.hasKey("supportsAudio")) config.getBoolean("supportsAudio") else false
                    val disableVision = if (config.hasKey("disableVision")) config.getBoolean("disableVision") else true
                    val requestedAsrFallback = if (config.hasKey("useDeviceAsrFallback")) config.getBoolean("useDeviceAsrFallback") else false
                    val vadSensitivity = if (config.hasKey("vadSensitivity")) config.getDouble("vadSensitivity").toFloat() else 0.5f
                    val speakerRoute = if (config.hasKey("speakerRoute")) config.getString("speakerRoute") ?: "auto" else "auto"
                    val userSystemPrompt = if (config.hasKey("systemInstruction")) config.getString("systemInstruction")?.trim().orEmpty() else ""
                    val requestedLang = normalizeLanguagePref(
                        if (config.hasKey("language")) config.getString("language") else null
                    )
                    activeLanguagePref = requestedLang
                    userSystemPromptPref = userSystemPrompt
                    pendingDirectiveRefresh = false
                    asrEngine.preferredLanguage = requestedLang
                    androidTtsEngine.setPreferredLanguage(requestedLang)

                    if (config.hasKey("ttsEngine")) {
                        ttsEnginePref = normalizeTtsPref(config.getString("ttsEngine"))
                    }
                    if (config.hasKey("voiceId")) {
                        val rawVoice = config.getString("voiceId")
                        val speechSpec = speechModelManager.findSpec(ttsEnginePref)
                        if (speechSpec != null) {
                            val resolved = speechModelManager.resolveVoiceId(speechSpec.id, rawVoice)
                            selectedVoicesByModel[speechSpec.id] = resolved
                            selectedVoiceId = resolved
                        } else {
                            selectedVoiceId = PhononModelManager.sanitizeVoiceId(rawVoice)
                        }
                    } else {
                        speechModelManager.findSpec(ttsEnginePref)?.let { spec ->
                            selectedVoiceId = selectedVoicesByModel[spec.id] ?: spec.defaultVoiceId
                        }
                    }

                    effectiveSystemInstruction = buildEffectiveSystemInstruction(requestedLang, userSystemPrompt)

                    committedShadowHistory.clear()
                    if (config.hasKey("seedHistory")) {
                        val arr = config.getArray("seedHistory")
                        if (arr != null) {
                            for (i in 0 until arr.size()) {
                                val item = arr.getMap(i) ?: continue
                                val role = item.getString("role") ?: "user"
                                val text = item.getString("text")?.trim().orEmpty()
                                if (text.isNotEmpty()) {
                                    committedShadowHistory.add(LLMModule.LiveTurnMessage(role, text))
                                }
                            }
                        }
                    }

                    // 1. Prepare LiteRT-LM (disables visionBackend = null when requested,
                    // configures audioBackend + cacheDir, creates initial ConversationConfig).
                    val prepResult = llm.prepareForLiveTalk(
                        systemInstruction = effectiveSystemInstruction,
                        seedHistory = committedShadowHistory.toList(),
                        requireAudioIfSupported = modelSupportsAudio,
                        disableVision = disableVision
                    )
                    if (startSessionCancelRequested) {
                        promise.reject("ERR_SESSION_CANCELLED", "Live Talk session start was cancelled.")
                        return@withLock
                    }
                    if (!prepResult.ready) {
                        promise.reject("ERR_MODEL_NOT_LOADED", "Model failed Live Talk preparation.")
                        return@withLock
                    }

                    val hasNativeAudio = modelSupportsAudio && prepResult.hasAudioBackend
                    useOsAsrFallback = !hasNativeAudio || requestedAsrFallback
                    if (useOsAsrFallback && !asrEngine.isAnyAsrSupported()) {
                        promise.reject(
                            "ERR_TEXT_MODEL_NO_ASR",
                            "This text-only model requires Android 13+ on-device speech recognition. Please switch to Gemma 4 (native audio) on this device."
                        )
                        return@withLock
                    }
                    inputMode = if (useOsAsrFallback) "os_asr" else "audio_bytes"

                    // 2. Initialize Silero VAD v5 (optional asset) and selected TTS engine.
                    vadEngine.initialize()
                    val ttsReady = prepareActiveTtsEngineForSession()
                    if (startSessionCancelRequested) {
                        promise.reject("ERR_SESSION_CANCELLED", "Live Talk session start was cancelled.")
                        return@withLock
                    }
                    if (!ttsReady) {
                        promise.reject("ERR_TTS_UNAVAILABLE", "Text-to-Speech engine could not be initialized.")
                        return@withLock
                    }

                    // 3. Configure communication audio mode, focus, route & receivers.
                    configureAudioSession(speakerRoute)

                    // 4. Start C++ Oboe duplex streams & VAD thread.
                    nativeInitBridge()
                    val audioStarted = nativeStartAudio(useOsAsrFallback, vadSensitivity)
                    if (!audioStarted || startSessionCancelRequested) {
                        teardownAudioSession()
                        nativeDestroyBridge()
                        if (startSessionCancelRequested) {
                            promise.reject("ERR_SESSION_CANCELLED", "Live Talk session start was cancelled.")
                        } else {
                            promise.reject("ERR_AUDIO_INIT", "Could not start low-latency Oboe audio streams.")
                        }
                        return@withLock
                    }

                    isMuted.set(false)
                    vadSpeechActive.set(false)
                    activeTurnId = ""
                    currentTurnUserText = ""
                    currentTurnFullSanitized = ""
                    activeTurnEpoch.set(nativeGetTurnEpoch())
                    isSessionActive.set(true)
                    isLiveSessionRunning = true
                    startTtsWorkerLoop()

                    transitionJsState("LISTENING")
                    emitRouteOrFocusEvent(activeOutputRoute, "focus_gained")

                    val res = Arguments.createMap().apply {
                        putBoolean("success", true)
                        putString("inputMode", inputMode)
                        putString("vadBackend", if (vadEngine.isAvailable) "silero_onnx" else "dsp_fallback")
                        putString("ttsBackend", activeTtsEngine.name)
                        putString("voiceId", selectedVoiceId)
                        putString("activeRoute", activeOutputRoute)
                        putBoolean("aecEnabled", aecActive)
                        putInt("hwSampleRate", nativeGetHwSampleRate())
                    }
                    promise.resolve(res)
                } catch (t: Throwable) {
                    Log.e(TAG, "startSession failed: ${t.message}", t)
                    cleanupSessionInternal()
                    promise.reject("ERR_START_SESSION", t.message ?: "Failed to start Live Talk session.", t)
                } finally {
                    isSessionStarting.set(false)
                    isLiveSessionStarting = false
                }
            }
        }
    }

    override fun stopSession(promise: Promise) {
        startSessionCancelRequested = true
        moduleScope.launch {
            try {
                sessionControlMutex.withLock {
                    cleanupSessionInternal()
                }
                promise.resolve(true)
            } catch (t: Throwable) {
                promise.reject("ERR_STOP_SESSION", t.message, t)
            }
        }
    }

    override fun interrupt(promise: Promise) {
        if (!isSessionActive.get()) {
            promise.resolve(false)
            return
        }
        performInterrupt("manual_interrupt")
        promise.resolve(true)
    }

    override fun muteMic(muted: Boolean, promise: Promise) {
        isMuted.set(muted)
        if (isSessionActive.get()) {
            nativeSetMuted(muted)
        }
        promise.resolve(muted)
    }

    override fun commitTurn(promise: Promise) {
        if (!isSessionActive.get()) {
            promise.resolve(false)
            return
        }
        nativeCommitTurn()
        promise.resolve(true)
    }

    override fun setOutputRoute(route: String, promise: Promise) {
        activeRoutePref = route
        val prevRoute = activeOutputRoute
        val resolved = if (isSessionActive.get()) {
            val nextRoute = applyOutputRouteInternal(route)
            if (nextRoute != prevRoute) {
                nativeNotifyRouteChanged()
            }
            nextRoute
        } else {
            activeOutputRoute
        }
        emitRouteOrFocusEvent(resolved, "route_changed")
        promise.resolve(resolved)
    }

    override fun getCapabilities(promise: Promise) {
        promise.resolve(buildCapabilitiesMap())
    }

    override fun downloadPhononModel(variant: String, voiceId: String, promise: Promise) {
        val cleanVariant = if (variant == PhononModelManager.VARIANT_FP32) {
            PhononModelManager.VARIANT_FP32
        } else {
            PhononModelManager.VARIANT_Q4
        }
        val cleanVoice = if (voiceId.isNotBlank()) {
            PhononModelManager.sanitizeVoiceId(voiceId)
        } else {
            selectedVoiceId
        }
        selectedVoiceId = cleanVoice
        phononTtsEngine.setPreferredVoiceId(cleanVoice)

        moduleScope.launch {
            try {
                emitTtsConfigChangedEvent()
                val ok = phononModelManager.downloadModel(
                    variant = cleanVariant,
                    initialVoiceId = cleanVoice,
                    onProgress = { progress ->
                        emitTtsDownloadProgressEvent(progress)
                    },
                )
                if (ok) {
                    memoryPressureDegraded = false
                    ttsEnginePref = PhononStreamingTtsEngine.ENGINE_NAME
                    phononTtsEngine.setPreferredVoiceId(cleanVoice)
                    if (phononTtsEngine.initialize()) {
                        activeTtsEngine = phononTtsEngine
                    }
                }
                emitTtsConfigChangedEvent()
                promise.resolve(ok)
            } catch (t: Throwable) {
                emitTtsConfigChangedEvent()
                promise.reject("ERR_PHONON_DOWNLOAD", t.message ?: "Failed to download Phonon-31M.", t)
            }
        }
    }

    override fun cancelPhononDownload(promise: Promise) {
        phononModelManager.cancelDownload()
        emitTtsConfigChangedEvent()
        promise.resolve(true)
    }

    override fun deletePhononModel(promise: Promise) {
        moduleScope.launch {
            try {
                if (activeTtsEngine === phononTtsEngine) {
                    phononTtsEngine.stopCurrent()
                    androidTtsEngine.initialize()
                    activeTtsEngine = androidTtsEngine
                }
                phononTtsEngine.shutdown()
                val deleted = phononModelManager.deleteModel()
                if (ttsEnginePref == PhononStreamingTtsEngine.ENGINE_NAME) {
                    ttsEnginePref = "auto"
                }
                memoryPressureDegraded = false
                emitTtsConfigChangedEvent()
                emitTtsDownloadProgressEvent(
                    PhononModelManager.DownloadProgress(
                        status = "idle",
                        percent = 0,
                        downloadedBytes = 0L,
                        totalBytes = phononModelManager.getExpectedTotalBytes(),
                    ),
                )
                promise.resolve(deleted)
            } catch (t: Throwable) {
                promise.reject("ERR_PHONON_DELETE", t.message ?: "Failed to delete Phonon-31M model.", t)
            }
        }
    }

    override fun downloadTtsModel(modelId: String, voiceId: String, promise: Promise) {
        val cleanId = normalizeTtsPref(modelId)
        if (cleanId == PhononStreamingTtsEngine.ENGINE_NAME) {
            downloadPhononModel(PhononModelManager.VARIANT_Q4, voiceId, promise)
            return
        }
        val spec = speechModelManager.findSpec(cleanId)
        if (spec == null) {
            promise.reject("ERR_TTS_UNKNOWN", "Unknown speech model: $modelId")
            return
        }
        val resolvedVoice = speechModelManager.resolveVoiceId(spec.id, voiceId.ifBlank { selectedVoicesByModel[spec.id] })
        selectedVoicesByModel[spec.id] = resolvedVoice

        moduleScope.launch {
            try {
                emitTtsConfigChangedEvent()
                val res = speechModelManager.downloadModel(spec.id, resolvedVoice) { progress ->
                    emitSpeechDownloadProgressEvent(progress)
                }
                if (res.isSuccess) {
                    memoryPressureDegraded = false
                    ttsEnginePref = spec.id
                    selectedVoiceId = resolvedVoice
                    tryPrepareEngine(spec.id, resolvedVoice)?.let { ready ->
                        activeTtsEngine = ready
                    }
                    emitTtsConfigChangedEvent()
                    promise.resolve(true)
                } else {
                    emitTtsConfigChangedEvent()
                    promise.resolve(false)
                }
            } catch (t: Throwable) {
                emitTtsConfigChangedEvent()
                promise.reject("ERR_TTS_DOWNLOAD", t.message ?: "Failed to download ${spec.label}.", t)
            }
        }
    }

    override fun cancelTtsModelDownload(modelId: String, promise: Promise) {
        val cleanId = SpeechModelManager.sanitizeModelId(modelId)
        if (cleanId == PhononStreamingTtsEngine.ENGINE_NAME) {
            cancelPhononDownload(promise)
            return
        }
        speechModelManager.cancelDownload(cleanId)
        emitTtsConfigChangedEvent()
        promise.resolve(true)
    }

    override fun deleteTtsModel(modelId: String, promise: Promise) {
        val cleanId = SpeechModelManager.sanitizeModelId(modelId)
        if (cleanId == PhononStreamingTtsEngine.ENGINE_NAME) {
            deletePhononModel(promise)
            return
        }
        val spec = speechModelManager.findSpec(cleanId)
        if (spec == null) {
            promise.resolve(false)
            return
        }
        moduleScope.launch {
            try {
                if (activeTtsEngine.name == spec.id) {
                    stopAllTtsEngines()
                    androidTtsEngine.initialize()
                    activeTtsEngine = androidTtsEngine
                }
                when (spec.id) {
                    SpeechModelManager.MMS_TTS_HIN_ID -> mmsHindiTtsEngine.shutdown()
                    SpeechModelManager.INDIC_TINY_HI_ID -> indicTinyHindiTtsEngine.shutdown()
                    else -> if (sherpaTtsEngine.getConfiguredModelId() == spec.id) {
                        sherpaTtsEngine.shutdown()
                    }
                }
                val deleted = speechModelManager.deleteModel(spec.id)
                if (ttsEnginePref == spec.id) {
                    ttsEnginePref = "auto"
                }
                memoryPressureDegraded = false
                emitTtsConfigChangedEvent()
                emitSpeechDownloadProgressEvent(
                    SpeechModelManager.DownloadProgress(
                        modelId = spec.id,
                        state = "idle",
                        downloadedBytes = 0L,
                        totalBytes = spec.estimatedBytes,
                        percent = 0,
                    ),
                )
                promise.resolve(deleted)
            } catch (t: Throwable) {
                promise.reject("ERR_TTS_DELETE", t.message ?: "Failed to delete ${spec.label}.", t)
            }
        }
    }

    override fun setTtsConfig(ttsEngine: String, voiceId: String, promise: Promise) {
        val nextPref = normalizeTtsPref(ttsEngine)
        val speechSpec = speechModelManager.findSpec(nextPref)
        val nextVoice = when {
            speechSpec != null -> {
                val requested = if (voiceId.isNotBlank()) voiceId else selectedVoicesByModel[speechSpec.id]
                val resolved = speechModelManager.resolveVoiceId(speechSpec.id, requested)
                selectedVoicesByModel[speechSpec.id] = resolved
                resolved
            }
            voiceId.isNotBlank() -> PhononModelManager.sanitizeVoiceId(voiceId)
            else -> selectedVoiceId
        }
        ttsEnginePref = nextPref
        selectedVoiceId = nextVoice
        if (nextPref == PhononStreamingTtsEngine.ENGINE_NAME || nextPref == "auto") {
            phononTtsEngine.setPreferredVoiceId(
                if (nextPref == PhononStreamingTtsEngine.ENGINE_NAME) nextVoice
                else PhononModelManager.sanitizeVoiceId(selectedVoicesByModel[PhononStreamingTtsEngine.ENGINE_NAME] ?: nextVoice),
            )
        }
        if (nextPref != ENGINE_ANDROID_TTS && nextPref != "auto") {
            memoryPressureDegraded = false
        }

        moduleScope.launch {
            try {
                if (nextPref == ENGINE_ANDROID_TTS || nextPref == androidTtsEngine.name) {
                    stopAllTtsEngines()
                    androidTtsEngine.initialize()
                    activeTtsEngine = androidTtsEngine
                } else if (speechSpec != null && !memoryPressureDegraded) {
                    if (speechSpec.packageKind == SpeechModelManager.PackageKind.TAR_BZ2_PER_VOICE &&
                        !speechModelManager.isVoiceInstalled(speechSpec.id, nextVoice)
                    ) {
                        speechModelManager.downloadModel(speechSpec.id, nextVoice) { progress ->
                            emitSpeechDownloadProgressEvent(progress)
                        }
                    }
                    val prepared = tryPrepareEngine(speechSpec.id, nextVoice)
                    if (prepared != null) {
                        activeTtsEngine = prepared
                    } else {
                        androidTtsEngine.initialize()
                        activeTtsEngine = androidTtsEngine
                        emitErrorEvent(
                            "WARN_TTS_FALLBACK",
                            "${speechSpec.label} is not ready yet; using device TTS fallback.",
                            true,
                        )
                    }
                } else if (phononModelManager.isCoreInstalled() && !memoryPressureDegraded) {
                    val phononVoice = PhononModelManager.sanitizeVoiceId(
                        selectedVoicesByModel[PhononStreamingTtsEngine.ENGINE_NAME] ?: nextVoice,
                    )
                    val voiceReady = phononModelManager.isVoiceDownloaded(phononVoice) ||
                        phononModelManager.ensureVoiceDownloaded(phononVoice)
                    if (voiceReady) {
                        val phononReady = if (phononTtsEngine.isInitialized()) {
                            phononTtsEngine.switchVoice(phononVoice)
                        } else {
                            phononTtsEngine.initialize()
                        }
                        if (phononReady) {
                            activeTtsEngine = phononTtsEngine
                        } else {
                            androidTtsEngine.initialize()
                            activeTtsEngine = androidTtsEngine
                            emitErrorEvent(
                                "WARN_PHONON_FALLBACK",
                                phononTtsEngine.getLastError() ?: "Phonon-31M unavailable; using device TTS fallback.",
                                true,
                            )
                        }
                    } else if (nextPref == PhononStreamingTtsEngine.ENGINE_NAME) {
                        emitErrorEvent(
                            "WARN_PHONON_VOICE",
                            "Could not download voice '$phononVoice'.",
                            true,
                        )
                    }
                }
                val snapshot = buildCapabilitiesMap()
                emitTtsConfigChangedEvent()
                promise.resolve(snapshot)
            } catch (t: Throwable) {
                promise.reject("ERR_TTS_CONFIG", t.message ?: "Failed to apply TTS configuration.", t)
            }
        }
    }

    override fun setLanguage(language: String, promise: Promise) {
        val normalized = normalizeLanguagePref(language)
        activeLanguagePref = normalized
        asrEngine.preferredLanguage = normalized
        androidTtsEngine.setPreferredLanguage(normalized)
        effectiveSystemInstruction = buildEffectiveSystemInstruction(normalized, userSystemPromptPref)

        if (!isSessionActive.get()) {
            pendingDirectiveRefresh = false
            promise.resolve(normalized)
            return
        }

        if (currentStateRef.get() == "LISTENING" && !vadSpeechActive.get()) {
            pendingDirectiveRefresh = false
            moduleScope.launch {
                try {
                    LLMModule.activeInstance?.stopAndRebuildLiveConversation(
                        systemInstruction = effectiveSystemInstruction,
                        committedHistory = committedShadowHistory.toList(),
                        disableThinking = true
                    )
                } catch (_: Throwable) {}
                promise.resolve(normalized)
            }
        } else {
            pendingDirectiveRefresh = true
            promise.resolve(normalized)
        }
    }

    override fun addListener(eventName: String) {
        listenerCount++
    }

    override fun removeListeners(count: Double) {
        listenerCount = maxOf(0, listenerCount - count.toInt())
    }

    override fun invalidate() {
        startSessionCancelRequested = true
        try {
            reactContext.unregisterComponentCallbacks(memoryCallbacks)
        } catch (_: Throwable) {}
        try {
            cleanupSessionBlocking()
        } catch (_: Throwable) {}
        vadEngine.close()
        phononTtsEngine.shutdown()
        mmsHindiTtsEngine.shutdown()
        indicTinyHindiTtsEngine.shutdown()
        sherpaTtsEngine.shutdown()
        androidTtsEngine.shutdown()
        asrEngine.shutdown()
        moduleScope.cancel()
        super.invalidate()
    }

    // -------------------------------------------------------------------------
    // JNI Callbacks invoked from C++ OboeAudioEngine / VadFramingThread
    // -------------------------------------------------------------------------

    @Keep
    fun onNativeEvaluateVad(samples576: FloatArray): Float {
        return vadEngine.evaluate(samples576)
    }

    @Keep
    fun onNativeAudioLevel(micRms: Float, speakerRms: Float, vadProb: Float) {
        if (!isSessionActive.get()) return
        val now = System.currentTimeMillis()
        if (now - lastAudioLevelEmitMs < 33L) return
        lastAudioLevelEmitMs = now

        sendEvent(EVENT_AUDIO_LEVEL, Arguments.createMap().apply {
            putDouble("micLevel", micRms.toDouble())
            putDouble("speakerLevel", speakerRms.toDouble())
            putDouble("vadProb", vadProb.toDouble())
            putBoolean("speechActive", vadSpeechActive.get())
        })
    }

    @Keep
    fun onNativeVadSpeechState(speaking: Boolean) {
        vadSpeechActive.set(speaking)
        if (!isSessionActive.get() || !useOsAsrFallback) return
        if (speaking) {
            val epoch = nativeGetTurnEpoch()
            activeTurnEpoch.set(epoch)
            asrEngine.beginUtterance(epoch)
        } else if (currentStateRef.get() == "LISTENING") {
            asrEngine.cancelCurrent()
        }
    }

    @Keep
    fun onNativeAsrPcmFrame(pcmBytes: ByteArray) {
        if (useOsAsrFallback && isSessionActive.get()) {
            asrEngine.feedPcmFrame(pcmBytes)
        }
    }

    @Keep
    fun onNativeSpeechTurnReady(wavBytes: ByteArray) {
        if (!isSessionActive.get()) return
        val epoch = nativeGetTurnEpoch()
        activeTurnEpoch.set(epoch)

        moduleScope.launch {
            dispatchTurn(wavBytes, epoch)
        }
    }

    @Keep
    fun onNativeStateChanged(prevStateInt: Int, nextStateInt: Int) {
        val prevName = stateIntToString(prevStateInt)
        val nextName = stateIntToString(nextStateInt)
        if (currentStateRef.getAndSet(nextName) != nextName) {
            emitStateChangeEvent(prevName, nextName)
        }
    }

    @Keep
    fun onNativeBargeIn(committedCharOffset: Int, newEpoch: Int) {
        if (!isSessionActive.get()) return
        val oldTurnId = activeTurnId
        val fullSanitizedSnapshot = currentTurnFullSanitized
        val userTextSnapshot = currentTurnUserText
        activeTurnId = ""
        currentTurnUserText = ""
        currentTurnFullSanitized = ""

        activeTurnEpoch.set(newEpoch)
        stopAllTtsEngines()
        asrEngine.cancelCurrent()
        if (useOsAsrFallback) {
            asrEngine.beginUtterance(newEpoch)
        }
        LLMModule.activeInstance?.cancelLiveGenerationNow()
        activeLlmJob = null
        flushTranscriptDeltaImmediate(oldTurnId, "assistant", fullSanitizedSnapshot)

        val prevGate = pendingRecoveryGate
        val gate = CompletableDeferred<Unit>()
        pendingRecoveryGate = gate

        moduleScope.launch {
            try {
                prevGate?.await()
                commitInterruptedTurnAndRecover(
                    turnId = oldTurnId,
                    userText = userTextSnapshot,
                    fullSanitized = fullSanitizedSnapshot,
                    committedCharOffset = committedCharOffset
                )
            } finally {
                gate.complete(Unit)
            }
        }
    }

    @Keep
    fun onNativePlaybackComplete(turnEpoch: Int) {
        if (!isSessionActive.get() || turnEpoch != activeTurnEpoch.get()) return
        val turnId = activeTurnId
        val userText = currentTurnUserText
        val assistantText = currentTurnFullSanitized
        activeTurnId = ""
        currentTurnUserText = ""
        currentTurnFullSanitized = ""

        if (turnId.isNotEmpty() && assistantText.isNotBlank() && committedTurnIds.add(turnId)) {
            committedShadowHistory.add(LLMModule.LiveTurnMessage("user", userText))
            committedShadowHistory.add(LLMModule.LiveTurnMessage("assistant", assistantText))
            sendEvent(EVENT_TURN_COMMITTED, Arguments.createMap().apply {
                putString("turnId", turnId)
                putString("userText", userText)
                putString("assistantText", assistantText)
                putBoolean("wasInterrupted", false)
                putString("inputMode", inputMode)
            })
        }

        if (isSessionActive.get()) {
            nativeSetState(STATE_LISTENING)
            activeTurnEpoch.set(nativeGetTurnEpoch())
        }
    }

    @Keep
    fun onNativeInputSessionOpened(sessionId: Int) {
        releaseAudioEffects()
        if (sessionId <= 0) return

        try {
            if (AcousticEchoCanceler.isAvailable()) {
                aecEffect = AcousticEchoCanceler.create(sessionId)?.apply {
                    enabled = true
                    aecActive = enabled
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Could not create AcousticEchoCanceler: ${t.message}")
            aecActive = false
        }

        try {
            if (NoiseSuppressor.isAvailable()) {
                nsEffect = NoiseSuppressor.create(sessionId)?.apply {
                    enabled = true
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Could not create NoiseSuppressor: ${t.message}")
        }
    }

    @Keep
    fun onNativeError(message: String) {
        Log.e(TAG, "Native audio error: $message")
        emitErrorEvent("ERR_NATIVE_AUDIO", message, true)
    }

    // -------------------------------------------------------------------------
    // Turn Dispatch, Chunker, TTS Queue & Watermarked Shadow History
    // -------------------------------------------------------------------------

    private suspend fun dispatchTurn(wavBytes: ByteArray, turnEpoch: Int) {
        try {
            pendingRecoveryGate?.await()
        } catch (_: Throwable) {}

        val llm = LLMModule.activeInstance
        if (llm == null || !llm.isModelLoadedSync()) {
            emitErrorEvent("ERR_MODEL_LOST", "Model unloaded during session.", false)
            cleanupSessionInternal()
            return
        }

        if (turnEpoch != activeTurnEpoch.get() || !isSessionActive.get()) return

        // Enforce 75% KV-cache sliding window budget or apply pending language change before new turn
        val usedTokens = llm.getLiveContextTokenCount()
        val maxTokens = maxOf(512, llm.getActiveMaxTokens())
        val compactHistory = usedTokens > (maxTokens * 0.75).toInt() && committedShadowHistory.size > 4
        if (compactHistory) {
            val compacted = committedShadowHistory.takeLast(4)
            committedShadowHistory.clear()
            committedShadowHistory.addAll(compacted)
        }
        if (compactHistory || pendingDirectiveRefresh) {
            pendingDirectiveRefresh = false
            llm.stopAndRebuildLiveConversation(
                systemInstruction = effectiveSystemInstruction,
                committedHistory = committedShadowHistory.toList(),
                disableThinking = true
            )
        }

        if (turnEpoch != activeTurnEpoch.get() || !isSessionActive.get()) return

        activeTurnId = ""
        currentTurnUserText = ""
        currentTurnFullSanitized = ""
        nativeResetChunker()
        synchronized(deltaLock) {
            pendingDeltaBuf.setLength(0)
        }

        val userDisplayText: String
        if (useOsAsrFallback) {
            val recognized = asrEngine.finishUtteranceAndAwaitText(turnEpoch)
            if (turnEpoch != activeTurnEpoch.get()) return
            if (recognized.isBlank()) {
                // No words recognized — return silently to LISTENING without false LLM call
                nativeSetState(STATE_LISTENING)
                activeTurnEpoch.set(nativeGetTurnEpoch())
                return
            }
            userDisplayText = recognized
        } else {
            userDisplayText = "Voice message"
        }

        val turnId = UUID.randomUUID().toString()
        activeTurnId = turnId
        currentTurnUserText = userDisplayText
        sendEvent(EVENT_TRANSCRIPT_DELTA, Arguments.createMap().apply {
            putString("turnId", turnId)
            putString("role", "user")
            putString("textDelta", userDisplayText)
            putString("fullText", userDisplayText)
            putBoolean("isFinal", true)
        })

        val listener = object : LLMModule.LiveGenerationListener {
            override fun onChunk(chunk: String) {
                if (turnEpoch != activeTurnEpoch.get() || !isSessionActive.get()) return
                val parsed = nativePushChunkerToken(chunk, false)
                handleChunkerResult(turnId, turnEpoch, parsed, isFinal = false)
            }

            override fun onComplete(fullText: String) {
                if (turnEpoch != activeTurnEpoch.get() || !isSessionActive.get()) return
                val parsed = nativePushChunkerToken("", true)
                handleChunkerResult(turnId, turnEpoch, parsed, isFinal = true)
                ttsChannel?.trySend(
                    QueuedClause(
                        turnEpoch = turnEpoch,
                        clauseId = -1,
                        charStartOffset = 0,
                        charEndOffset = currentTurnFullSanitized.length,
                        text = "",
                        isSentinelDone = true
                    )
                )
            }

            override fun onError(message: String) {
                if (turnEpoch != activeTurnEpoch.get() || !isSessionActive.get()) return
                emitErrorEvent("ERR_INFERENCE", message, true)
                nativeSetState(STATE_LISTENING)
                activeTurnEpoch.set(nativeGetTurnEpoch())
            }

            override fun onCancelled(partialText: String) = Unit
        }

        activeLlmJob = if (useOsAsrFallback) {
            llm.sendLiveTextAsync(userDisplayText, listener)
        } else {
            llm.sendAudioBytesAsync(wavBytes, "", listener)
        }
    }

    private fun handleChunkerResult(
        turnId: String,
        turnEpoch: Int,
        parsed: Array<String>,
        isFinal: Boolean
    ) {
        if (parsed.size < 3 || turnEpoch != activeTurnEpoch.get()) return
        val delta = parsed[0]
        val fullSanitized = parsed[1]
        val clauseCount = parsed[2].toIntOrNull() ?: 0

        currentTurnFullSanitized = fullSanitized
        enqueueTranscriptDelta(turnId, "assistant", delta, fullSanitized, isFinal)

        var idx = 3
        for (i in 0 until clauseCount) {
            if (idx + 3 >= parsed.size) break
            val clauseId = parsed[idx++].toIntOrNull() ?: i
            val charStart = parsed[idx++].toIntOrNull() ?: 0
            val charEnd = parsed[idx++].toIntOrNull() ?: fullSanitized.length
            val text = parsed[idx++]
            if (text.isNotBlank()) {
                ttsChannel?.trySend(
                    QueuedClause(turnEpoch, clauseId, charStart, charEnd, text, isSentinelDone = false)
                )
            }
        }

        // Handle rare case where model produces only whitespace or filtered <think> tags
        if (isFinal && fullSanitized.isBlank()) {
            nativeSetState(STATE_LISTENING)
            activeTurnEpoch.set(nativeGetTurnEpoch())
        }
    }

    private fun startTtsWorkerLoop() {
        ttsWorkerJob?.cancel()
        ttsChannel?.close()

        val ch = Channel<QueuedClause>(Channel.UNLIMITED)
        ttsChannel = ch

        ttsWorkerJob = moduleScope.launch {
            for (clause in ch) {
                if (!isSessionActive.get()) break
                if (clause.turnEpoch != activeTurnEpoch.get()) continue

                if (clause.isSentinelDone) {
                    nativeMarkTtsFinished(clause.turnEpoch)
                    continue
                }

                try {
                    synthesizeClauseWithFallback(clause)
                } catch (t: Throwable) {
                    if (t is CancellationException) throw t
                    Log.e(TAG, "TTS worker synthesis error: ${t.message}", t)
                }
            }
        }
    }

    private suspend fun commitInterruptedTurnAndRecover(
        turnId: String,
        userText: String,
        fullSanitized: String,
        committedCharOffset: Int
    ) {
        if (turnId.isNotEmpty() && committedTurnIds.add(turnId)) {
            val spokenPrefix = buildInterruptedPrefix(fullSanitized, committedCharOffset)
            if (userText.isNotBlank()) {
                committedShadowHistory.add(LLMModule.LiveTurnMessage("user", userText))
            }
            if (spokenPrefix.isNotBlank()) {
                committedShadowHistory.add(LLMModule.LiveTurnMessage("assistant", spokenPrefix))
            }
            sendEvent(EVENT_TURN_COMMITTED, Arguments.createMap().apply {
                putString("turnId", turnId)
                putString("userText", userText)
                putString("assistantText", spokenPrefix)
                putBoolean("wasInterrupted", true)
                putString("inputMode", inputMode)
            })
        }

        LLMModule.activeInstance?.stopAndRebuildLiveConversation(
            systemInstruction = effectiveSystemInstruction,
            committedHistory = committedShadowHistory.toList(),
            disableThinking = true
        )
    }

    private fun buildInterruptedPrefix(fullText: String, charOffset: Int): String {
        val clean = fullText.trim()
        if (clean.isEmpty()) return ""
        if (charOffset <= 0) return ""
        if (charOffset >= clean.length) return clean

        var snap = charOffset.coerceIn(0, clean.length)
        if (snap < clean.length && !clean[snap].isWhitespace()) {
            val prevSpace = clean.lastIndexOf(' ', snap - 1)
            if (prevSpace > 0) snap = prevSpace
        }
        val prefix = clean.substring(0, snap).trim()
        return if (prefix.isEmpty()) "" else "$prefix... (interrupted)"
    }

    private fun performInterrupt(reason: String, terminateAfter: Boolean = false) {
        if (!isSessionActive.get()) return
        val committedOffset = nativeInterruptPlayback()
        val newEpoch = nativeGetTurnEpoch()
        activeTurnEpoch.set(newEpoch)

        stopAllTtsEngines()
        asrEngine.cancelCurrent()
        LLMModule.activeInstance?.cancelLiveGenerationNow()
        activeLlmJob = null

        val oldTurnId = activeTurnId
        val fullSnapshot = currentTurnFullSanitized
        val userSnapshot = currentTurnUserText
        activeTurnId = ""
        currentTurnUserText = ""
        currentTurnFullSanitized = ""
        flushTranscriptDeltaImmediate(oldTurnId, "assistant", fullSnapshot)

        nativeSetState(STATE_INTERRUPTED)
        val prevGate = pendingRecoveryGate
        val gate = CompletableDeferred<Unit>()
        pendingRecoveryGate = gate

        moduleScope.launch {
            try {
                prevGate?.await()
                commitInterruptedTurnAndRecover(oldTurnId, userSnapshot, fullSnapshot, committedOffset)
                if (terminateAfter) {
                    cleanupSessionInternal()
                } else if (isSessionActive.get()) {
                    nativeSetState(STATE_LISTENING)
                    activeTurnEpoch.set(nativeGetTurnEpoch())
                }
            } finally {
                gate.complete(Unit)
            }
        }
        Log.d(TAG, "Session interrupted ($reason) at charOffset=$committedOffset")
    }

    // -------------------------------------------------------------------------
    // 60ms Coalesced Transcript Delta Emitter
    // -------------------------------------------------------------------------

    private fun enqueueTranscriptDelta(
        turnId: String,
        role: String,
        delta: String,
        fullText: String,
        isFinal: Boolean
    ) {
        synchronized(deltaLock) {
            if (delta.isNotEmpty()) {
                pendingDeltaBuf.append(delta)
            }
            if (isFinal) {
                pendingDeltaRunnable?.let { mainHandler.removeCallbacks(it) }
                pendingDeltaRunnable = null
                val flushStr = pendingDeltaBuf.toString()
                pendingDeltaBuf.setLength(0)
                lastTranscriptEmitMs = System.currentTimeMillis()
                emitTranscriptEvent(turnId, role, flushStr, fullText, true)
                return
            }

            val now = System.currentTimeMillis()
            val elapsed = now - lastTranscriptEmitMs
            if (elapsed >= 60L && pendingDeltaBuf.isNotEmpty()) {
                pendingDeltaRunnable?.let { mainHandler.removeCallbacks(it) }
                pendingDeltaRunnable = null
                val flushStr = pendingDeltaBuf.toString()
                pendingDeltaBuf.setLength(0)
                lastTranscriptEmitMs = now
                emitTranscriptEvent(turnId, role, flushStr, fullText, false)
            } else if (pendingDeltaRunnable == null && pendingDeltaBuf.isNotEmpty()) {
                val r = Runnable {
                    synchronized(deltaLock) {
                        pendingDeltaRunnable = null
                        if (pendingDeltaBuf.isNotEmpty() && turnId == activeTurnId) {
                            val flushStr = pendingDeltaBuf.toString()
                            pendingDeltaBuf.setLength(0)
                            lastTranscriptEmitMs = System.currentTimeMillis()
                            emitTranscriptEvent(turnId, role, flushStr, currentTurnFullSanitized, false)
                        }
                    }
                }
                pendingDeltaRunnable = r
                mainHandler.postDelayed(r, maxOf(10L, 60L - elapsed))
            }
        }
    }

    private fun flushTranscriptDeltaImmediate(turnId: String, role: String, fullText: String) {
        if (turnId.isEmpty()) return
        synchronized(deltaLock) {
            pendingDeltaRunnable?.let { mainHandler.removeCallbacks(it) }
            pendingDeltaRunnable = null
            val flushStr = pendingDeltaBuf.toString()
            pendingDeltaBuf.setLength(0)
            lastTranscriptEmitMs = System.currentTimeMillis()
            if (flushStr.isNotEmpty() || fullText.isNotEmpty()) {
                emitTranscriptEvent(turnId, role, flushStr, fullText, true)
            }
        }
    }

    // -------------------------------------------------------------------------
    // Audio Session, Focus, BT/Wired Routing & Cleanup
    // -------------------------------------------------------------------------

    @Suppress("DEPRECATION")
    private fun configureAudioSession(routePref: String) {
        activeRoutePref = routePref
        savedAudioMode = audioManager.mode
        savedSpeakerphoneOn = audioManager.isSpeakerphoneOn

        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()

        val focusReq = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(attrs)
            .setAcceptsDelayedFocusGain(false)
            .setOnAudioFocusChangeListener(focusChangeListener)
            .build()
        audioFocusRequest = focusReq
        audioManager.requestAudioFocus(focusReq)

        applyOutputRouteInternal(routePref)
        sessionConfiguredAtMs = SystemClock.elapsedRealtime()

        val devCb = object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
                if (!isSessionActive.get()) return
                // Ignore Android's initial device-enumeration callback right after registration.
                if (SystemClock.elapsedRealtime() - sessionConfiguredAtMs < 450L) return
                val nextRoute = applyOutputRouteInternal(activeRoutePref)
                nativeNotifyRouteChanged()
                emitRouteOrFocusEvent(nextRoute, "route_added")
            }

            override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
                if (!isSessionActive.get()) return
                val nextRoute = applyOutputRouteInternal(activeRoutePref)
                nativeNotifyRouteChanged()
                emitRouteOrFocusEvent(nextRoute, "route_removed")
            }
        }
        deviceCallback = devCb
        audioManager.registerAudioDeviceCallback(devCb, mainHandler)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            registerCommDeviceListenerApi31()
        }

        if (!noisyReceiverRegistered) {
            val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                reactContext.registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                reactContext.registerReceiver(noisyReceiver, filter)
            }
            noisyReceiverRegistered = true
        }
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun registerCommDeviceListenerApi31() {
        val listener = AudioManager.OnCommunicationDeviceChangedListener { device ->
            if (!isSessionActive.get()) return@OnCommunicationDeviceChangedListener
            activeOutputRoute = mapDeviceTypeToRoute(device?.type)
            emitRouteOrFocusEvent(activeOutputRoute, "route_changed")
        }
        commDeviceListener = listener
        audioManager.addOnCommunicationDeviceChangedListener(reactContext.mainExecutor, listener)
    }

    @Suppress("DEPRECATION")
    private fun applyOutputRouteInternal(routePref: String): String {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return applyOutputRouteApi31(routePref)
        }
        val outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        val hasBt = outputs.any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
        val hasWired = outputs.any {
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                it.type == AudioDeviceInfo.TYPE_USB_HEADSET
        }

        when (routePref) {
            "bluetooth" -> if (hasBt) {
                audioManager.startBluetoothSco()
                audioManager.isBluetoothScoOn = true
                audioManager.isSpeakerphoneOn = false
                activeOutputRoute = "bluetooth"
                return activeOutputRoute
            }
            "earpiece" -> {
                audioManager.stopBluetoothSco()
                audioManager.isBluetoothScoOn = false
                audioManager.isSpeakerphoneOn = false
                activeOutputRoute = "earpiece"
                return activeOutputRoute
            }
            "speaker" -> {
                audioManager.stopBluetoothSco()
                audioManager.isBluetoothScoOn = false
                audioManager.isSpeakerphoneOn = true
                activeOutputRoute = "speaker"
                return activeOutputRoute
            }
            else -> {
                if (hasBt) {
                    audioManager.startBluetoothSco()
                    audioManager.isBluetoothScoOn = true
                    audioManager.isSpeakerphoneOn = false
                    activeOutputRoute = "bluetooth"
                    return activeOutputRoute
                }
                if (hasWired) {
                    audioManager.stopBluetoothSco()
                    audioManager.isBluetoothScoOn = false
                    audioManager.isSpeakerphoneOn = false
                    activeOutputRoute = "wired"
                    return activeOutputRoute
                }
                audioManager.isSpeakerphoneOn = true
                activeOutputRoute = "speaker"
                return activeOutputRoute
            }
        }
        audioManager.stopBluetoothSco()
        audioManager.isBluetoothScoOn = false
        audioManager.isSpeakerphoneOn = true
        activeOutputRoute = "speaker"
        return activeOutputRoute
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun applyOutputRouteApi31(routePref: String): String {
        val devices = audioManager.availableCommunicationDevices
        val btDev = devices.firstOrNull {
            it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                it.type == AudioDeviceInfo.TYPE_BLE_HEADSET
        }
        val wiredDev = devices.firstOrNull {
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                it.type == AudioDeviceInfo.TYPE_USB_HEADSET
        }
        val earpieceDev = devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
        val speakerDev = devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }

        val target = when (routePref) {
            "bluetooth" -> btDev ?: wiredDev ?: speakerDev
            "earpiece" -> earpieceDev ?: speakerDev
            "speaker" -> speakerDev ?: wiredDev
            else -> btDev ?: wiredDev ?: speakerDev ?: earpieceDev
        }

        if (target != null) {
            try {
                audioManager.setCommunicationDevice(target)
                activeOutputRoute = mapDeviceTypeToRoute(target.type)
                return activeOutputRoute
            } catch (t: Throwable) {
                Log.w(TAG, "setCommunicationDevice failed: ${t.message}")
            }
        }
        activeOutputRoute = "speaker"
        return activeOutputRoute
    }

    private fun mapDeviceTypeToRoute(type: Int?): String = when (type) {
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_BLE_HEADSET -> "bluetooth"
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_USB_HEADSET -> "wired"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
        else -> "speaker"
    }

    private fun getAvailableRoutesList(): List<String> {
        val routes = linkedSetOf("speaker")
        val outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        if (outputs.any { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }) routes.add("earpiece")
        if (outputs.any {
                it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                    (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                        it.type == AudioDeviceInfo.TYPE_BLE_HEADSET)
            }) {
            routes.add("bluetooth")
        }
        if (outputs.any {
                it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                    it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
                    it.type == AudioDeviceInfo.TYPE_USB_HEADSET
            }) {
            routes.add("wired")
        }
        return routes.toList()
    }

    @Suppress("DEPRECATION")
    private fun teardownAudioSession() {
        releaseAudioEffects()

        deviceCallback?.let {
            try { audioManager.unregisterAudioDeviceCallback(it) } catch (_: Throwable) {}
            deviceCallback = null
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (commDeviceListener as? AudioManager.OnCommunicationDeviceChangedListener)?.let { l ->
                try { audioManager.removeOnCommunicationDeviceChangedListener(l) } catch (_: Throwable) {}
            }
            commDeviceListener = null
            try { audioManager.clearCommunicationDevice() } catch (_: Throwable) {}
        } else {
            try {
                audioManager.stopBluetoothSco()
                audioManager.isBluetoothScoOn = false
            } catch (_: Throwable) {}
        }

        if (noisyReceiverRegistered) {
            try { reactContext.unregisterReceiver(noisyReceiver) } catch (_: Throwable) {}
            noisyReceiverRegistered = false
        }

        audioFocusRequest?.let { req ->
            try { audioManager.abandonAudioFocusRequest(req) } catch (_: Throwable) {}
            audioFocusRequest = null
        }

        try {
            audioManager.isSpeakerphoneOn = savedSpeakerphoneOn
            audioManager.mode = savedAudioMode
        } catch (_: Throwable) {}
    }

    private fun releaseAudioEffects() {
        aecActive = false
        try { aecEffect?.release() } catch (_: Throwable) {}
        aecEffect = null
        try { nsEffect?.release() } catch (_: Throwable) {}
        nsEffect = null
    }

    private suspend fun cleanupSessionInternal() {
        val wasActive = isSessionActive.getAndSet(false)
        activeTurnEpoch.incrementAndGet()
        activeTurnId = ""
        currentTurnUserText = ""
        currentTurnFullSanitized = ""
        stopAllTtsEngines()
        asrEngine.cancelCurrent()
        LLMModule.activeInstance?.cancelLiveGenerationNow()
        activeLlmJob = null
        pendingRecoveryGate?.complete(Unit)
        pendingRecoveryGate = null
        committedTurnIds.clear()

        ttsWorkerJob?.cancel()
        ttsChannel?.close()
        ttsWorkerJob = null
        ttsChannel = null

        synchronized(deltaLock) {
            pendingDeltaRunnable?.let { mainHandler.removeCallbacks(it) }
            pendingDeltaRunnable = null
            pendingDeltaBuf.setLength(0)
        }

        if (nativeLibLoaded) {
            try {
                nativeStopAudio()
                nativeDestroyBridge()
            } catch (_: Throwable) {}
        }
        teardownAudioSession()

        try {
            LLMModule.activeInstance?.endLiveTalkSession()
        } catch (t: Throwable) {
            if (t !is CancellationException) {
                Log.w(TAG, "endLiveTalkSession failed: ${t.message}")
            }
        }

        // Keep model ownership unavailable to agents until Live Talk teardown finishes.
        isLiveSessionRunning = false
        if (wasActive) {
            transitionJsState("IDLE")
        }
    }

    private fun cleanupSessionBlocking() {
        isSessionActive.set(false)
        isSessionStarting.set(false)
        isLiveSessionStarting = false
        isLiveSessionRunning = false
        activeTurnEpoch.incrementAndGet()
        stopAllTtsEngines()
        asrEngine.cancelCurrent()
        LLMModule.activeInstance?.cancelLiveGenerationNow()
        activeLlmJob = null
        pendingRecoveryGate?.complete(Unit)
        pendingRecoveryGate = null
        committedTurnIds.clear()
        ttsWorkerJob?.cancel()
        ttsChannel?.close()
        if (nativeLibLoaded) {
            try {
                nativeStopAudio()
                nativeDestroyBridge()
            } catch (_: Throwable) {}
        }
        teardownAudioSession()
        transitionJsState("IDLE")
    }

    private fun normalizeTtsPref(raw: String?): String {
        val clean = raw?.trim()?.lowercase().orEmpty()
        return when (clean) {
            PhononStreamingTtsEngine.ENGINE_NAME -> PhononStreamingTtsEngine.ENGINE_NAME
            ENGINE_ANDROID_TTS, "device", "system" -> ENGINE_ANDROID_TTS
            else -> speechModelManager.findSpec(clean)?.id ?: "auto"
        }
    }

    private fun normalizeLanguagePref(raw: String?): String {
        return when (raw?.trim()?.lowercase()) {
            "hi", "hi-in", "hindi" -> "hi"
            "en", "en-us", "en-in", "en-gb", "english" -> "en"
            else -> "auto"
        }
    }

    private fun buildEffectiveSystemInstruction(language: String, userPrompt: String): String {
        val baseDirective = when (language) {
            "hi" -> SPOKEN_STYLE_DIRECTIVE_HI
            "en" -> SPOKEN_STYLE_DIRECTIVE_EN
            else -> SPOKEN_STYLE_DIRECTIVE
        }
        return if (userPrompt.isNotEmpty()) {
            "$baseDirective\n\n$userPrompt"
        } else {
            baseDirective
        }
    }

    private suspend fun tryPrepareEngine(engineId: String, voiceOverride: String? = null): StreamingTtsEngine? {
        if (memoryPressureDegraded && engineId != ENGINE_ANDROID_TTS) return null
        return when (engineId) {
            ENGINE_ANDROID_TTS -> if (androidTtsEngine.initialize()) androidTtsEngine else null
            PhononStreamingTtsEngine.ENGINE_NAME -> {
                if (!phononModelManager.isCoreInstalled()) return null
                val voice = PhononModelManager.sanitizeVoiceId(voiceOverride ?: selectedVoiceId)
                phononTtsEngine.setPreferredVoiceId(voice)
                if (phononTtsEngine.initialize()) {
                    selectedVoiceId = phononTtsEngine.getSelectedVoiceId()
                    phononTtsEngine
                } else null
            }
            SpeechModelManager.MMS_TTS_HIN_ID -> {
                if (!speechModelManager.isModelInstalled(engineId)) return null
                if (mmsHindiTtsEngine.initialize()) mmsHindiTtsEngine else null
            }
            SpeechModelManager.INDIC_TINY_HI_ID -> {
                if (!speechModelManager.isModelInstalled(engineId)) return null
                val voice = speechModelManager.resolveVoiceId(
                    engineId,
                    voiceOverride ?: selectedVoicesByModel[engineId] ?: selectedVoiceId,
                )
                indicTinyHindiTtsEngine.setPreferredVoice(voice)
                if (indicTinyHindiTtsEngine.initialize()) indicTinyHindiTtsEngine else null
            }
            SpeechModelManager.PIPER_HI_ID,
            SpeechModelManager.KOKORO_MULTI_ID,
            SpeechModelManager.PIPER_EN_ID,
            SpeechModelManager.KITTEN_EN_ID,
            SpeechModelManager.POCKET_TTS_ID -> {
                val voice = voiceOverride ?: selectedVoicesByModel[engineId] ?: selectedVoiceId
                if (!speechModelManager.isModelInstalled(engineId, voice)) return null
                if (sherpaTtsEngine.initializeFor(engineId, voice)) {
                    selectedVoicesByModel[engineId] = sherpaTtsEngine.getConfiguredVoiceId()
                    sherpaTtsEngine
                } else null
            }
            else -> null
        }
    }

    private suspend fun prepareFirstAvailableNeuralEngine(priorityOrder: List<String>): StreamingTtsEngine? {
        for (candidateId in priorityOrder) {
            val prepared = tryPrepareEngine(candidateId)
            if (prepared != null) return prepared
        }
        return null
    }

    private suspend fun prepareActiveTtsEngineForSession(): Boolean {
        if (ttsEnginePref == ENGINE_ANDROID_TTS || ttsEnginePref == androidTtsEngine.name) {
            val ok = androidTtsEngine.initialize()
            if (ok) activeTtsEngine = androidTtsEngine
            return ok
        }

        if (ttsEnginePref != "auto") {
            val chosen = tryPrepareEngine(ttsEnginePref)
            if (chosen != null) {
                activeTtsEngine = chosen
                return true
            }
            emitErrorEvent(
                "WARN_TTS_FALLBACK",
                "Selected speech model could not load; using device TTS fallback.",
                true,
            )
        } else {
            val order = if (activeLanguagePref == "hi") AUTO_HINDI_PRIORITY else AUTO_ENGLISH_PRIORITY
            val best = prepareFirstAvailableNeuralEngine(order)
            if (best != null) {
                activeTtsEngine = best
                return true
            }
        }

        val androidOk = androidTtsEngine.initialize()
        if (androidOk) {
            activeTtsEngine = androidTtsEngine
        }
        return androidOk
    }

    private fun stopAllTtsEngines() {
        phononTtsEngine.stopCurrent()
        mmsHindiTtsEngine.stopCurrent()
        indicTinyHindiTtsEngine.stopCurrent()
        sherpaTtsEngine.stopCurrent()
        androidTtsEngine.stopCurrent()
    }

    private suspend fun resolveEngineForClause(clauseText: String): StreamingTtsEngine {
        val isDevanagari = AndroidStreamingTtsEngine.containsDevanagari(clauseText)
        val activeName = activeTtsEngine.name
        val activeSpec = speechModelManager.findSpec(activeName)
        val activeSupportsHindi = activeSpec?.supportsHindi == true
        val activeSupportsEnglish = activeName == PhononStreamingTtsEngine.ENGINE_NAME || activeSpec?.supportsEnglish == true

        if (ttsEnginePref == ENGINE_ANDROID_TTS || ttsEnginePref == androidTtsEngine.name) {
            if (androidTtsEngine.initialize()) return androidTtsEngine
            return activeTtsEngine
        }

        if (isDevanagari || (activeLanguagePref == "hi" && ttsEnginePref == "auto")) {
            if (activeSupportsHindi) return activeTtsEngine
            prepareFirstAvailableNeuralEngine(AUTO_HINDI_PRIORITY)?.let { return it }
            if (androidTtsEngine.initialize()) return androidTtsEngine
            return activeTtsEngine
        }

        if (!isDevanagari && ttsEnginePref == "auto") {
            if (activeSupportsEnglish) return activeTtsEngine
            prepareFirstAvailableNeuralEngine(AUTO_ENGLISH_PRIORITY)?.let { return it }
            if (androidTtsEngine.initialize()) return androidTtsEngine
            return activeTtsEngine
        }

        if (!isDevanagari && !activeSupportsEnglish && hasAsciiLetters(clauseText)) {
            prepareFirstAvailableNeuralEngine(AUTO_ENGLISH_PRIORITY)?.let { return it }
            if (androidTtsEngine.initialize()) return androidTtsEngine
        }

        return activeTtsEngine
    }

    private fun hasAsciiLetters(text: String): Boolean {
        for (ch in text) {
            if (ch in 'a'..'z' || ch in 'A'..'Z') return true
        }
        return false
    }

    private suspend fun synthesizeClauseWithFallback(clause: QueuedClause) {
        val engine = resolveEngineForClause(clause.text)
        val emittedAnyPcm = AtomicBoolean(false)
        val pcmSink: (ByteArray, Int, Int) -> Boolean = { pcmBytes, sr, channels ->
            emittedAnyPcm.set(true)
            if (!isSessionActive.get() || clause.turnEpoch != activeTurnEpoch.get()) {
                false
            } else {
                nativeEnqueuePcmChunk(
                    pcmBytes,
                    sr,
                    channels,
                    clause.turnEpoch,
                    clause.clauseId,
                    clause.charStartOffset,
                    clause.charEndOffset,
                )
            }
        }
        val wavSink: (ByteArray) -> Boolean = { wavBytes ->
            emittedAnyPcm.set(true)
            if (!isSessionActive.get() || clause.turnEpoch != activeTurnEpoch.get()) {
                false
            } else {
                nativeEnqueueWavClause(
                    wavBytes,
                    clause.turnEpoch,
                    clause.clauseId,
                    clause.charStartOffset,
                    clause.charEndOffset,
                )
            }
        }

        val ok = engine.synthesizeClauseBlocking(
            clauseText = clause.text,
            turnEpoch = clause.turnEpoch,
            clauseId = clause.clauseId,
            onPcmChunk = pcmSink,
            onFallbackWav = wavSink,
        )

        if (
            !ok &&
            engine !== androidTtsEngine &&
            isSessionActive.get() &&
            clause.turnEpoch == activeTurnEpoch.get()
        ) {
            Log.w(TAG, "${engine.name} clause synthesis failed mid-turn; falling back to device TTS.")
            val androidReady = androidTtsEngine.initialize()
            if (androidReady) {
                activeTtsEngine = androidTtsEngine
                emitTtsConfigChangedEvent()
                emitErrorEvent(
                    "WARN_TTS_FALLBACK",
                    "Switched to device TTS fallback for uninterrupted voice playback.",
                    true,
                )
                if (!emittedAnyPcm.get()) {
                    androidTtsEngine.synthesizeClauseBlocking(
                        clauseText = clause.text,
                        turnEpoch = clause.turnEpoch,
                        clauseId = clause.clauseId,
                        onPcmChunk = pcmSink,
                        onFallbackWav = wavSink,
                    )
                }
            }
        }
    }

    private fun buildCapabilitiesMap(): WritableMap {
        val llm = LLMModule.activeInstance
        val routes = getAvailableRoutesList()
        val routeArray = Arguments.createArray().apply {
            routes.forEach { pushString(it) }
        }
        val snapshot = phononModelManager.getStatusSnapshot()
        val downloadedVoicesArray = Arguments.createArray().apply {
            snapshot.downloadedVoices.forEach { pushString(it) }
        }
        val availableVoicesArray = Arguments.createArray().apply {
            PhononModelManager.CURATED_VOICES.forEach { v ->
                pushMap(
                    Arguments.createMap().apply {
                        putString("id", v.id)
                        putString("label", v.label)
                        putString("description", v.description)
                        putBoolean("downloaded", snapshot.downloadedVoices.contains(v.id))
                    },
                )
            }
        }
        val ttsModelsArray = Arguments.createArray().apply {
            speechModelManager.getAllSpecs().forEach { spec ->
                val installedVoices = speechModelManager.getInstalledVoices(spec.id)
                val voicesArr = Arguments.createArray().apply {
                    spec.voices.forEach { v ->
                        pushMap(
                            Arguments.createMap().apply {
                                putString("id", v.id)
                                putString("label", v.label)
                                putString("description", v.description)
                                putString("language", v.language)
                                putBoolean("downloaded", speechModelManager.isVoiceInstalled(spec.id, v.id))
                            },
                        )
                    }
                }
                val langsArr = Arguments.createArray().apply {
                    spec.languages.forEach { pushString(it) }
                }
                val installedVoicesArr = Arguments.createArray().apply {
                    installedVoices.forEach { pushString(it) }
                }
                pushMap(
                    Arguments.createMap().apply {
                        putString("id", spec.id)
                        putString("label", spec.label)
                        putString("subtitle", spec.subtitle)
                        putString("engineFamily", spec.engineFamily)
                        putArray("languages", langsArr)
                        putInt("sampleRate", spec.sampleRate)
                        putDouble("estimatedBytes", spec.estimatedBytes.toDouble())
                        putDouble("installedBytes", speechModelManager.getInstalledBytes(spec.id).toDouble())
                        putBoolean("installed", speechModelManager.isModelInstalled(spec.id))
                        putBoolean("downloading", speechModelManager.isDownloading(spec.id))
                        putInt("percent", speechModelManager.getDownloadPercent(spec.id))
                        putBoolean("supportsHindi", spec.supportsHindi)
                        putBoolean("supportsEnglish", spec.supportsEnglish)
                        putString("defaultVoiceId", spec.defaultVoiceId)
                        putArray("installedVoices", installedVoicesArr)
                        putArray("voices", voicesArr)
                    },
                )
            }
        }
        val activeVoiceForUi = speechModelManager.findSpec(ttsEnginePref)?.let { spec ->
            selectedVoicesByModel[spec.id] ?: spec.defaultVoiceId
        } ?: selectedVoiceId

        return Arguments.createMap().apply {
            putBoolean("hasSileroModel", vadEngine.hasBundledOrLocalModel())
            putBoolean("hasDeviceAsr", asrEngine.isAnyAsrSupported())
            putBoolean("hasTtsEngine", true)
            putBoolean("hasAcousticEchoCanceler", AcousticEchoCanceler.isAvailable())
            putBoolean("hasNoiseSuppressor", NoiseSuppressor.isAvailable())
            putBoolean("isModelLoaded", llm?.isModelLoadedSync() == true)
            putBoolean("modelSupportsAudio", llm?.isAudioBackendEnabled() == true)
            putArray("availableRoutes", routeArray)
            putBoolean("phononInstalled", snapshot.isInstalled)
            putBoolean("phononDownloading", phononModelManager.isDownloading())
            putDouble("phononExpectedBytes", snapshot.expectedTotalBytes.toDouble())
            putDouble("phononDiskBytes", snapshot.downloadedBytes.toDouble())
            putString("phononVariant", snapshot.installedVariant ?: "")
            putString("selectedTtsEngine", ttsEnginePref)
            putString("selectedVoiceId", activeVoiceForUi)
            putArray("downloadedVoices", downloadedVoicesArray)
            putArray("availableVoices", availableVoicesArray)
            putArray("ttsModels", ttsModelsArray)
        }
    }

    private fun emitTtsDownloadProgressEvent(progress: PhononModelManager.DownloadProgress) {
        sendEvent(EVENT_TTS_DOWNLOAD_PROGRESS, Arguments.createMap().apply {
            putString("modelId", PhononStreamingTtsEngine.ENGINE_NAME)
            putString("status", progress.status)
            putInt("percent", progress.percent)
            putDouble("downloadedBytes", progress.downloadedBytes.toDouble())
            putDouble("totalBytes", progress.totalBytes.toDouble())
            if (progress.currentFile != null) {
                putString("currentFile", progress.currentFile)
            }
            if (progress.error != null) {
                putString("error", progress.error)
            }
        })
    }

    private fun emitSpeechDownloadProgressEvent(progress: SpeechModelManager.DownloadProgress) {
        sendEvent(EVENT_TTS_DOWNLOAD_PROGRESS, Arguments.createMap().apply {
            putString("modelId", progress.modelId)
            putString("status", progress.state)
            putInt("percent", progress.percent)
            putDouble("downloadedBytes", progress.downloadedBytes.toDouble())
            putDouble("totalBytes", progress.totalBytes.toDouble())
            if (progress.error != null) {
                putString("error", progress.error)
            }
        })
    }

    private fun emitTtsConfigChangedEvent() {
        sendEvent(EVENT_TTS_CONFIG_CHANGED, buildCapabilitiesMap())
    }

    // -------------------------------------------------------------------------
    // JS Event Helpers
    // -------------------------------------------------------------------------

    private fun stateIntToString(stateInt: Int): String = when (stateInt) {
        STATE_LISTENING -> "LISTENING"
        STATE_THINKING -> "THINKING"
        STATE_SPEAKING -> "SPEAKING"
        STATE_INTERRUPTED -> "INTERRUPTED"
        else -> "IDLE"
    }

    private fun transitionJsState(nextName: String) {
        val prev = currentStateRef.getAndSet(nextName)
        if (prev != nextName) {
            emitStateChangeEvent(prev, nextName)
        }
    }

    private fun emitStateChangeEvent(prev: String, next: String) {
        sendEvent(EVENT_STATE_CHANGE, Arguments.createMap().apply {
            putString("state", next)
            putString("previousState", prev)
        })
    }

    private fun emitTranscriptEvent(
        turnId: String,
        role: String,
        delta: String,
        fullText: String,
        isFinal: Boolean
    ) {
        sendEvent(EVENT_TRANSCRIPT_DELTA, Arguments.createMap().apply {
            putString("turnId", turnId)
            putString("role", role)
            putString("textDelta", delta)
            putString("fullText", fullText)
            putBoolean("isFinal", isFinal)
        })
    }

    private fun emitRouteOrFocusEvent(route: String, focusState: String) {
        sendEvent(EVENT_ROUTE_OR_FOCUS_CHANGE, Arguments.createMap().apply {
            putString("route", route)
            putString("focusState", focusState)
            putBoolean("aecEnabled", aecActive)
        })
    }

    private fun emitErrorEvent(code: String, message: String, recoverable: Boolean) {
        sendEvent(EVENT_ERROR, Arguments.createMap().apply {
            putString("code", code)
            putString("message", message)
            putBoolean("recoverable", recoverable)
        })
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        try {
            if (reactContext.hasActiveReactInstance()) {
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit(eventName, params)
            }
        } catch (t: Throwable) {
            Log.e(TAG, "Error emitting $eventName: ${t.message}")
        }
    }
}
