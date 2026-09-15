if(NOT TARGET hermes-engine::hermesvm)
add_library(hermes-engine::hermesvm SHARED IMPORTED)
set_target_properties(hermes-engine::hermesvm PROPERTIES
    IMPORTED_LOCATION "/private/var/root/.gradle/caches/9.4.1/transforms/82e12f5657b78a2f3001648586ffcf26/transformed/hermes-android-250829098.0.16-debug/prefab/modules/hermesvm/libs/android.armeabi-v7a/libhermesvm.so"
    INTERFACE_INCLUDE_DIRECTORIES "/private/var/root/.gradle/caches/9.4.1/transforms/82e12f5657b78a2f3001648586ffcf26/transformed/hermes-android-250829098.0.16-debug/prefab/modules/hermesvm/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

