#include "OboeAudioEngine.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstring>

#include "WavHeader.h"

#if defined(__ANDROID__)
#include <android/log.h>
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "AOTG_OboeEngine", __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, "AOTG_OboeEngine", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "AOTG_OboeEngine", __VA_ARGS__)
#else
#define LOGI(...)
#define LOGW(...)
#define LOGE(...)
#endif

namespace aotg::audio {

namespace {

constexpr int32_t kCaptureTargetRate = 16000;
constexpr int32_t kPlaybackTargetRate = 24000;
constexpr size_t kVadFrameSamples = 512;      // 32ms @ 16kHz
constexpr size_t kVadContextSamples = 64;     // Silero VAD v5 rolling context
constexpr size_t kVadTotalSamples = kVadContextSamples + kVadFrameSamples; // 576
constexpr size_t kPreRollSamples = 6400;      // 400ms @ 16kHz
constexpr size_t kSpeechOnsetFrames = 3;      // 96ms onset confirmation
constexpr size_t kMinUtteranceVoicedFrames = 4; // >= 128ms total active voice
constexpr size_t kMinBargeInFrames = 5;       // minimum ~160ms voice floor even on loud barge-in
constexpr int64_t kMinPlaybackSettleMs = 120; // speaker DAC-to-mic initial propagation settle
constexpr size_t kMaxWavSafetySamples = 16000 * 600; // 10-min WAV buffer OOM guard only
constexpr float kPi = 3.14159265358979323846f;

int64_t steadyNowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

inline float clampFloat(float v, float lo, float hi) {
    return std::max(lo, std::min(hi, v));
}

inline float cubicCatmullRom(float y0, float y1, float y2, float y3, float t) {
    const float t2 = t * t;
    const float t3 = t2 * t;
    return 0.5f * ((2.0f * y1) +
                   (-y0 + y2) * t +
                   (2.0f * y0 - 5.0f * y1 + 4.0f * y2 - y3) * t2 +
                   (-y0 + 3.0f * y1 - 3.0f * y2 + y3) * t3);
}

/**
 * Built-in DC-free energy + voice-band ZCR/spectral-slope fallback used ONLY if
 * silero_vad.onnx could not be loaded cleanly. Returns pseudo-probability in [0, 1].
 */
float fallbackDspVad(const int16_t* pcm512, size_t count, float noiseFloorRms) {
    if (!pcm512 || count == 0) return 0.0f;
    double sum = 0.0;
    for (size_t i = 0; i < count; ++i) {
        sum += static_cast<double>(pcm512[i]) / 32768.0;
    }
    const float mean = static_cast<float>(sum / static_cast<double>(count));

    double sumSq = 0.0;
    double diffSumSq = 0.0;
    size_t zeroCrossings = 0;
    float prev = (static_cast<float>(pcm512[0]) / 32768.0f) - mean;
    for (size_t i = 0; i < count; ++i) {
        const float s = (static_cast<float>(pcm512[i]) / 32768.0f) - mean;
        sumSq += static_cast<double>(s) * static_cast<double>(s);
        if (i > 0) {
            const float d = s - prev;
            diffSumSq += static_cast<double>(d) * static_cast<double>(d);
            if ((s >= 0.0f && prev < 0.0f) || (s < 0.0f && prev >= 0.0f)) {
                ++zeroCrossings;
            }
        }
        prev = s;
    }
    const float rms = static_cast<float>(std::sqrt(sumSq / static_cast<double>(count)));
    const float diffRms = static_cast<float>(std::sqrt(diffSumSq / static_cast<double>(std::max<size_t>(1, count - 1))));
    const float zcr = static_cast<float>(zeroCrossings) / static_cast<float>(count);
    const float diffRatio = (rms > 1e-5f) ? (diffRms / rms) : 0.0f;

    const float floor = std::max(0.010f, noiseFloorRms * 2.3f);
    const float snrScore = clampFloat((rms - floor) / std::max(0.018f, floor * 2.4f), 0.0f, 1.0f);

    // Reject sub-bass handling thumps (very low ZCR/diffRatio) and broadband static/fan hiss.
    float bandGate = 1.0f;
    if (zcr < 0.012f || diffRatio < 0.08f) {
        bandGate = 0.25f;
    } else if (zcr > 0.44f || diffRatio > 1.35f) {
        bandGate = 0.30f;
    } else if (zcr > 0.34f || diffRatio > 1.10f) {
        bandGate = 0.62f;
    }
    return clampFloat(snrScore * bandGate, 0.0f, 1.0f);
}

} // namespace

class OboeAudioEngine::InputCallback : public oboe::AudioStreamDataCallback {
public:
    explicit InputCallback(OboeAudioEngine* owner) : owner_(owner) {}
    oboe::DataCallbackResult onAudioReady(
        oboe::AudioStream* /*audioStream*/,
        void* audioData,
        int32_t numFrames) override {
        return owner_->onInputReady(audioData, numFrames);
    }
private:
    OboeAudioEngine* owner_;
};

class OboeAudioEngine::OutputCallback : public oboe::AudioStreamDataCallback {
public:
    explicit OutputCallback(OboeAudioEngine* owner) : owner_(owner) {}
    oboe::DataCallbackResult onAudioReady(
        oboe::AudioStream* /*audioStream*/,
        void* audioData,
        int32_t numFrames) override {
        return owner_->onOutputReady(audioData, numFrames);
    }
private:
    OboeAudioEngine* owner_;
};

class OboeAudioEngine::StreamErrorCallback : public oboe::AudioStreamErrorCallback {
public:
    explicit StreamErrorCallback(OboeAudioEngine* owner) : owner_(owner) {}
    void onErrorAfterClose(oboe::AudioStream* /*stream*/, oboe::Result error) override {
        (void)error;
        LOGW("Oboe stream closed with error: %s", oboe::convertToText(error));
        owner_->notifyRouteChanged();
    }
private:
    OboeAudioEngine* owner_;
};

OboeAudioEngine::OboeAudioEngine() = default;

OboeAudioEngine::~OboeAudioEngine() {
    stop();
}

bool OboeAudioEngine::start(bool useOsAsrFallback, float vadSensitivity, EngineCallbacks callbacks) {
    stop();

    callbacks_ = std::move(callbacks);
    useOsAsrFallback_.store(useOsAsrFallback, std::memory_order_release);
    vadSensitivity_.store(clampFloat(vadSensitivity, 0.0f, 1.0f), std::memory_order_release);
    micMuted_.store(false, std::memory_order_release);
    manualCommitRequested_.store(false, std::memory_order_release);
    reopenRequested_.store(false, std::memory_order_release);
    fadeAndFlushRequested_.store(false, std::memory_order_release);
    fadeOutActive_.store(false, std::memory_order_release);
    speakingTriggeredForEpoch_.store(false, std::memory_order_release);
    ttsTurnFinished_.store(false, std::memory_order_release);
    playbackCompleteReady_.store(false, std::memory_order_release);
    committedCharEnd_.store(0, std::memory_order_release);
    currentMicRms_.store(0.0f, std::memory_order_release);
    currentSpeakerRms_.store(0.0f, std::memory_order_release);
    speakerEchoRms_.store(0.0f, std::memory_order_release);
    currentTurnEpoch_.store(1, std::memory_order_release);
    fadeAndFlushEpoch_.store(0, std::memory_order_release);
    lastStartedWriteEpoch_.store(0, std::memory_order_release);
    finishedTtsEpoch_.store(0, std::memory_order_release);
    speakingStartedMs_.store(0, std::memory_order_release);

    captureRing_.reset();
    playbackRing_.reset();
    segmentQueue_.reset();
    outFracPhase_ = 0.0;
    std::memset(outHist_, 0, sizeof(outHist_));
    outHistInitialized_ = false;
    outSpeakerEnv_ = 0.0f;
    hasActiveSeg_ = false;
    totalPlayed24kSamples_ = 0;
    fadeOutRemainingSamples_ = 0;
    lastWrittenClauseEpoch_ = -1;
    fadeInRemaining24k_ = 0;
    epochPlaybackStartSample_.store(0, std::memory_order_release);

    {
        std::lock_guard<std::mutex> lock(streamMutex_);
        if (!openStreamsLocked()) {
            closeStreamsLocked();
            return false;
        }
    }

    state_.store(static_cast<int32_t>(EngineState::Listening), std::memory_order_release);
    running_.store(true, std::memory_order_release);
    vadThread_ = std::thread(&OboeAudioEngine::vadLoop, this);
    return true;
}

void OboeAudioEngine::stop() {
    running_.store(false, std::memory_order_release);
    vadCv_.notify_all();
    if (vadThread_.joinable()) {
        vadThread_.join();
    }
    {
        std::lock_guard<std::mutex> lock(streamMutex_);
        closeStreamsLocked();
    }
    state_.store(static_cast<int32_t>(EngineState::Idle), std::memory_order_release);
}

bool OboeAudioEngine::openStreamsLocked() {
    if (!inCallback_) inCallback_ = std::make_unique<InputCallback>(this);
    if (!outCallback_) outCallback_ = std::make_unique<OutputCallback>(this);
    if (!errorCallback_) errorCallback_ = std::make_unique<StreamErrorCallback>(this);

    oboe::AudioStreamBuilder outBuilder;
    outBuilder.setDirection(oboe::Direction::Output)
        ->setSharingMode(oboe::SharingMode::Shared)
        ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
        ->setFormat(oboe::AudioFormat::I16)
        ->setChannelCount(oboe::ChannelCount::Mono)
        ->setUsage(oboe::Usage::VoiceCommunication)
        ->setContentType(oboe::ContentType::Speech)
        ->setDataCallback(outCallback_.get())
        ->setErrorCallback(errorCallback_.get());

    oboe::Result outRes = outBuilder.openStream(outStream_);
    if (outRes != oboe::Result::OK || !outStream_) {
        LOGE("Failed to open Oboe output stream: %s", oboe::convertToText(outRes));
        return false;
    }

    const int32_t outRate = outStream_->getSampleRate();
    const int32_t outCh = outStream_->getChannelCount();
    hwOutSampleRate_.store(outRate, std::memory_order_release);
    hwOutChannels_.store(outCh, std::memory_order_release);
    fadeOutTotalSamples_ = std::max(48, (outRate * 5) / 1000); // 5ms cosine fade-out
    fadeOutRemainingSamples_ = 0;

    // Hint low-latency buffer sizing (2 bursts) without overflowing
    const int32_t framesPerBurst = outStream_->getFramesPerBurst();
    if (framesPerBurst > 0) {
        outStream_->setBufferSizeInFrames(std::min(outStream_->getBufferCapacityInFrames(), framesPerBurst * 2));
    }

    oboe::AudioStreamBuilder inBuilder;
    inBuilder.setDirection(oboe::Direction::Input)
        ->setSharingMode(oboe::SharingMode::Shared)
        ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
        ->setFormat(oboe::AudioFormat::I16)
        ->setChannelCount(oboe::ChannelCount::Mono)
        ->setInputPreset(oboe::InputPreset::VoiceCommunication)
        ->setSessionId(oboe::SessionId::Allocate)
        ->setSampleRate(outRate)
        ->setDataCallback(inCallback_.get())
        ->setErrorCallback(errorCallback_.get());

    oboe::Result inRes = inBuilder.openStream(inStream_);
    if (inRes != oboe::Result::OK || !inStream_) {
        // Retry without forced sample rate (BT HFP SCO often enforces 8/16kHz input rate)
        inBuilder.setSampleRate(oboe::kUnspecified);
        inRes = inBuilder.openStream(inStream_);
    }
    if (inRes != oboe::Result::OK || !inStream_) {
        LOGE("Failed to open Oboe input stream: %s", oboe::convertToText(inRes));
        return false;
    }

    const int32_t inRate = inStream_->getSampleRate();
    const int32_t inCh = inStream_->getChannelCount();
    const int32_t sessionId = static_cast<int32_t>(inStream_->getSessionId());
    hwInSampleRate_.store(inRate, std::memory_order_release);
    hwInChannels_.store(inCh, std::memory_order_release);
    inputSessionId_.store(sessionId, std::memory_order_release);

    captureResampler_.reset(static_cast<uint32_t>(inRate), static_cast<uint32_t>(kCaptureTargetRate));

    if (callbacks_.onInputSessionOpened) {
        callbacks_.onInputSessionOpened(sessionId);
    }

    if (outStream_->requestStart() != oboe::Result::OK) {
        LOGE("Failed to start Oboe output stream");
        return false;
    }
    if (inStream_->requestStart() != oboe::Result::OK) {
        LOGE("Failed to start Oboe input stream");
        return false;
    }

    LOGI("Oboe duplex active: in=%dHz/%dch (session=%d), out=%dHz/%dch",
         inRate, inCh, sessionId, outRate, outCh);
    return true;
}

void OboeAudioEngine::closeStreamsLocked() {
    if (inStream_) {
        inStream_->requestStop();
        inStream_->close();
        inStream_.reset();
    }
    if (outStream_) {
        outStream_->requestStop();
        outStream_->close();
        outStream_.reset();
    }
    fadeOutActive_.store(false, std::memory_order_release);
    fadeOutRemainingSamples_ = 0;
    inputSessionId_.store(-1, std::memory_order_release);
}

void OboeAudioEngine::reopenStreams() {
    if (!running_.load(std::memory_order_acquire)) return;
    std::lock_guard<std::mutex> lock(streamMutex_);
    if (!running_.load(std::memory_order_acquire)) return;
    closeStreamsLocked();
    if (!openStreamsLocked()) {
        closeStreamsLocked();
        if (callbacks_.onError) {
            callbacks_.onError("Failed to reopen audio stream after audio route change.");
        }
    }
}

void OboeAudioEngine::notifyRouteChanged() {
    if (running_.load(std::memory_order_acquire)) {
        reopenRequested_.store(true, std::memory_order_release);
        vadCv_.notify_all();
    }
}

void OboeAudioEngine::setMuted(bool muted) {
    micMuted_.store(muted, std::memory_order_release);
}

void OboeAudioEngine::setVadSensitivity(float sensitivity) {
    vadSensitivity_.store(clampFloat(sensitivity, 0.0f, 1.0f), std::memory_order_release);
}

void OboeAudioEngine::commitTurn() {
    manualCommitRequested_.store(true, std::memory_order_release);
    vadCv_.notify_all();
}

void OboeAudioEngine::setState(EngineState newState) {
    const EngineState prev = state();
    if (newState == EngineState::Listening &&
        (prev == EngineState::Thinking || prev == EngineState::Speaking)) {
        currentTurnEpoch_.fetch_add(1, std::memory_order_acq_rel);
        speakingTriggeredForEpoch_.store(false, std::memory_order_release);
        ttsTurnFinished_.store(false, std::memory_order_release);
        playbackCompleteReady_.store(false, std::memory_order_release);
    }
    transitionState(newState);
}

void OboeAudioEngine::transitionState(EngineState nextState) {
    const int32_t nextInt = static_cast<int32_t>(nextState);
    const int32_t prevInt = state_.exchange(nextInt, std::memory_order_acq_rel);
    if (prevInt != nextInt) {
        if (nextState == EngineState::Speaking) {
            speakingStartedMs_.store(steadyNowMs(), std::memory_order_release);
        }
        if (callbacks_.onStateChanged) {
            callbacks_.onStateChanged(prevInt, nextInt);
        }
    }
}

int32_t OboeAudioEngine::interruptPlaybackAndAdvanceEpoch() {
    const int32_t nextEpoch = currentTurnEpoch_.fetch_add(1, std::memory_order_acq_rel) + 1;
    speakingTriggeredForEpoch_.store(false, std::memory_order_release);
    ttsTurnFinished_.store(false, std::memory_order_release);
    playbackCompleteReady_.store(false, std::memory_order_release);
    fadeAndFlushEpoch_.store(nextEpoch, std::memory_order_release);
    fadeAndFlushRequested_.store(true, std::memory_order_release);
    return committedCharEnd_.load(std::memory_order_acquire);
}

bool OboeAudioEngine::enqueuePlaybackPcm24k(
    const int16_t* samples24k,
    size_t count,
    int32_t turnEpoch,
    int32_t clauseId,
    int32_t charStartOffset,
    int32_t charEndOffset) {
    if (!samples24k || count == 0) return false;
    if (turnEpoch != currentTurnEpoch_.load(std::memory_order_acquire)) {
        return false;
    }

    std::lock_guard<std::mutex> lock(ttsWriteMutex_);
    if (turnEpoch != currentTurnEpoch_.load(std::memory_order_acquire)) {
        return false;
    }

    if (lastWrittenClauseEpoch_ != turnEpoch) {
        for (int w = 0;
             w < 40 &&
             (fadeAndFlushRequested_.load(std::memory_order_acquire) ||
              fadeOutActive_.load(std::memory_order_acquire)) &&
             running_.load(std::memory_order_acquire) &&
             turnEpoch == currentTurnEpoch_.load(std::memory_order_acquire);
             ++w) {
            std::this_thread::sleep_for(std::chrono::milliseconds(3));
        }
        if (turnEpoch != currentTurnEpoch_.load(std::memory_order_acquire)) {
            return false;
        }
        lastWrittenClauseEpoch_ = turnEpoch;
        // 5ms fade-in (120 samples @ 24kHz) on first clause to eliminate DAC wake click.
        fadeInRemaining24k_ = 120;
        ttsTurnFinished_.store(false, std::memory_order_release);
        committedCharEnd_.store(0, std::memory_order_release);
        epochPlaybackStartSample_.store(playbackRing_.writePosition(), std::memory_order_release);
        lastStartedWriteEpoch_.store(turnEpoch, std::memory_order_release);
    }

    // Apply 5ms OLA/fade-in if starting new utterance or soft splice chunk
    std::vector<int16_t> tempBuf;
    const int16_t* writePtr = samples24k;
    if (fadeInRemaining24k_ > 0) {
        tempBuf.assign(samples24k, samples24k + count);
        const int32_t applyCount = std::min<int32_t>(fadeInRemaining24k_, static_cast<int32_t>(count));
        const int32_t doneBefore = 120 - fadeInRemaining24k_;
        for (int32_t i = 0; i < applyCount; ++i) {
            const float frac = static_cast<float>(doneBefore + i + 1) / 120.0f;
            const float gain = 0.5f * (1.0f - std::cos(kPi * frac));
            tempBuf[i] = static_cast<int16_t>(std::lrintf(static_cast<float>(tempBuf[i]) * gain));
        }
        fadeInRemaining24k_ -= applyCount;
        writePtr = tempBuf.data();
    }

    const uint64_t startPos = playbackRing_.writePosition();
    size_t writtenTotal = 0;
    while (writtenTotal < count &&
           running_.load(std::memory_order_acquire) &&
           turnEpoch == currentTurnEpoch_.load(std::memory_order_acquire)) {
        const size_t w = playbackRing_.write(writePtr + writtenTotal, count - writtenTotal);
        if (w > 0) {
            writtenTotal += w;
        } else {
            std::this_thread::sleep_for(std::chrono::milliseconds(8));
        }
    }

    if (writtenTotal > 0) {
        PlaybackSegment seg{};
        seg.startSampleIdx = startPos;
        seg.endSampleIdx = startPos + writtenTotal;
        seg.turnEpoch = turnEpoch;
        seg.clauseId = clauseId;
        seg.charStartOffset = charStartOffset;
        seg.charEndOffset = charEndOffset;
        while (segmentQueue_.write(&seg, 1) == 0 &&
               running_.load(std::memory_order_acquire) &&
               turnEpoch == currentTurnEpoch_.load(std::memory_order_acquire)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(4));
        }

        // Fix 2: As soon as first 20-40ms (480-960 samples @ 24kHz) land in
        // PlaybackRingBuffer, transition to SPEAKING immediately instead of waiting 240ms.
        const uint64_t bufferedForEpoch =
            playbackRing_.writePosition() - epochPlaybackStartSample_.load(std::memory_order_acquire);
        if (bufferedForEpoch >= 480 &&
            !speakingTriggeredForEpoch_.exchange(true, std::memory_order_acq_rel)) {
            if (turnEpoch == currentTurnEpoch_.load(std::memory_order_acquire)) {
                transitionState(EngineState::Speaking);
            }
        }
    }

