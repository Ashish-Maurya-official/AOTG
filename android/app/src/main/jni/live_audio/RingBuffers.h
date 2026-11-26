#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace aotg::audio {

/**
 * Lock-free Single-Producer Single-Consumer (SPSC) ring buffer with
 * power-of-two capacity using monotonic 64-bit read/write indices.
 * Safe for real-time audio callbacks (zero locks, zero allocations).
 */
template <typename T, size_t Capacity>
class SpscRingBuffer {
    static_assert(Capacity >= 2 && (Capacity & (Capacity - 1)) == 0,
                  "Capacity must be a power of two >= 2");

public:
    static constexpr size_t kCapacity = Capacity;
    static constexpr size_t kMask = Capacity - 1;

    SpscRingBuffer() = default;

    void reset() {
        readIdx_.store(0, std::memory_order_release);
        writeIdx_.store(0, std::memory_order_release);
    }

    /**
     * Advances read index to discard all buffered data.
     * Note: Intended for reset/flush coordination when paired with fade-out.
     */
    void clearConsumer() {
        const uint64_t w = writeIdx_.load(std::memory_order_acquire);
        readIdx_.store(w, std::memory_order_release);
    }

    size_t availableToRead() const {
        const uint64_t w = writeIdx_.load(std::memory_order_acquire);
        const uint64_t r = readIdx_.load(std::memory_order_acquire);
        return (w >= r) ? static_cast<size_t>(std::min<uint64_t>(w - r, Capacity)) : 0;
    }

    size_t availableToWrite() const {
        return Capacity - availableToRead();
    }

    uint64_t writePosition() const {
        return writeIdx_.load(std::memory_order_acquire);
    }

    uint64_t readPosition() const {
        return readIdx_.load(std::memory_order_acquire);
    }

    size_t write(const T* data, size_t count) {
        if (!data || count == 0) return 0;
        const uint64_t w = writeIdx_.load(std::memory_order_relaxed);
        const uint64_t r = readIdx_.load(std::memory_order_acquire);
        const size_t freeSpace = (w >= r && (w - r) <= Capacity)
                                     ? (Capacity - static_cast<size_t>(w - r))
                                     : 0;
        const size_t toWrite = std::min(count, freeSpace);
        if (toWrite == 0) return 0;

        const size_t startSlot = static_cast<size_t>(w & kMask);
        const size_t firstPart = std::min(toWrite, Capacity - startSlot);
        std::memcpy(&buffer_[startSlot], data, firstPart * sizeof(T));
        if (toWrite > firstPart) {
            std::memcpy(&buffer_[0], data + firstPart, (toWrite - firstPart) * sizeof(T));
        }

        writeIdx_.store(w + toWrite, std::memory_order_release);
        return toWrite;
    }

    size_t read(T* out, size_t count) {
        if (!out || count == 0) return 0;
        const uint64_t r = readIdx_.load(std::memory_order_relaxed);
        const uint64_t w = writeIdx_.load(std::memory_order_acquire);
        const size_t avail = (w > r) ? static_cast<size_t>(w - r) : 0;
        const size_t toRead = std::min(count, avail);
        if (toRead == 0) return 0;

        const size_t startSlot = static_cast<size_t>(r & kMask);
        const size_t firstPart = std::min(toRead, Capacity - startSlot);
        std::memcpy(out, &buffer_[startSlot], firstPart * sizeof(T));
        if (toRead > firstPart) {
            std::memcpy(out + firstPart, &buffer_[0], (toRead - firstPart) * sizeof(T));
        }

        readIdx_.store(r + toRead, std::memory_order_release);
        return toRead;
    }

    bool peek(T* out) const {
        if (!out) return false;
        const uint64_t r = readIdx_.load(std::memory_order_relaxed);
        const uint64_t w = writeIdx_.load(std::memory_order_acquire);
        if (w <= r) return false;
        *out = buffer_[static_cast<size_t>(r & kMask)];
        return true;
    }

    size_t discard(size_t count) {
        const uint64_t r = readIdx_.load(std::memory_order_relaxed);
        const uint64_t w = writeIdx_.load(std::memory_order_acquire);
        const size_t avail = (w > r) ? static_cast<size_t>(w - r) : 0;
        const size_t toDiscard = std::min(count, avail);
        readIdx_.store(r + toDiscard, std::memory_order_release);
        return toDiscard;
    }

private:
    alignas(64) std::atomic<uint64_t> writeIdx_{0};
    alignas(64) std::atomic<uint64_t> readIdx_{0};
    std::array<T, Capacity> buffer_{};
};

struct PlaybackSegment {
    uint64_t startSampleIdx = 0;
    uint64_t endSampleIdx = 0;
    int32_t turnEpoch = 0;
    int32_t clauseId = 0;
    int32_t charStartOffset = 0;
    int32_t charEndOffset = 0;
};

/**
 * Rolling circular pre-roll buffer (single-threaded on VAD worker) to capture
 * up to 400ms of audio preceding VAD onset detection.
 */
template <size_t MaxSamples>
class PreRollBuffer {
public:
    void reset() {
        head_ = 0;
        size_ = 0;
    }

    void push(const int16_t* samples, size_t count) {
        if (!samples || count == 0) return;
        if (count >= MaxSamples) {
            const int16_t* tail = samples + (count - MaxSamples);
            std::memcpy(data_.data(), tail, MaxSamples * sizeof(int16_t));
            head_ = 0;
            size_ = MaxSamples;
            return;
        }
        for (size_t i = 0; i < count; ++i) {
            data_[head_] = samples[i];
            head_ = (head_ + 1) % MaxSamples;
            if (size_ < MaxSamples) {
                ++size_;
            }
        }
    }

    size_t drainTo(int16_t* out, size_t maxOut) {
        if (!out || size_ == 0 || maxOut == 0) return 0;
        const size_t toCopy = std::min(size_, maxOut);
        const size_t start = (head_ + MaxSamples - toCopy) % MaxSamples;
        const size_t firstPart = std::min(toCopy, MaxSamples - start);
        std::memcpy(out, &data_[start], firstPart * sizeof(int16_t));
        if (toCopy > firstPart) {
            std::memcpy(out + firstPart, &data_[0], (toCopy - firstPart) * sizeof(int16_t));
        }
        reset();
        return toCopy;
    }

    size_t size() const { return size_; }

private:
    std::array<int16_t, MaxSamples> data_{};
    size_t head_ = 0;
    size_t size_ = 0;
};

// 16kHz * 4.096s = 65536 samples
using CaptureRingBuffer = SpscRingBuffer<int16_t, 65536>;
// 24kHz * ~10.92s = 262144 samples
using PlaybackRingBuffer = SpscRingBuffer<int16_t, 262144>;
using SegmentQueue = SpscRingBuffer<PlaybackSegment, 2048>;

} // namespace aotg::audio
