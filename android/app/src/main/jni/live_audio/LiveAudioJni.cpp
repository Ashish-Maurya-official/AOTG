#include <jni.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "OboeAudioEngine.h"
#include "Resampler.h"
#include "SanitizerAndChunker.h"
#include "WavHeader.h"

namespace {

JavaVM* gJvm = nullptr;
jobject gModuleGlobalRef = nullptr;
std::mutex gBridgeMutex;

jmethodID gMidEvaluateVad = nullptr;
jmethodID gMidOnAudioLevel = nullptr;
jmethodID gMidOnSpeechTurnReady = nullptr;
jmethodID gMidOnAsrPcmFrame = nullptr;
jmethodID gMidOnStateChanged = nullptr;
jmethodID gMidOnBargeIn = nullptr;
jmethodID gMidOnPlaybackComplete = nullptr;
jmethodID gMidOnVadSpeechState = nullptr;
jmethodID gMidOnInputSessionOpened = nullptr;
jmethodID gMidOnError = nullptr;

// Thread-local JNI environment + cached jfloatArray for zero-alloc VAD calls on vadThread_
thread_local JNIEnv* tVadEnv = nullptr;
thread_local bool tAttached = false;
thread_local jfloatArray tVadInputArray = nullptr;

std::unique_ptr<aotg::audio::OboeAudioEngine> gEngine;
aotg::audio::SanitizerAndChunker gChunker;
std::mutex gChunkerMutex;

std::mutex gTtsResamplerMutex;
aotg::audio::StreamingResampler gTtsResampler;
int32_t gTtsResamplerEpoch = -1;
int32_t gTtsResamplerSrcRate = 0;

std::string jstringToStdUtf8(JNIEnv* env, jstring jstr) {
    if (!env || !jstr) return {};
    const jsize len = env->GetStringLength(jstr);
    if (len <= 0) return {};
    const jchar* chars = env->GetStringChars(jstr, nullptr);
    if (!chars) return {};

    std::string out;
    out.reserve(static_cast<size_t>(len) * 2);
    for (jsize i = 0; i < len; ++i) {
        uint32_t cp = chars[i];
        if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < len) {
            const uint32_t low = chars[i + 1];
            if (low >= 0xDC00 && low <= 0xDFFF) {
                cp = 0x10000 + (((cp - 0xD800) << 10) | (low - 0xDC00));
                ++i;
            }
        }
        if (cp < 0x80) {
            out.push_back(static_cast<char>(cp));
        } else if (cp < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else if (cp < 0x10000) {
            out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        }
    }
    env->ReleaseStringChars(jstr, chars);
    return out;
}

jstring stdUtf8ToJstring(JNIEnv* env, const std::string& utf8) {
    std::vector<jchar> utf16;
    utf16.reserve(utf8.size());
    const size_t n = utf8.size();
    size_t i = 0;
    while (i < n) {
        const uint8_t b0 = static_cast<uint8_t>(utf8[i]);
        uint32_t cp = 0xFFFD;
        if (b0 < 0x80) {
            cp = b0;
            i += 1;
        } else if ((b0 & 0xE0) == 0xC0 && i + 1 < n) {
            const uint8_t b1 = static_cast<uint8_t>(utf8[i + 1]);
            if ((b1 & 0xC0) == 0x80) {
                cp = ((b0 & 0x1F) << 6) | (b1 & 0x3F);
                i += 2;
            } else {
                i += 1;
            }
        } else if ((b0 & 0xF0) == 0xE0 && i + 2 < n) {
            const uint8_t b1 = static_cast<uint8_t>(utf8[i + 1]);
            const uint8_t b2 = static_cast<uint8_t>(utf8[i + 2]);
            if ((b1 & 0xC0) == 0x80 && (b2 & 0xC0) == 0x80) {
                cp = ((b0 & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F);
                i += 3;
            } else {
                i += 1;
            }
        } else if ((b0 & 0xF8) == 0xF0 && i + 3 < n) {
            const uint8_t b1 = static_cast<uint8_t>(utf8[i + 1]);
            const uint8_t b2 = static_cast<uint8_t>(utf8[i + 2]);
            const uint8_t b3 = static_cast<uint8_t>(utf8[i + 3]);
            if ((b1 & 0xC0) == 0x80 && (b2 & 0xC0) == 0x80 && (b3 & 0xC0) == 0x80) {
                cp = ((b0 & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F);
                i += 4;
            } else {
                i += 1;
            }
        } else {
            i += 1;
        }

        if (cp <= 0xFFFF) {
            if (cp >= 0xD800 && cp <= 0xDFFF) {
                cp = 0xFFFD;
            }
            utf16.push_back(static_cast<jchar>(cp));
        } else if (cp <= 0x10FFFF) {
            cp -= 0x10000;
            utf16.push_back(static_cast<jchar>(0xD800 + (cp >> 10)));
            utf16.push_back(static_cast<jchar>(0xDC00 + (cp & 0x3FF)));
        } else {
            utf16.push_back(0xFFFD);
        }
    }
    static const jchar kEmptyJchar = 0;
    return env->NewString(utf16.empty() ? &kEmptyJchar : utf16.data(), static_cast<jsize>(utf16.size()));
}

int32_t utf8ByteOffsetToUtf16(const std::string& utf8, int32_t byteOffset) {
    const size_t limit = std::min(utf8.size(), static_cast<size_t>(std::max<int32_t>(0, byteOffset)));
    int32_t utf16Count = 0;
    size_t i = 0;
    while (i < limit) {
        const uint8_t b0 = static_cast<uint8_t>(utf8[i]);
        if (b0 < 0x80) {
            i += 1;
            utf16Count += 1;
        } else if ((b0 & 0xE0) == 0xC0) {
            i += 2;
            utf16Count += 1;
        } else if ((b0 & 0xF0) == 0xE0) {
            i += 3;
            utf16Count += 1;
        } else if ((b0 & 0xF8) == 0xF0) {
            i += 4;
            utf16Count += 2;
        } else {
            i += 1;
            utf16Count += 1;
        }
    }
    return utf16Count;
}

void attachVadThread() {
    if (!gJvm) return;
    JNIEnv* env = nullptr;
    if (gJvm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) == JNI_EDETACHED) {
        if (gJvm->AttachCurrentThread(&env, nullptr) == JNI_OK) {
            tVadEnv = env;
            tAttached = true;
        }
    } else {
        tVadEnv = env;
        tAttached = false;
    }
    if (tVadEnv) {
        jfloatArray localArr = tVadEnv->NewFloatArray(576);
        if (localArr) {
            tVadInputArray = reinterpret_cast<jfloatArray>(tVadEnv->NewGlobalRef(localArr));
            tVadEnv->DeleteLocalRef(localArr);
        }
    }
}

void detachVadThread() {
    if (tVadEnv && tVadInputArray) {
        tVadEnv->DeleteGlobalRef(tVadInputArray);
        tVadInputArray = nullptr;
    }
    if (tAttached && gJvm) {
        gJvm->DetachCurrentThread();
        tAttached = false;
    }
    tVadEnv = nullptr;
}

jobject getTargetRef() {
    std::lock_guard<std::mutex> lock(gBridgeMutex);
    return gModuleGlobalRef;
}

void clearPendingJniException(JNIEnv* env) {
    if (env && env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
    }
}

void resetTtsResamplerState() {
    std::lock_guard<std::mutex> resLock(gTtsResamplerMutex);
    gTtsResampler.reset(24000u, 24000u);
    gTtsResamplerEpoch = -1;
    gTtsResamplerSrcRate = 0;
}

} // namespace

extern "C" {

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /*reserved*/) {
    gJvm = vm;
    return JNI_VERSION_1_6;
}

JNIEXPORT void JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeInitBridge(
    JNIEnv* env,
    jobject thiz) {
    std::lock_guard<std::mutex> lock(gBridgeMutex);
    if (!gJvm) {
        env->GetJavaVM(&gJvm);
    }
    if (gModuleGlobalRef) {
        env->DeleteGlobalRef(gModuleGlobalRef);
        gModuleGlobalRef = nullptr;
    }
    gModuleGlobalRef = env->NewGlobalRef(thiz);

    jclass cls = env->GetObjectClass(thiz);
    gMidEvaluateVad = env->GetMethodID(cls, "onNativeEvaluateVad", "([F)F");
    gMidOnAudioLevel = env->GetMethodID(cls, "onNativeAudioLevel", "(FFF)V");
    gMidOnSpeechTurnReady = env->GetMethodID(cls, "onNativeSpeechTurnReady", "([B)V");
    gMidOnAsrPcmFrame = env->GetMethodID(cls, "onNativeAsrPcmFrame", "([B)V");
    gMidOnStateChanged = env->GetMethodID(cls, "onNativeStateChanged", "(II)V");
    gMidOnBargeIn = env->GetMethodID(cls, "onNativeBargeIn", "(II)V");
    gMidOnPlaybackComplete = env->GetMethodID(cls, "onNativePlaybackComplete", "(I)V");
    gMidOnVadSpeechState = env->GetMethodID(cls, "onNativeVadSpeechState", "(Z)V");
    gMidOnInputSessionOpened = env->GetMethodID(cls, "onNativeInputSessionOpened", "(I)V");
    gMidOnError = env->GetMethodID(cls, "onNativeError", "(Ljava/lang/String;)V");
    env->DeleteLocalRef(cls);

    if (!gEngine) {
        gEngine = std::make_unique<aotg::audio::OboeAudioEngine>();
    }
}

JNIEXPORT void JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeDestroyBridge(
    JNIEnv* env,
    jobject /*thiz*/) {
    if (gEngine) {
        gEngine->stop();
        gEngine.reset();
    }
    resetTtsResamplerState();
    std::lock_guard<std::mutex> lock(gBridgeMutex);
    if (gModuleGlobalRef) {
        env->DeleteGlobalRef(gModuleGlobalRef);
        gModuleGlobalRef = nullptr;
    }
}

JNIEXPORT jboolean JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeStartAudio(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jboolean useOsAsrFallback,
    jfloat vadSensitivity) {
    if (!gEngine) {
        gEngine = std::make_unique<aotg::audio::OboeAudioEngine>();
    }
    resetTtsResamplerState();

    aotg::audio::EngineCallbacks cbs;
    cbs.onVadThreadStart = []() { attachVadThread(); };
    cbs.onVadThreadStop = []() { detachVadThread(); };

    cbs.evaluateVad = [](const float* samples576, size_t count) -> float {
        jobject ref = getTargetRef();
        if (!tVadEnv || !ref || !gMidEvaluateVad || !tVadInputArray || count != 576) {
            return -1.0f;
        }
        tVadEnv->SetFloatArrayRegion(tVadInputArray, 0, 576, samples576);
        const float prob = tVadEnv->CallFloatMethod(ref, gMidEvaluateVad, tVadInputArray);
        if (tVadEnv->ExceptionCheck()) {
            clearPendingJniException(tVadEnv);
            return -1.0f;
        }
        return prob;
    };

    cbs.onAudioLevel = [](float micRms, float speakerRms, float vadProb) {
        jobject ref = getTargetRef();
        if (tVadEnv && ref && gMidOnAudioLevel) {
            tVadEnv->CallVoidMethod(ref, gMidOnAudioLevel, micRms, speakerRms, vadProb);
            clearPendingJniException(tVadEnv);
        }
    };

    cbs.onSpeechTurnReady = [](const std::vector<uint8_t>& wavBytes) {
        jobject ref = getTargetRef();
        if (!tVadEnv || !ref || !gMidOnSpeechTurnReady || wavBytes.empty()) return;
        jbyteArray arr = tVadEnv->NewByteArray(static_cast<jsize>(wavBytes.size()));
        if (!arr) {
            clearPendingJniException(tVadEnv);
            return;
        }
        tVadEnv->SetByteArrayRegion(
            arr, 0, static_cast<jsize>(wavBytes.size()),
            reinterpret_cast<const jbyte*>(wavBytes.data()));
        tVadEnv->CallVoidMethod(ref, gMidOnSpeechTurnReady, arr);
        clearPendingJniException(tVadEnv);
        tVadEnv->DeleteLocalRef(arr);
    };

    cbs.onAsrPcmFrame = [](const int16_t* pcm512, size_t count) {
        jobject ref = getTargetRef();
        if (!tVadEnv || !ref || !gMidOnAsrPcmFrame || !pcm512 || count == 0) return;
        const jsize byteLen = static_cast<jsize>(count * sizeof(int16_t));
        jbyteArray arr = tVadEnv->NewByteArray(byteLen);
        if (!arr) {
            clearPendingJniException(tVadEnv);
            return;
        }
        tVadEnv->SetByteArrayRegion(
            arr, 0, byteLen,
            reinterpret_cast<const jbyte*>(pcm512));
        tVadEnv->CallVoidMethod(ref, gMidOnAsrPcmFrame, arr);
        clearPendingJniException(tVadEnv);
        tVadEnv->DeleteLocalRef(arr);
    };

    cbs.onStateChanged = [](int32_t prevState, int32_t nextState) {
        jobject ref = getTargetRef();
        if (tVadEnv && ref && gMidOnStateChanged) {
            tVadEnv->CallVoidMethod(ref, gMidOnStateChanged, prevState, nextState);
            clearPendingJniException(tVadEnv);
        }
    };

    cbs.onBargeIn = [](int32_t charOffset, int32_t turnEpoch) {
        jobject ref = getTargetRef();
        if (tVadEnv && ref && gMidOnBargeIn) {
            tVadEnv->CallVoidMethod(ref, gMidOnBargeIn, charOffset, turnEpoch);
            clearPendingJniException(tVadEnv);
        }
    };

    cbs.onPlaybackComplete = [](int32_t turnEpoch) {
        jobject ref = getTargetRef();
        if (tVadEnv && ref && gMidOnPlaybackComplete) {
            tVadEnv->CallVoidMethod(ref, gMidOnPlaybackComplete, turnEpoch);
            clearPendingJniException(tVadEnv);
        }
    };

    cbs.onVadSpeechState = [](bool speaking) {
        jobject ref = getTargetRef();
        if (tVadEnv && ref && gMidOnVadSpeechState) {
            tVadEnv->CallVoidMethod(ref, gMidOnVadSpeechState, speaking ? JNI_TRUE : JNI_FALSE);
            clearPendingJniException(tVadEnv);
        }
    };

    cbs.onInputSessionOpened = [](int32_t sessionId) {
        // Note: called during start() on caller thread OR reopen on vadThread_
        JNIEnv* env = tVadEnv;
        bool needDetach = false;
        if (!env && gJvm) {
            if (gJvm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) == JNI_EDETACHED) {
                if (gJvm->AttachCurrentThread(&env, nullptr) == JNI_OK) needDetach = true;
            }
        }
        jobject ref = getTargetRef();
        if (env && ref && gMidOnInputSessionOpened) {
            env->CallVoidMethod(ref, gMidOnInputSessionOpened, sessionId);
            clearPendingJniException(env);
        }
        if (needDetach && gJvm) {
            gJvm->DetachCurrentThread();
        }
    };