    return turnEpoch == currentTurnEpoch_.load(std::memory_order_acquire);
}

void OboeAudioEngine::markTtsTurnFinished(int32_t turnEpoch) {
    if (turnEpoch == currentTurnEpoch_.load(std::memory_order_acquire)) {
        // Ensure ultra-short 1-word utterances (<480 samples) also enter SPEAKING cleanly
        if (lastWrittenClauseEpoch_ == turnEpoch &&
            !speakingTriggeredForEpoch_.exchange(true, std::memory_order_acq_rel)) {
            transitionState(EngineState::Speaking);
        }
        finishedTtsEpoch_.store(turnEpoch, std::memory_order_release);
        ttsTurnFinished_.store(true, std::memory_order_release);
    }
}

oboe::DataCallbackResult OboeAudioEngine::onInputReady(void* audioData, int32_t numFrames) {
    if (!audioData || numFrames <= 0) {
        return oboe::DataCallbackResult::Continue;
    }

    const int16_t* pcmIn = static_cast<const int16_t*>(audioData);
    const uint16_t inCh = static_cast<uint16_t>(std::max(1, hwInChannels_.load(std::memory_order_relaxed)));

    if (micMuted_.load(std::memory_order_relaxed)) {
        currentMicRms_.store(0.0f, std::memory_order_relaxed);
        int16_t zeros[512]{};
        size_t rem = (static_cast<size_t>(numFrames) * kCaptureTargetRate) /
                     static_cast<size_t>(std::max(8000, hwInSampleRate_.load(std::memory_order_relaxed)));
        rem = std::min<size_t>(rem, 1024);
        while (rem > 0) {
            const size_t chunk = std::min<size_t>(rem, 512);
            captureRing_.write(zeros, chunk);
            rem -= chunk;
        }
        vadCv_.notify_one();
        return oboe::DataCallbackResult::Continue;
    }

    // Resample to 16kHz mono directly into captureRing_ using fixed stack chunks.
    int16_t resampled[4096];
    const size_t outFrames = captureResampler_.process(
        pcmIn,
        static_cast<size_t>(numFrames),
        inCh,
        resampled,
        sizeof(resampled) / sizeof(resampled[0]));

    if (outFrames > 0) {
        captureRing_.write(resampled, outFrames);
        double sumSq = 0.0;
        for (size_t i = 0; i < outFrames; ++i) {
            const float v = static_cast<float>(resampled[i]) / 32768.0f;
            sumSq += static_cast<double>(v) * static_cast<double>(v);
        }
        const float rms = static_cast<float>(std::sqrt(sumSq / static_cast<double>(outFrames)));
        currentMicRms_.store(rms, std::memory_order_relaxed);
        vadCv_.notify_one();
    }

    return oboe::DataCallbackResult::Continue;
}

