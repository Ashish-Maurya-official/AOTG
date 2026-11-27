#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

#include <oboe/Oboe.h>

#include "Resampler.h"
#include "RingBuffers.h"

namespace aotg::audio {

enum class EngineState : int32_t {
    Idle = 0,
    Listening = 1,
    Thinking = 2,
    Speaking = 3,
    Interrupted = 4
};

struct EngineCallbacks {
    // Runs on VadFramingThread; returns speech probability in [0, 1].
    std::function<float(const float* samples576, size_t count)> evaluateVad;
    std::function<void(float micRms, float speakerRms, float vadProb)> onAudioLevel;
    std::function<void(const std::vector<uint8_t>& wavBytes)> onSpeechTurnReady;
    std::function<void(const int16_t* pcm512, size_t count)> onAsrPcmFrame;
    std::function<void(int32_t previousState, int32_t newState)> onStateChanged;
    std::function<void(int32_t committedCharOffset, int32_t turnEpoch)> onBargeIn;
    std::function<void(int32_t turnEpoch)> onPlaybackComplete;
    std::function<void(bool speaking)> onVadSpeechState;
    std::function<void(int32_t inputSessionId)> onInputSessionOpened;
    std::function<void(const std::string& message)> onError;
    // Thread attach/detach hooks so JNI callbacks execute safely on vadThread_.
    std::function<void()> onVadThreadStart;
    std::function<void()> onVadThreadStop;
};

class OboeAudioEngine {
public:
    OboeAudioEngine();
    ~OboeAudioEngine();

    OboeAudioEngine(const OboeAudioEngine&) = delete;
    OboeAudioEngine& operator=(const OboeAudioEngine&) = delete;

    bool start(bool useOsAsrFallback, float vadSensitivity, EngineCallbacks callbacks);
    void stop();

    void setMuted(bool muted);
    bool isMuted() const { return micMuted_.load(std::memory_order_acquire); }

    void setState(EngineState newState);
    EngineState state() const { return static_cast<EngineState>(state_.load(std::memory_order_acquire)); }

    void setVadSensitivity(float sensitivity);
    void commitTurn();

    /**
     * Requests a 5ms raised-cosine fade-out + playback ring flush and stops current turn output.
     * Returns the interpolated character watermark actually played out of the speaker.
     */
    int32_t interruptPlaybackAndAdvanceEpoch();

    /**
     * Called by TTS streamer to push decoded 24kHz mono PCM16 frames for a clause.
     * Drops silently if `turnEpoch` no longer matches `currentTurnEpoch_`.
     */
    bool enqueuePlaybackPcm24k(
        const int16_t* samples24k,
        size_t count,
        int32_t turnEpoch,
        int32_t clauseId,
        int32_t charStartOffset,
        int32_t charEndOffset);

    void markTtsTurnFinished(int32_t turnEpoch);

    void notifyRouteChanged();

    int32_t currentTurnEpoch() const { return currentTurnEpoch_.load(std::memory_order_acquire); }
    int32_t inputSessionId() const { return inputSessionId_.load(std::memory_order_acquire); }
    int32_t hwOutputSampleRate() const { return hwOutSampleRate_.load(std::memory_order_acquire); }
    int32_t getCommittedCharOffset() const { return committedCharEnd_.load(std::memory_order_acquire); }

private:
    class InputCallback;
    class OutputCallback;
    class StreamErrorCallback;

    bool openStreamsLocked();
    void closeStreamsLocked();
    void reopenStreams();

    oboe::DataCallbackResult onInputReady(void* audioData, int32_t numFrames);
    oboe::DataCallbackResult onOutputReady(void* audioData, int32_t numFrames);
    void vadLoop();

    void updateWatermarkConsumer(uint64_t played24kSample);
    void flushOldEpochPlaybackLocked();
    void transitionState(EngineState nextState);

    EngineCallbacks callbacks_;

    std::mutex streamMutex_;
    std::shared_ptr<oboe::AudioStream> inStream_;
    std::shared_ptr<oboe::AudioStream> outStream_;
    std::unique_ptr<InputCallback> inCallback_;
    std::unique_ptr<OutputCallback> outCallback_;
    std::unique_ptr<StreamErrorCallback> errorCallback_;

    CaptureRingBuffer captureRing_;
    PlaybackRingBuffer playbackRing_;
    SegmentQueue segmentQueue_;

    StreamingResampler captureResampler_;

    // Output 24kHz -> hwOutRate resampler state (owned solely by output callback thread)
    double outFracPhase_ = 0.0;
    float outHist_[4]{0.0f, 0.0f, 0.0f, 0.0f};
    bool outHistInitialized_ = false;
    float outSpeakerEnv_ = 0.0f;
    PlaybackSegment activeSeg_{};
    bool hasActiveSeg_ = false;
    uint64_t totalPlayed24kSamples_ = 0;

    std::atomic<bool> running_{false};
    std::atomic<bool> micMuted_{false};
    std::atomic<bool> useOsAsrFallback_{false};
    std::atomic<bool> manualCommitRequested_{false};
    std::atomic<bool> reopenRequested_{false};
    std::atomic<bool> fadeAndFlushRequested_{false};
    std::atomic<bool> fadeOutActive_{false};
    std::atomic<bool> speakingTriggeredForEpoch_{false};
    std::atomic<bool> ttsTurnFinished_{false};
    std::atomic<bool> playbackCompleteReady_{false};

    std::atomic<int32_t> state_{static_cast<int32_t>(EngineState::Idle)};
    std::atomic<int32_t> currentTurnEpoch_{1};
    std::atomic<int32_t> fadeAndFlushEpoch_{0};
    std::atomic<int32_t> lastStartedWriteEpoch_{0};
    std::atomic<int32_t> finishedTtsEpoch_{0};
    std::atomic<int32_t> inputSessionId_{-1};
    std::atomic<int32_t> hwInSampleRate_{48000};
    std::atomic<int32_t> hwOutSampleRate_{48000};
    std::atomic<int32_t> hwInChannels_{1};
    std::atomic<int32_t> hwOutChannels_{1};
    std::atomic<int32_t> committedCharEnd_{0};

    std::atomic<float> vadSensitivity_{0.5f};
    std::atomic<float> currentMicRms_{0.0f};
    std::atomic<float> currentSpeakerRms_{0.0f};
    std::atomic<float> speakerEchoRms_{0.0f};
    std::atomic<int64_t> speakingStartedMs_{0};
    std::atomic<uint64_t> epochPlaybackStartSample_{0};

    // Output callback fade-out state (5ms @ hwOutRate)
    int32_t fadeOutTotalSamples_ = 240;
    int32_t fadeOutRemainingSamples_ = 0;

    // TTS feeder thread state
    std::mutex ttsWriteMutex_;
    int32_t lastWrittenClauseEpoch_ = -1;
    int32_t fadeInRemaining24k_ = 0;

    std::thread vadThread_;
    std::mutex vadCvMutex_;
    std::condition_variable vadCv_;
};

} // namespace aotg::audio
