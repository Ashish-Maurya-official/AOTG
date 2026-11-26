cmake_minimum_required(VERSION 3.13)

project(appmodules)

include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

find_package(oboe REQUIRED CONFIG)

add_library(aotg_live_audio SHARED
    live_audio/Resampler.cpp
    live_audio/SanitizerAndChunker.cpp
    live_audio/OboeAudioEngine.cpp
    live_audio/LiveAudioJni.cpp
)

target_include_directories(aotg_live_audio PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/live_audio
)

target_compile_features(aotg_live_audio PUBLIC cxx_std_17)

target_link_libraries(aotg_live_audio
    oboe::oboe
    android
    log
)