void OboeAudioEngine::updateWatermarkConsumer(uint64_t played24kSample) {
    while (true) {
        if (!hasActiveSeg_) {
            PlaybackSegment nextSeg{};
            if (segmentQueue_.read(&nextSeg, 1) == 0) {
                break;
            }
            activeSeg_ = nextSeg;
            hasActiveSeg_ = true;
        }

        if (activeSeg_.turnEpoch != currentTurnEpoch_.load(std::memory_order_relaxed)) {
            hasActiveSeg_ = false;
            continue;
        }

        if (played24kSample >= activeSeg_.endSampleIdx) {
            const int32_t prev = committedCharEnd_.load(std::memory_order_relaxed);
            if (activeSeg_.charEndOffset > prev) {
                committedCharEnd_.store(activeSeg_.charEndOffset, std::memory_order_release);
            }
            hasActiveSeg_ = false;
            continue;
        }

        if (played24kSample >= activeSeg_.startSampleIdx &&
            activeSeg_.endSampleIdx > activeSeg_.startSampleIdx) {
            const double frac = static_cast<double>(played24kSample - activeSeg_.startSampleIdx) /
                                static_cast<double>(activeSeg_.endSampleIdx - activeSeg_.startSampleIdx);
            const int32_t span = std::max(0, activeSeg_.charEndOffset - activeSeg_.charStartOffset);
            const int32_t interp = activeSeg_.charStartOffset +
                                   static_cast<int32_t>(std::floor(frac * static_cast<double>(span)));
            const int32_t prev = committedCharEnd_.load(std::memory_order_relaxed);
            if (interp > prev) {
                committedCharEnd_.store(interp, std::memory_order_release);
            }
        }
        break;
    }
}

