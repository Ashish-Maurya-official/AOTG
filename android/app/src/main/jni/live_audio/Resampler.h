#pragma once

#include <cstddef>
#include <cstdint>

namespace aotg::audio {

/**
 * Stateful anti-aliased Catmull-Rom / cubic Hermite resampler with stereo-to-mono
 * downmix support. Zero heap allocations per process() call.
 */
class StreamingResampler {
public:
    StreamingResampler() = default;

    void reset(uint32_t srcRate, uint32_t dstRate);

    uint32_t srcRate() const { return srcRate_; }
    uint32_t dstRate() const { return dstRate_; }

    /**
     * Resamples interleaved PCM16 input (`srcFrames` frames * `srcChannels`) into
     * mono PCM16 output buffer `dst` up to `maxDstFrames`. Returns frames written.
     */
    size_t process(
        const int16_t* src,
        size_t srcFrames,
        uint16_t srcChannels,
        int16_t* dst,
        size_t maxDstFrames);

private:
    uint32_t srcRate_ = 16000;
    uint32_t dstRate_ = 16000;
    double step_ = 1.0;
    double fracPhase_ = 0.0;
    float lpAlpha_ = 1.0f;
    float lpState_ = 0.0f;
    float h_[4]{0.0f, 0.0f, 0.0f, 0.0f};
    bool initialized_ = false;
};

} // namespace aotg::audio
