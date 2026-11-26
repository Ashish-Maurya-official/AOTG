#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

namespace aotg::audio {

struct WavFormat {
    uint16_t audioFormat = 0;   // 1 = PCM
    uint16_t numChannels = 1;
    uint32_t sampleRate = 24000;
    uint16_t bitsPerSample = 16;
    size_t dataOffset = 0;
    size_t dataSize = 0;
    bool valid = false;
};

inline void writeU32LE(uint8_t* dst, uint32_t v) {
    dst[0] = static_cast<uint8_t>(v & 0xFF);
    dst[1] = static_cast<uint8_t>((v >> 8) & 0xFF);
    dst[2] = static_cast<uint8_t>((v >> 16) & 0xFF);
    dst[3] = static_cast<uint8_t>((v >> 24) & 0xFF);
}

inline void writeU16LE(uint8_t* dst, uint16_t v) {
    dst[0] = static_cast<uint8_t>(v & 0xFF);
    dst[1] = static_cast<uint8_t>((v >> 8) & 0xFF);
}

inline uint32_t readU32LE(const uint8_t* src) {
    return static_cast<uint32_t>(src[0]) |
           (static_cast<uint32_t>(src[1]) << 8) |
           (static_cast<uint32_t>(src[2]) << 16) |
           (static_cast<uint32_t>(src[3]) << 24);
}

inline uint16_t readU16LE(const uint8_t* src) {
    return static_cast<uint16_t>(src[0]) |
           (static_cast<uint16_t>(src[1]) << 8);
}

/**
 * Builds an in-RAM canonical 44-byte RIFF/WAVE header + PCM16 payload.
 * Zero disk I/O.
 */
inline std::vector<uint8_t> buildWavBytes(
    const int16_t* samples,
    size_t numSamples,
    uint32_t sampleRate = 16000,
    uint16_t numChannels = 1) {
    const uint32_t dataBytes = static_cast<uint32_t>(numSamples * sizeof(int16_t));
    const uint32_t riffSize = 36u + dataBytes;
    const uint32_t byteRate = sampleRate * numChannels * 2u;
    const uint16_t blockAlign = static_cast<uint16_t>(numChannels * 2u);

    std::vector<uint8_t> wav(44u + dataBytes);
    uint8_t* p = wav.data();

    std::memcpy(p + 0, "RIFF", 4);
    writeU32LE(p + 4, riffSize);
    std::memcpy(p + 8, "WAVE", 4);
    std::memcpy(p + 12, "fmt ", 4);
    writeU32LE(p + 16, 16u);
    writeU16LE(p + 20, 1u); // PCM
    writeU16LE(p + 22, numChannels);
    writeU32LE(p + 24, sampleRate);
    writeU32LE(p + 28, byteRate);
    writeU16LE(p + 32, blockAlign);
    writeU16LE(p + 34, 16u); // bits per sample
    std::memcpy(p + 36, "data", 4);
    writeU32LE(p + 40, dataBytes);

    if (samples && dataBytes > 0) {
        std::memcpy(p + 44, samples, dataBytes);
    }
    return wav;
}

/**
 * Parses arbitrary RIFF/WAVE chunks (handles extra chunks like LIST/fact/JUNK
 * before 'data' that Android TextToSpeech.synthesizeToFile may emit).
 */
inline WavFormat parseWavHeader(const uint8_t* data, size_t len) {
    WavFormat fmt;
    if (!data || len < 44) return fmt;
    if (std::memcmp(data, "RIFF", 4) != 0 || std::memcmp(data + 8, "WAVE", 4) != 0) {
        return fmt;
    }

    bool foundFmt = false;
    bool foundData = false;
    size_t offset = 12;

    while (offset + 8 <= len) {
        const uint8_t* chunkHdr = data + offset;
        const uint32_t chunkSize = readU32LE(chunkHdr + 4);
        const size_t bodyOffset = offset + 8;

        if (std::memcmp(chunkHdr, "fmt ", 4) == 0 && bodyOffset + 16 <= len) {
            fmt.audioFormat = readU16LE(data + bodyOffset);
            fmt.numChannels = readU16LE(data + bodyOffset + 2);
            fmt.sampleRate = readU32LE(data + bodyOffset + 4);
            fmt.bitsPerSample = readU16LE(data + bodyOffset + 14);
            foundFmt = true;
        } else if (std::memcmp(chunkHdr, "data", 4) == 0) {
            fmt.dataOffset = bodyOffset;
            const size_t remaining = len - bodyOffset;
            // Some streaming/piped TTS writers put 0xFFFFFFFF or 0 until close;
            // clamp cleanly to actual payload if chunkSize exceeds buffer.
            fmt.dataSize = (chunkSize == 0 || chunkSize > remaining) ? remaining : chunkSize;
            foundData = true;
            break;
        }

        const size_t padded = static_cast<size_t>(chunkSize) + (chunkSize & 1u);
        if (bodyOffset + padded <= offset) break; // overflow guard
        offset = bodyOffset + padded;
    }

    fmt.valid = foundFmt && foundData && fmt.audioFormat == 1 &&
                fmt.numChannels >= 1 && fmt.sampleRate >= 8000 && fmt.bitsPerSample == 16;
    return fmt;
}

} // namespace aotg::audio