void OboeAudioEngine::flushOldEpochPlaybackLocked() {
    const int32_t flushEpoch = fadeAndFlushEpoch_.load(std::memory_order_acquire);
    const int32_t startedWriteEpoch = lastStartedWriteEpoch_.load(std::memory_order_acquire);
    if (flushEpoch > 0 && startedWriteEpoch >= flushEpoch) {
        const uint64_t cutoff = epochPlaybackStartSample_.load(std::memory_order_acquire);
        const uint64_t readPos = playbackRing_.readPosition();
        if (cutoff > readPos) {
            playbackRing_.discard(static_cast<size_t>(cutoff - readPos));
        }
        PlaybackSegment seg{};
        while (segmentQueue_.peek(&seg) && seg.turnEpoch < flushEpoch) {
            segmentQueue_.discard(1);
        }
        if (hasActiveSeg_ && activeSeg_.turnEpoch < flushEpoch) {
            hasActiveSeg_ = false;
        }
    } else {
        playbackRing_.discard(playbackRing_.availableToRead());
        segmentQueue_.discard(segmentQueue_.availableToRead());
        hasActiveSeg_ = false;
    }
}

oboe::DataCallbackResult OboeAudioEngine::onOutputReady(void* audioData, int32_t numFrames) {
    if (!audioData || numFrames <= 0) {
        return oboe::DataCallbackResult::Continue;
    }

    int16_t* outBuf = static_cast<int16_t*>(audioData);
    const int32_t outCh = std::max(1, hwOutChannels_.load(std::memory_order_relaxed));
    const int32_t outRate = std::max(8000, hwOutSampleRate_.load(std::memory_order_relaxed));
    const double step = static_cast<double>(kPlaybackTargetRate) / static_cast<double>(outRate);

    if (fadeAndFlushRequested_.exchange(false, std::memory_order_acq_rel)) {
        if (playbackRing_.availableToRead() > 0 || outHistInitialized_) {
            fadeOutRemainingSamples_ = fadeOutTotalSamples_;
            fadeOutActive_.store(true, std::memory_order_release);
        } else {
            flushOldEpochPlaybackLocked();
            fadeOutActive_.store(false, std::memory_order_release);
        }
    }

    const int32_t activeFlushEpoch = fadeAndFlushEpoch_.load(std::memory_order_acquire);
    const bool newEpochQueued =
        (activeFlushEpoch > 0 &&
         lastStartedWriteEpoch_.load(std::memory_order_acquire) >= activeFlushEpoch);
    const uint64_t newEpochCutoff =
        newEpochQueued ? epochPlaybackStartSample_.load(std::memory_order_acquire) : UINT64_MAX;

    double sumSq = 0.0;
    bool hadAudio = false;

    for (int32_t i = 0; i < numFrames; ++i) {
        while (outFracPhase_ >= 1.0 || !outHistInitialized_) {
            const bool pauseAtCutoffForFade =
                (fadeOutRemainingSamples_ > 0 && newEpochQueued &&
                 playbackRing_.readPosition() >= newEpochCutoff);
            int16_t next24k = 0;
            if (!pauseAtCutoffForFade && playbackRing_.read(&next24k, 1) == 1) {
                hadAudio = true;
                ++totalPlayed24kSamples_;
                const float s = static_cast<float>(next24k);
                if (!outHistInitialized_) {
                    outHist_[0] = outHist_[1] = outHist_[2] = outHist_[3] = s;
                    outHistInitialized_ = true;
                } else {
                    outHist_[0] = outHist_[1];
                    outHist_[1] = outHist_[2];
                    outHist_[2] = outHist_[3];
                    outHist_[3] = s;
                }
                updateWatermarkConsumer(playbackRing_.readPosition());
            } else {
                // Smoothly decay trailing history to zero on queue empty
                outHist_[0] = outHist_[1];
                outHist_[1] = outHist_[2];
                outHist_[2] = outHist_[3];
                outHist_[3] = 0.0f;
                if (!outHistInitialized_) {
                    outHistInitialized_ = true;
                }
            }
            if (outFracPhase_ >= 1.0) {
                outFracPhase_ -= 1.0;
            } else {
                break;
            }
        }

        float rendered = cubicCatmullRom(
            outHist_[0], outHist_[1], outHist_[2], outHist_[3], static_cast<float>(outFracPhase_));

        if (fadeOutRemainingSamples_ > 0) {
            const float progress = static_cast<float>(fadeOutTotalSamples_ - fadeOutRemainingSamples_) /
                                   static_cast<float>(std::max(1, fadeOutTotalSamples_));
            const float gain = 0.5f * (1.0f + std::cos(kPi * progress));
            rendered *= gain;
            --fadeOutRemainingSamples_;
            if (fadeOutRemainingSamples_ == 0) {
                flushOldEpochPlaybackLocked();
                std::memset(outHist_, 0, sizeof(outHist_));
                outHistInitialized_ = false;
                fadeOutActive_.store(false, std::memory_order_release);
            }
        }

        const int16_t clamped = static_cast<int16_t>(std::lrintf(clampFloat(rendered, -32768.0f, 32767.0f)));
        const float norm = static_cast<float>(clamped) / 32768.0f;
        sumSq += static_cast<double>(norm) * static_cast<double>(norm);

        for (int32_t ch = 0; ch < outCh; ++ch) {
            outBuf[i * outCh + ch] = clamped;
        }
        outFracPhase_ += step;
    }

    const float rms = static_cast<float>(std::sqrt(sumSq / static_cast<double>(numFrames)));
    currentSpeakerRms_.store(rms, std::memory_order_relaxed);
    const float decayStep = clampFloat(
        1.0f - static_cast<float>(numFrames) / (static_cast<float>(outRate) * 0.22f),
        0.5f,
        0.999f);
    outSpeakerEnv_ = std::max(rms, outSpeakerEnv_ * decayStep);
    speakerEchoRms_.store(outSpeakerEnv_, std::memory_order_relaxed);

    // Check if turn audio drained cleanly after TTS synthesis completed
    if (!hadAudio &&
        playbackRing_.availableToRead() == 0 &&
        fadeOutRemainingSamples_ == 0 &&
        ttsTurnFinished_.load(std::memory_order_acquire) &&
        finishedTtsEpoch_.load(std::memory_order_acquire) == currentTurnEpoch_.load(std::memory_order_acquire)) {
        if (ttsTurnFinished_.exchange(false, std::memory_order_acq_rel)) {
            speakingTriggeredForEpoch_.store(false, std::memory_order_release);
            playbackCompleteReady_.store(true, std::memory_order_release);
        }
    }

    return oboe::DataCallbackResult::Continue;
}

