#include "Resampler.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace aotg::audio {

namespace {

inline float clampPcmFloat(float v) {
    if (v > 32767.0f) return 32767.0f;
    if (v < -32768.0f) return -32768.0f;
    return v;
}

inline float cubicCatmullRom(float y0, float y1, float y2, float y3, float t) {
    const float t2 = t * t;
    const float t3 = t2 * t;
    return 0.5f * ((2.0f * y1) +
                   (-y0 + y2) * t +
                   (2.0f * y0 - 5.0f * y1 + 4.0f * y2 - y3) * t2 +
                   (-y0 + 3.0f * y1 - 3.0f * y2 + y3) * t3);
}

} // namespace

void StreamingResampler::reset(uint32_t srcRate, uint32_t dstRate) {
    srcRate_ = (srcRate > 0) ? srcRate : 16000;
    dstRate_ = (dstRate > 0) ? dstRate : 16000;
    step_ = static_cast<double>(srcRate_) / static_cast<double>(dstRate_);
    fracPhase_ = 0.0;
    if (srcRate_ > dstRate_) {
        // Gentle anti-aliasing single-pole lowpass near ~0.42 * dstRate Nyquist.
        const float ratio = static_cast<float>(dstRate_) / static_cast<float>(srcRate_);
        lpAlpha_ = std::clamp(ratio * 1.35f, 0.08f, 1.0f);
    } else {
        lpAlpha_ = 1.0f;
    }
    lpState_ = 0.0f;
    std::memset(h_, 0, sizeof(h_));
    initialized_ = false;
}

size_t StreamingResampler::process(
    const int16_t* src,
    size_t srcFrames,
    uint16_t srcChannels,
    int16_t* dst,
    size_t maxDstFrames) {
    if (!src || !dst || srcFrames == 0 || maxDstFrames == 0 || srcChannels == 0) {
        return 0;
    }

    if (srcRate_ == dstRate_ && srcChannels == 1) {
        const size_t n = std::min(srcFrames, maxDstFrames);
        std::memcpy(dst, src, n * sizeof(int16_t));
        return n;
    }

    size_t outCount = 0;

    for (size_t i = 0; i < srcFrames; ++i) {
        float mono = 0.0f;
        if (srcChannels == 1) {
            mono = static_cast<float>(src[i]);
        } else {
            int32_t sum = 0;
            const size_t base = i * srcChannels;
            for (uint16_t ch = 0; ch < srcChannels; ++ch) {
                sum += static_cast<int32_t>(src[base + ch]);
            }
            mono = static_cast<float>(sum) / static_cast<float>(srcChannels);
        }

        if (lpAlpha_ < 0.999f) {
            lpState_ = lpAlpha_ * mono + (1.0f - lpAlpha_) * lpState_;
            mono = lpState_;
        }

        if (!initialized_) {
            h_[0] = mono;
            h_[1] = mono;
            h_[2] = mono;
            h_[3] = mono;
            initialized_ = true;
        } else {
            h_[0] = h_[1];
            h_[1] = h_[2];
            h_[2] = h_[3];
            h_[3] = mono;
        }

        while (fracPhase_ < 1.0 && outCount < maxDstFrames) {
            const float sample = cubicCatmullRom(
                h_[0], h_[1], h_[2], h_[3], static_cast<float>(fracPhase_));
            dst[outCount++] = static_cast<int16_t>(std::lrintf(clampPcmFloat(sample)));
            fracPhase_ += step_;
        }
        fracPhase_ -= 1.0;
    }

    return outCount;
}

} // namespace aotg::audio