    cbs.onError = [](const std::string& msg) {
        jobject ref = getTargetRef();
        if (tVadEnv && ref && gMidOnError) {
            jstring jmsg = stdUtf8ToJstring(tVadEnv, msg);
            if (jmsg) {
                tVadEnv->CallVoidMethod(ref, gMidOnError, jmsg);
                clearPendingJniException(tVadEnv);
                tVadEnv->DeleteLocalRef(jmsg);
            }
        }
    };

    return gEngine->start(useOsAsrFallback == JNI_TRUE, vadSensitivity, std::move(cbs)) ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeStopAudio(
    JNIEnv* /*env*/,
    jobject /*thiz*/) {
    if (gEngine) {
        gEngine->stop();
    }
    resetTtsResamplerState();
}

JNIEXPORT void JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeSetMuted(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jboolean muted) {
    if (gEngine) {
        gEngine->setMuted(muted == JNI_TRUE);
    }
}

JNIEXPORT void JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeSetState(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jint stateInt) {
    if (gEngine) {
        gEngine->setState(static_cast<aotg::audio::EngineState>(stateInt));
    }
}

JNIEXPORT void JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeCommitTurn(
    JNIEnv* /*env*/,
    jobject /*thiz*/) {
    if (gEngine) {
        gEngine->commitTurn();
    }
}

JNIEXPORT jint JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeInterruptPlayback(
    JNIEnv* /*env*/,
    jobject /*thiz*/) {
    return gEngine ? gEngine->interruptPlaybackAndAdvanceEpoch() : 0;
}

JNIEXPORT jint JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeGetTurnEpoch(
    JNIEnv* /*env*/,
    jobject /*thiz*/) {
    return gEngine ? gEngine->currentTurnEpoch() : 0;
}

JNIEXPORT jint JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeGetHwSampleRate(
    JNIEnv* /*env*/,
    jobject /*thiz*/) {
    return gEngine ? gEngine->hwOutputSampleRate() : 48000;
}

JNIEXPORT void JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeNotifyRouteChanged(
    JNIEnv* /*env*/,
    jobject /*thiz*/) {
    if (gEngine) {
        gEngine->notifyRouteChanged();
    }
}

JNIEXPORT jboolean JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeEnqueueWavClause(
    JNIEnv* env,
    jobject /*thiz*/,
    jbyteArray wavBytes,
    jint turnEpoch,
    jint clauseId,
    jint charStartOffset,
    jint charEndOffset) {
    if (!gEngine || !wavBytes) return JNI_FALSE;
    const jsize len = env->GetArrayLength(wavBytes);
    if (len <= 44) return JNI_FALSE;

    jbyte* raw = env->GetByteArrayElements(wavBytes, nullptr);
    if (!raw) return JNI_FALSE;

    const auto fmt = aotg::audio::parseWavHeader(
        reinterpret_cast<const uint8_t*>(raw), static_cast<size_t>(len));
    if (!fmt.valid || fmt.dataOffset + fmt.dataSize > static_cast<size_t>(len)) {
        env->ReleaseByteArrayElements(wavBytes, raw, JNI_ABORT);
        return JNI_FALSE;
    }

    const int16_t* pcmPtr = reinterpret_cast<const int16_t*>(
        reinterpret_cast<const uint8_t*>(raw) + fmt.dataOffset);
    const size_t totalFrames = fmt.dataSize / (fmt.numChannels * sizeof(int16_t));

    aotg::audio::StreamingResampler resampler;
    resampler.reset(fmt.sampleRate, 24000u);

    const size_t outCap = static_cast<size_t>(
        (static_cast<uint64_t>(totalFrames) * 24000ull) / fmt.sampleRate + 64ull);
    std::vector<int16_t> pcm24k(outCap);
    const size_t written24k = resampler.process(
        pcmPtr, totalFrames, fmt.numChannels, pcm24k.data(), pcm24k.size());

    env->ReleaseByteArrayElements(wavBytes, raw, JNI_ABORT);

    if (written24k == 0) return JNI_FALSE;
    return gEngine->enqueuePlaybackPcm24k(
        pcm24k.data(), written24k, turnEpoch, clauseId, charStartOffset, charEndOffset)
        ? JNI_TRUE
        : JNI_FALSE;
}

JNIEXPORT jboolean JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeEnqueuePcmChunk(
    JNIEnv* env,
    jobject /*thiz*/,
    jbyteArray pcmBytes,
    jint sampleRate,
    jint channels,
    jint turnEpoch,
    jint clauseId,
    jint charStartOffset,
    jint charEndOffset) {
    if (!gEngine || !pcmBytes) return JNI_FALSE;
    if (turnEpoch != gEngine->currentTurnEpoch()) return JNI_FALSE;
    const jsize byteLen = env->GetArrayLength(pcmBytes);
    if (channels < 1 || sampleRate < 8000) return JNI_FALSE;
    if (byteLen < 2) return JNI_TRUE;

    jbyte* raw = env->GetByteArrayElements(pcmBytes, nullptr);
    if (!raw) return JNI_FALSE;

    const size_t totalFrames = static_cast<size_t>(byteLen) / (static_cast<size_t>(channels) * sizeof(int16_t));
    if (totalFrames == 0) {
        env->ReleaseByteArrayElements(pcmBytes, raw, JNI_ABORT);
        return JNI_TRUE;
    }
    const size_t outCap = static_cast<size_t>(
        (static_cast<uint64_t>(totalFrames) * 24000ull) / static_cast<uint64_t>(sampleRate) + 64ull);
    std::vector<int16_t> pcm24k(outCap);
    size_t written24k = 0;
    {
        std::lock_guard<std::mutex> resLock(gTtsResamplerMutex);
        if (gTtsResamplerEpoch != turnEpoch || gTtsResamplerSrcRate != sampleRate) {
            gTtsResampler.reset(static_cast<uint32_t>(sampleRate), 24000u);
            gTtsResamplerEpoch = turnEpoch;
            gTtsResamplerSrcRate = sampleRate;
        }
        written24k = gTtsResampler.process(
            reinterpret_cast<const int16_t*>(raw),
            totalFrames,
            static_cast<uint16_t>(channels),
            pcm24k.data(),
            pcm24k.size());
    }

    env->ReleaseByteArrayElements(pcmBytes, raw, JNI_ABORT);
    if (written24k == 0) {
        return (turnEpoch == gEngine->currentTurnEpoch()) ? JNI_TRUE : JNI_FALSE;
    }

    return gEngine->enqueuePlaybackPcm24k(
        pcm24k.data(), written24k, turnEpoch, clauseId, charStartOffset, charEndOffset)
        ? JNI_TRUE
        : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeMarkTtsFinished(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jint turnEpoch) {
    if (gEngine) {
        gEngine->markTtsTurnFinished(turnEpoch);
    }
}

JNIEXPORT void JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativeResetChunker(
    JNIEnv* /*env*/,
    jobject /*thiz*/) {
    std::lock_guard<std::mutex> lock(gChunkerMutex);
    gChunker.reset();
}

JNIEXPORT jobjectArray JNICALL
Java_com_ashish_technologies_aotg_turbo_1modules_liveaudio_LiveAudioModule_nativePushChunkerToken(
    JNIEnv* env,
    jobject /*thiz*/,
    jstring rawToken,
    jboolean isFinalFlush) {
    std::lock_guard<std::mutex> lock(gChunkerMutex);

    std::string delta;
    std::vector<aotg::audio::EmittedClause> clauses;

    if (rawToken) {
        const std::string utf8 = jstringToStdUtf8(env, rawToken);
        if (!utf8.empty()) {
            clauses = gChunker.pushToken(utf8, &delta);
        }
    }
    if (isFinalFlush == JNI_TRUE) {
        auto tail = gChunker.flush(&delta);
        clauses.insert(clauses.end(), tail.begin(), tail.end());
    }

    // Return flat String array: [sanitizedDelta, fullSanitized, clauseCount, clauseId0, charStart0, charEnd0, clauseText0, ...]
    jclass strCls = env->FindClass("java/lang/String");
    if (!strCls) return nullptr;
    const jsize arrLen = static_cast<jsize>(3 + clauses.size() * 4);
    jobjectArray result = env->NewObjectArray(arrLen, strCls, nullptr);
    if (!result) {
        env->DeleteLocalRef(strCls);
        return nullptr;
    }
    const std::string& fullUtf8 = gChunker.fullSanitizedText();

    auto setStr = [&](jsize idx, const std::string& val) {
        jstring js = stdUtf8ToJstring(env, val);
        if (js) {
            env->SetObjectArrayElement(result, idx, js);
            env->DeleteLocalRef(js);
        }
    };

    setStr(0, delta);
    setStr(1, fullUtf8);
    setStr(2, std::to_string(clauses.size()));

    jsize cursor = 3;
    for (const auto& c : clauses) {
        const int32_t u16Start = utf8ByteOffsetToUtf16(fullUtf8, c.charStartOffset);
        const int32_t u16End = utf8ByteOffsetToUtf16(fullUtf8, c.charEndOffset);
        setStr(cursor++, std::to_string(c.clauseId));
        setStr(cursor++, std::to_string(u16Start));
        setStr(cursor++, std::to_string(u16End));
        setStr(cursor++, c.text);
    }

    env->DeleteLocalRef(strCls);
    return result;
}

} // extern "C"