void OboeAudioEngine::vadLoop() {
    if (callbacks_.onVadThreadStart) {
        callbacks_.onVadThreadStart();
    }

    std::array<int16_t, kVadFrameSamples> frame512{};
    std::array<float, kVadContextSamples> context64{};
    std::array<float, kVadTotalSamples> input576{};
    PreRollBuffer<kPreRollSamples> preRoll;
    std::vector<int16_t> utterancePcm;
    utterancePcm.reserve(16000 * 16);

    bool inSpeech = false;
    size_t onsetFrames = 0;
    size_t voicedFrames = 0;
    size_t currentGapFrames = 0;
    size_t maxIntraGapFrames = 0;
    size_t bargeInSpeechFrames = 0;
    float silenceCredits = 0.0f;
    float bargeInEvidence = 0.0f;
    float recentPeakSpeechRms = 0.0f;
    float noiseFloorRms = 0.008f;
    float echoReferenceRms = 0.0f;
    float echoCouplingGain = 0.65f;
    float smoothedMicLevel = 0.0f;
    float smoothedSpeakerLevel = 0.0f;
    int64_t lastLevelEmitMs = 0;
    int32_t prevObservedEpoch = currentTurnEpoch_.load(std::memory_order_acquire);
    EngineState prevLoopState = EngineState::Idle;

    auto resetSpeechState = [&]() {
        inSpeech = false;
        onsetFrames = 0;
        voicedFrames = 0;
        currentGapFrames = 0;
        maxIntraGapFrames = 0;
        silenceCredits = 0.0f;
        recentPeakSpeechRms = 0.0f;
        preRoll.reset();
        utterancePcm.clear();
    };

    while (running_.load(std::memory_order_acquire)) {
        if (reopenRequested_.exchange(false, std::memory_order_acq_rel)) {
            reopenStreams();
            echoCouplingGain = 0.65f;
            echoReferenceRms = 0.0f;
        }

        // Check if playback finished naturally while in Speaking state (never called on audio thread).
        const int32_t curEpoch = currentTurnEpoch_.load(std::memory_order_acquire);
        if (playbackCompleteReady_.exchange(false, std::memory_order_acq_rel)) {
            if (finishedTtsEpoch_.load(std::memory_order_acquire) == curEpoch) {
                finishedTtsEpoch_.store(0, std::memory_order_release);
                if (callbacks_.onPlaybackComplete) {
                    callbacks_.onPlaybackComplete(curEpoch);
                }
            }
        }

        if (captureRing_.availableToRead() < kVadFrameSamples) {
            // Check manual push-to-talk commit even between frames
            if (manualCommitRequested_.exchange(false, std::memory_order_acq_rel) &&
                inSpeech && state() == EngineState::Listening) {
                if (utterancePcm.size() >= 1600) {
                    const auto wav = buildWavBytes(utterancePcm.data(), utterancePcm.size(), kCaptureTargetRate, 1);
                    resetSpeechState();
                    transitionState(EngineState::Thinking);
                    if (callbacks_.onVadSpeechState) callbacks_.onVadSpeechState(false);
                    if (callbacks_.onSpeechTurnReady) callbacks_.onSpeechTurnReady(wav);
                } else {
                    resetSpeechState();
                    if (callbacks_.onVadSpeechState) callbacks_.onVadSpeechState(false);
                }
                continue;
            }

            std::unique_lock<std::mutex> cvLock(vadCvMutex_);
            vadCv_.wait_for(cvLock, std::chrono::milliseconds(10));
            continue;
        }

        if (captureRing_.read(frame512.data(), kVadFrameSamples) != kVadFrameSamples) {
            continue;
        }

        // Handle muted state cleanly
        if (micMuted_.load(std::memory_order_acquire)) {
            resetSpeechState();
            bargeInSpeechFrames = 0;
            bargeInEvidence = 0.0f;
            context64.fill(0.0f);
            prevLoopState = state();
            const float curEcho = std::max(
                currentSpeakerRms_.load(std::memory_order_relaxed),
                speakerEchoRms_.load(std::memory_order_relaxed));
            echoReferenceRms = std::max(curEcho, echoReferenceRms * 0.80f);

            const int64_t nowMs = steadyNowMs();
            if (nowMs - lastLevelEmitMs >= 33) {
                lastLevelEmitMs = nowMs;
                smoothedSpeakerLevel = smoothedSpeakerLevel * 0.55f +
                                       currentSpeakerRms_.load(std::memory_order_relaxed) * 0.45f;
                if (callbacks_.onAudioLevel) {
                    callbacks_.onAudioLevel(0.0f, smoothedSpeakerLevel, 0.0f);
                }
            }
            continue;
        }

        // Prepare [1, 576] Silero VAD v5 frame: [64 context | 512 current] and DC-free AC RMS
        std::memcpy(input576.data(), context64.data(), kVadContextSamples * sizeof(float));
        double sum = 0.0;
        double sumSq = 0.0;
        for (size_t i = 0; i < kVadFrameSamples; ++i) {
            const float f = static_cast<float>(frame512[i]) / 32768.0f;
            input576[kVadContextSamples + i] = f;
            sum += static_cast<double>(f);
            sumSq += static_cast<double>(f) * static_cast<double>(f);
        }
        std::memcpy(context64.data(), input576.data() + kVadFrameSamples, kVadContextSamples * sizeof(float));

        const double invN = 1.0 / static_cast<double>(kVadFrameSamples);
        const double mean = sum * invN;
        const float frameRms = static_cast<float>(std::sqrt(std::max(0.0, (sumSq * invN) - (mean * mean))));
        const float speakerRms = currentSpeakerRms_.load(std::memory_order_relaxed);
        const float speakerEnv = speakerEchoRms_.load(std::memory_order_relaxed);
        echoReferenceRms = std::max(std::max(speakerRms, speakerEnv), echoReferenceRms * 0.80f);

        float vadProb = 0.0f;
        if (callbacks_.evaluateVad) {
            vadProb = callbacks_.evaluateVad(input576.data(), kVadTotalSamples);
        } else {
            vadProb = -1.0f;
        }
        if (vadProb < 0.0f) {
            vadProb = fallbackDspVad(frame512.data(), kVadFrameSamples, noiseFloorRms);
        }

        // Throttle onAudioLevel to ~30Hz (33ms minimum spacing)
        const int64_t nowMs = steadyNowMs();
        smoothedMicLevel = smoothedMicLevel * 0.5f + clampFloat(frameRms * 5.0f, 0.0f, 1.0f) * 0.5f;
        smoothedSpeakerLevel = smoothedSpeakerLevel * 0.5f + clampFloat(speakerRms * 5.0f, 0.0f, 1.0f) * 0.5f;
        if (nowMs - lastLevelEmitMs >= 33) {
            lastLevelEmitMs = nowMs;
            if (callbacks_.onAudioLevel) {
                callbacks_.onAudioLevel(smoothedMicLevel, smoothedSpeakerLevel, vadProb);
            }
        }

        const EngineState curState = state();
        if (curEpoch != prevObservedEpoch) {
            prevObservedEpoch = curEpoch;
        }
        if (curState == EngineState::Listening && prevLoopState != EngineState::Listening && !inSpeech) {
            // Discard stale speaker/room audio accumulated in preRoll before Listening resumed.
            resetSpeechState();
            bargeInSpeechFrames = 0;
            bargeInEvidence = 0.0f;
            manualCommitRequested_.store(false, std::memory_order_relaxed);
        }
        prevLoopState = curState;

        if (curState == EngineState::Listening) {
            bargeInSpeechFrames = 0;
            bargeInEvidence = 0.0f;
            const float sens = vadSensitivity_.load(std::memory_order_relaxed);
            const float listenThresh = clampFloat(0.62f - sens * 0.22f, 0.36f, 0.72f);
            const float sustainThresh = std::max(0.24f, listenThresh * 0.56f);

            if (!inSpeech) {
                manualCommitRequested_.store(false, std::memory_order_relaxed);
                // Calibrate ambient noise floor only outside speech and speaker echo tails.
                if (vadProb < sustainThresh * 0.60f && echoReferenceRms < 0.005f) {
                    noiseFloorRms = clampFloat(noiseFloorRms * 0.96f + frameRms * 0.04f, 0.002f, 0.06f);
                }
                preRoll.push(frame512.data(), kVadFrameSamples);

                const float onsetEnergyFloor = std::max({
                    0.010f,
                    noiseFloorRms * 1.9f,
                    echoReferenceRms * echoCouplingGain * 1.25f
                });
                if (vadProb >= listenThresh && frameRms > onsetEnergyFloor) {
                    ++onsetFrames;
                    if (onsetFrames >= kSpeechOnsetFrames) {
                        inSpeech = true;
                        voicedFrames = onsetFrames;
                        currentGapFrames = 0;
                        maxIntraGapFrames = 0;
                        silenceCredits = 0.0f;
                        recentPeakSpeechRms = frameRms;
                        utterancePcm.clear();

                        // Notify speech onset BEFORE draining pre-roll so OS ASR pipe is open.
                        if (callbacks_.onVadSpeechState) {
                            callbacks_.onVadSpeechState(true);
                        }
                        const size_t preCount = preRoll.size();
                        if (preCount > 0) {
                            utterancePcm.resize(preCount);
                            preRoll.drainTo(utterancePcm.data(), preCount);
                            if (useOsAsrFallback_.load(std::memory_order_relaxed) && callbacks_.onAsrPcmFrame) {
                                callbacks_.onAsrPcmFrame(utterancePcm.data(), preCount);
                            }
                        }
                    }
                } else {
                    onsetFrames = 0;
                }
            } else {
                if (utterancePcm.size() + kVadFrameSamples <= kMaxWavSafetySamples) {
                    utterancePcm.insert(utterancePcm.end(), frame512.begin(), frame512.end());
                }

                if (useOsAsrFallback_.load(std::memory_order_relaxed) && callbacks_.onAsrPcmFrame) {
                    callbacks_.onAsrPcmFrame(frame512.data(), kVadFrameSamples);
                }

                if (vadProb >= sustainThresh) {
                    if (currentGapFrames > 0) {
                        maxIntraGapFrames = std::max(maxIntraGapFrames, std::min<size_t>(currentGapFrames, 36));
                    }
                    currentGapFrames = 0;
                    silenceCredits = 0.0f;
                    ++voicedFrames;
                    recentPeakSpeechRms = std::max(frameRms, recentPeakSpeechRms * 0.985f);
                } else {
                    ++currentGapFrames;
                    if (vadProb < sustainThresh * 0.45f && echoReferenceRms < 0.005f) {
                        noiseFloorRms = clampFloat(noiseFloorRms * 0.96f + frameRms * 0.04f, 0.002f, 0.06f);
                    }
                    const bool deepSilence =
                        (vadProb < sustainThresh * 0.40f) &&
                        (frameRms <= std::max(noiseFloorRms * 1.6f, recentPeakSpeechRms * 0.18f));
                    silenceCredits += deepSilence ? 1.0f : 0.45f;
                }

                // Adapt endpoint patience dynamically to speaker cadence, utterance length, and silence clarity.
                const float cadenceBase = 14.0f + clampFloat(static_cast<float>(voicedFrames) * 0.15f, 0.0f, 9.0f);
                const float cadenceFloor = (maxIntraGapFrames > 0)
                    ? (static_cast<float>(maxIntraGapFrames) * 1.25f + 4.0f)
                    : 0.0f;
                const float sensShift = (0.5f - sens) * 6.0f;
                const float requiredSilenceCredits = clampFloat(
                    std::max(cadenceBase, cadenceFloor) + sensShift,
                    13.0f,
                    44.0f);

                const bool manualCommit = manualCommitRequested_.exchange(false, std::memory_order_acq_rel);
                const bool wavSafetyHit = utterancePcm.size() >= kMaxWavSafetySamples;
                const bool earlyTransientAbort =
                    (voicedFrames < kMinUtteranceVoicedFrames) && (silenceCredits >= 7.0f);

                if (silenceCredits >= requiredSilenceCredits || earlyTransientAbort || manualCommit || wavSafetyHit) {
                    if (voicedFrames >= kMinUtteranceVoicedFrames ||
                        (manualCommit && utterancePcm.size() >= 1600)) {
                        const auto wav = buildWavBytes(utterancePcm.data(), utterancePcm.size(), kCaptureTargetRate, 1);
                        resetSpeechState();
                        transitionState(EngineState::Thinking);
                        if (callbacks_.onVadSpeechState) {
                            callbacks_.onVadSpeechState(false);
                        }
                        if (callbacks_.onSpeechTurnReady) {
                            callbacks_.onSpeechTurnReady(wav);
                        }
                    } else {
                        // Reject brief <128ms transient clicks; state remains Listening so OS ASR cancels cleanly.
                        resetSpeechState();
                        if (callbacks_.onVadSpeechState) {
                            callbacks_.onVadSpeechState(false);
                        }
                    }
                }
            }
        } else if (curState == EngineState::Speaking || curState == EngineState::Thinking) {
            preRoll.push(frame512.data(), kVadFrameSamples);

            const int64_t msSinceSpeakStart = nowMs - speakingStartedMs_.load(std::memory_order_acquire);
            const bool pastPlayPropagation =
                (curState == EngineState::Thinking) || (msSinceSpeakStart >= kMinPlaybackSettleMs);

            // Continuously calibrate actual speaker-to-mic acoustic coupling outside double-talk surges.
            if (curState == EngineState::Speaking && echoReferenceRms > 0.012f) {
                const float observedRatio = clampFloat(frameRms / echoReferenceRms, 0.02f, 2.5f);
                const float predictedEcho = echoReferenceRms * echoCouplingGain;
                if (msSinceSpeakStart < 180) {
                    echoCouplingGain = clampFloat(echoCouplingGain * 0.70f + observedRatio * 0.30f, 0.08f, 2.2f);
                } else if (frameRms <= predictedEcho * 1.40f && bargeInEvidence < 1.5f) {
                    echoCouplingGain = clampFloat(echoCouplingGain * 0.90f + observedRatio * 0.10f, 0.08f, 2.2f);
                }
            }

            const float sens = vadSensitivity_.load(std::memory_order_relaxed);
            const float bargeInProbThresh = clampFloat(0.82f - sens * 0.12f, 0.68f, 0.86f);
            const float ambientFloor = std::max(0.018f, noiseFloorRms * 2.4f);
            const float echoGate = echoReferenceRms * echoCouplingGain *
                ((curState == EngineState::Speaking) ? 1.45f : 1.0f);
            const float bargeInFloor = std::max(ambientFloor, echoGate);

            if (pastPlayPropagation && vadProb >= bargeInProbThresh && frameRms > bargeInFloor) {
                const float snrRatio = frameRms / std::max(0.005f, bargeInFloor);
                const float strength = clampFloat(
                    0.75f + (snrRatio - 1.0f) * 0.55f + (vadProb - bargeInProbThresh) * 2.0f,
                    0.75f,
                    1.75f);
                bargeInEvidence += strength;
                ++bargeInSpeechFrames;

                const float targetEvidence = (curState == EngineState::Speaking) ? 8.5f : 7.0f;
                if (bargeInEvidence >= targetEvidence && bargeInSpeechFrames >= kMinBargeInFrames) {
                    const size_t confirmedFrames = bargeInSpeechFrames;
                    const int32_t committedOffset = interruptPlaybackAndAdvanceEpoch();
                    const int32_t newEpoch = currentTurnEpoch_.load(std::memory_order_acquire);

                    inSpeech = true;
                    onsetFrames = confirmedFrames;
                    voicedFrames = confirmedFrames;
                    currentGapFrames = 0;
                    maxIntraGapFrames = 0;
                    silenceCredits = 0.0f;
                    recentPeakSpeechRms = frameRms;
                    bargeInSpeechFrames = 0;
                    bargeInEvidence = 0.0f;

                    // Transition and notify barge-in BEFORE draining pre-roll so OS ASR
                    // opens the new epoch's pipe before pre-roll PCM frames arrive.
                    transitionState(EngineState::Listening);
                    if (callbacks_.onBargeIn) {
                        callbacks_.onBargeIn(committedOffset, newEpoch);
                    }
                    if (callbacks_.onVadSpeechState) {
                        callbacks_.onVadSpeechState(true);
                    }

                    // Preserve confirmed barge-in onset (+2 lead-in frames) without stale speaker tail.
                    utterancePcm.clear();
                    if (preRoll.size() > 0) {
                        std::vector<int16_t> tmp(preRoll.size());
                        const size_t drained = preRoll.drainTo(tmp.data(), tmp.size());
                        const size_t cap = std::min(kPreRollSamples, (confirmedFrames + 2) * kVadFrameSamples);
                        const size_t keep = std::min(drained, cap);
                        const size_t offset = drained - keep;
                        utterancePcm.insert(utterancePcm.end(), tmp.begin() + offset, tmp.begin() + drained);
                        if (useOsAsrFallback_.load(std::memory_order_relaxed) && callbacks_.onAsrPcmFrame && keep > 0) {
                            callbacks_.onAsrPcmFrame(tmp.data() + offset, keep);
                        }
                    }
                }
            } else if (pastPlayPropagation &&
                       bargeInSpeechFrames >= 2 &&
                       vadProb >= 0.48f &&
                       frameRms > std::max(0.015f, noiseFloorRms * 1.9f)) {
                bargeInEvidence = std::max(0.0f, bargeInEvidence - 0.35f);
                if (bargeInEvidence <= 0.0f) {
                    bargeInSpeechFrames = 0;
                }
            } else {
                bargeInSpeechFrames = 0;
                bargeInEvidence = 0.0f;
            }
        } else {
            // Idle or Interrupted
            resetSpeechState();
            bargeInSpeechFrames = 0;
            bargeInEvidence = 0.0f;
        }
    }

    if (callbacks_.onVadThreadStop) {
        callbacks_.onVadThreadStop();
    }
}

} // namespace aotg::audio
