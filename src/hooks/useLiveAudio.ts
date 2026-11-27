import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { RootState } from '../store/store';
import {
  AVAILABLE_MODELS,
  setLoadedModel,
  setModelLoadFailed,
  startLoadingModel,
  unloadModel,
} from '../store/slices/llmSlice';
import {
  applyTranscriptDelta,
  applyTtsCapabilities,
  closeLiveTalkModal,
  commitLiveTurn,
  LiveOutputRoute,
  LiveTalkState,
  LiveTtsBackend,
  LiveTtsEnginePref,
  LiveVadBackend,
  openLiveTalkModal,
  seedModalTurns,
  sessionStarted,
  setLiveTalkError,
  setMicMuted,
  setPhononDownloadProgress,
  setPreferredRoute,
  setSessionStarting,
  setSessionState,
  setTtsPreference,
  setVadSpeechActive,
  updateRouteOrFocus,
} from '../store/slices/liveTalkSlice';
import LLMService from '../services/llmService';
import liveAudioService from '../services/liveAudioService';
import { ChatMessage } from '../services/chatStorageService';

export interface UseLiveAudioOptions {
  activeSessionIdRef: React.MutableRefObject<string | null>;
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  onOpenModelSelector: () => void;
  onSessionTurnsPersisted: (sessionId: string, addedMessages: ChatMessage[]) => void;
}

export interface MicPermissionPromptState {
  visible: boolean;
  isPermanentlyDenied: boolean;
  onGrant: () => void;
  onCancel: () => void;
}

export function useLiveAudio(options: UseLiveAudioOptions) {
  const {
    activeSessionIdRef,
    messagesRef,
    onOpenModelSelector,
    onSessionTurnsPersisted,
  } = options;

  const dispatch = useDispatch();
  const liveTalk = useSelector((state: RootState) => state.liveTalk);
  const selectedModelId = useSelector((state: RootState) => state.llm.selectedModelId);
  const customModels = useSelector((state: RootState) => state.llm.customModels);
  const modelStatuses = useSelector((state: RootState) => state.llm.modelStatuses);
  const preferredBackend = useSelector((state: RootState) => state.llm.preferredBackend);
  const activeBackend = useSelector((state: RootState) => state.llm.activeBackend);
  const isGenerating = useSelector((state: RootState) => state.llm.isGenerating);
  const agentExecutionStatus = useSelector((state: RootState) => state.agent.executionStatus);

  const selectedModel = useMemo(() => {
    return (
      AVAILABLE_MODELS.find((m) => m.id === selectedModelId) ||
      customModels.find((m) => m.id === selectedModelId) ||
      AVAILABLE_MODELS[0]
    );
  }, [selectedModelId, customModels]);

  // 30Hz UI-runtime scalars driven directly in Reanimated without Redux re-renders.
  const micLevelSV = useSharedValue(0);
  const speakerLevelSV = useSharedValue(0);

  const [availableRoutes, setAvailableRoutes] = useState<string[]>(['speaker']);
  const [micPermissionState, setMicPermissionState] = useState<{
    visible: boolean;
    isPermanentlyDenied: boolean;
  }>({ visible: false, isPermanentlyDenied: false });

  const sessionRunningRef = useRef(false);
  const sessionStartingRef = useRef(false);
  const sessionAttemptIdRef = useRef(0);
  const speechActiveRef = useRef(false);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const unsubscribersRef = useRef<Array<() => void>>([]);
  const selectedModelRef = useRef(selectedModel);
  selectedModelRef.current = selectedModel;
  const activeBackendRef = useRef(activeBackend || 'GPU');
  activeBackendRef.current = activeBackend || 'GPU';
  const ttsEnginePrefRef = useRef<LiveTtsEnginePref>(liveTalk.ttsEnginePref);
  ttsEnginePrefRef.current = liveTalk.ttsEnginePref;
  const selectedVoiceIdRef = useRef<string>(liveTalk.selectedVoiceId);
  selectedVoiceIdRef.current = liveTalk.selectedVoiceId;
  const prefsHydrationPromiseRef = useRef<Promise<{ ttsEngine: LiveTtsEnginePref; voiceId: string }> | null>(null);

  const cleanupListeners = useCallback(() => {
    unsubscribersRef.current.forEach((u) => u());
    unsubscribersRef.current = [];
  }, []);

  const syncReduxIfNativeUnloaded = useCallback(async () => {
    try {
      const stillLoaded = await LLMService.isModelLoaded();
      if (!stillLoaded) {
        dispatch(unloadModel());
      }
    } catch {
      dispatch(unloadModel());
    }
  }, [dispatch]);

  const stopLiveSession = useCallback(async () => {
    sessionAttemptIdRef.current += 1;
    sessionStartingRef.current = false;
    sessionRunningRef.current = false;
    speechActiveRef.current = false;
    cleanupListeners();
    micLevelSV.value = 0;
    speakerLevelSV.value = 0;
    try {
      await liveAudioService.stopSession();
    } catch (err) {
      console.warn('[useLiveAudio] stopSession warning:', err);
    }
    dispatch(closeLiveTalkModal());
  }, [cleanupListeners, dispatch, micLevelSV, speakerLevelSV]);

  useEffect(() => {
    const p = liveAudioService.loadTtsPreferences().then((prefs) => {
      ttsEnginePrefRef.current = prefs.ttsEngine;
      selectedVoiceIdRef.current = prefs.voiceId;
      dispatch(
        setTtsPreference({
          ttsEnginePref: prefs.ttsEngine,
          selectedVoiceId: prefs.voiceId,
        })
      );
      return prefs;
    });
    prefsHydrationPromiseRef.current = p;

    return () => {
      sessionAttemptIdRef.current += 1;
      cleanupListeners();
      if (sessionRunningRef.current || sessionStartingRef.current) {
        sessionStartingRef.current = false;
        sessionRunningRef.current = false;
        liveAudioService.stopSession().catch(() => {});
      }
    };
  }, [cleanupListeners, dispatch]);

  useEffect(() => {
    if (!liveTalk.isVisible || !liveAudioService.isSupported()) {
      return;
    }
    let active = true;
    (async () => {
      try {
        const prefs = prefsHydrationPromiseRef.current
          ? await prefsHydrationPromiseRef.current
          : await liveAudioService.loadTtsPreferences();
        if (!active) return;
        const caps = await liveAudioService.setTtsConfig(prefs.ttsEngine, prefs.voiceId);
        if (active) {
          dispatch(applyTtsCapabilities(caps));
        }
      } catch (err) {
        console.warn('[useLiveAudio] Failed to sync TTS capabilities:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, [dispatch, liveTalk.isVisible]);

  useEffect(() => {
    if ((!liveTalk.isVisible && !liveTalk.phononDownloading) || !liveAudioService.isSupported()) {
      return;
    }
    const unsubProgress = liveAudioService.onTtsDownloadProgress((ev) => {
      dispatch(
        setPhononDownloadProgress({
          status: ev.status,
          percent: ev.percent,
          downloadedBytes: ev.downloadedBytes,
          totalBytes: ev.totalBytes,
          currentFile: ev.currentFile,
          error: ev.error,
        })
      );
    });
    const unsubConfig = liveAudioService.onTtsConfigChanged((caps) => {
      dispatch(applyTtsCapabilities(caps));
    });
    return () => {
      unsubProgress();
      unsubConfig();
    };
  }, [dispatch, liveTalk.isVisible, liveTalk.phononDownloading]);

  const checkMicPermission = useCallback(async (): Promise<'granted' | 'prompt' | 'denied'> => {
    if (Platform.OS !== 'android') {
      return 'granted';
    }
    const alreadyGranted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    );
    if (alreadyGranted) {
      return 'granted';
    }
    return 'prompt';
  }, []);

  const requestSystemMicPermission = useCallback(async (): Promise<'granted' | 'never_ask_again' | 'denied'> => {
    if (Platform.OS !== 'android') return 'granted';
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
    );
    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      // Request optional Bluetooth connect permission on Android 12+ without blocking session
      if (Number(Platform.Version) >= 31 && PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT) {
        try {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
        } catch {
          // Optional for headset routing
        }
      }
      return 'granted';
    }
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      return 'never_ask_again';
    }
    return 'denied';
  }, []);

  const startNativeLiveSession = useCallback(async () => {
    if (sessionRunningRef.current || sessionStartingRef.current) return;
    sessionStartingRef.current = true;
    const attemptId = ++sessionAttemptIdRef.current;
    const model = selectedModelRef.current;

    dispatch(openLiveTalkModal());
    dispatch(setSessionStarting(true));

    // Seed overlay captions from current chat history (last 8 messages)
    const existingTurns = messagesRef.current.slice(-8).map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      isFinal: true,
    }));
    dispatch(seedModalTurns(existingTurns));

    try {
      const status = modelStatuses[model.id]?.status || 'not_downloaded';
      if (status === 'loading') {
        throw new Error(`"${model.name}" is still loading. Please wait a moment.`);
      }
      let needModelInit = status !== 'loaded';
      if (!needModelInit) {
        const nativeLoaded = await LLMService.isModelLoaded();
        if (sessionAttemptIdRef.current !== attemptId) return;
        needModelInit = !nativeLoaded;
      }
      if (needModelInit) {
        if (status !== 'downloaded' && status !== 'loaded') {
          dispatch(closeLiveTalkModal());
          Alert.alert(
            'Model Not Downloaded',
            `Download "${model.name}" in the model selector before starting Live Voice Talk.`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Select Model', onPress: onOpenModelSelector },
            ]
          );
          return;
        }

        const modelPath = modelStatuses[model.id]?.localPath || model.fileName;
        dispatch(startLoadingModel(model.id));
        try {
          // Live Talk loads with isVision=false (visionBackend=null) to save RAM & startup time
          const initRes = await LLMService.initialize(
            modelPath,
            preferredBackend,
            model.supportedBackends,
            false,
            model.maxContextLength,
            model.supportsAudio
          );
          dispatch(
            setLoadedModel({
              modelId: model.id,
              backend: initRes.actualBackend,
            })
          );
          if (sessionAttemptIdRef.current !== attemptId) return;
        } catch (loadErr: any) {
          dispatch(
            setModelLoadFailed({
              modelId: model.id,
              error: loadErr?.message || 'Failed to load model',
            })
          );
          throw loadErr;
        }
      }

      const prefs = prefsHydrationPromiseRef.current
        ? await prefsHydrationPromiseRef.current
        : { ttsEngine: ttsEnginePrefRef.current, voiceId: selectedVoiceIdRef.current };
      if (sessionAttemptIdRef.current !== attemptId) return;

      const caps = await liveAudioService.getCapabilities();
      if (sessionAttemptIdRef.current !== attemptId) return;
      dispatch(applyTtsCapabilities(caps));
      if (caps.availableRoutes?.length) {
        setAvailableRoutes(caps.availableRoutes);
      }

      cleanupListeners();
      speechActiveRef.current = false;

      const subs = [
        liveAudioService.onAudioLevel((ev) => {
          micLevelSV.value = withTiming(ev.micLevel, { duration: 45 });
          speakerLevelSV.value = withTiming(ev.speakerLevel, { duration: 45 });
          if (speechActiveRef.current !== ev.speechActive) {
            speechActiveRef.current = ev.speechActive;
            dispatch(setVadSpeechActive(ev.speechActive));
          }
        }),
        liveAudioService.onStateChange((ev) => {
          if (ev.state === 'LISTENING' || ev.state === 'THINKING' || ev.state === 'IDLE') {
            speechActiveRef.current = false;
          }
          if (ev.state === 'IDLE') {
            sessionRunningRef.current = false;
            micLevelSV.value = 0;
            speakerLevelSV.value = 0;
          }
          dispatch(setSessionState(ev.state as LiveTalkState));
        }),
        liveAudioService.onTranscriptDelta((ev) => {
          dispatch(
            applyTranscriptDelta({
              turnId: ev.turnId,
              role: ev.role,
              fullText: ev.fullText,
              isFinal: ev.isFinal,
            })
          );
        }),
        liveAudioService.onTurnCommitted((ev) => {
          dispatch(
            commitLiveTurn({
              turnId: ev.turnId,
              userText: ev.userText,
              assistantText: ev.assistantText,
              wasInterrupted: ev.wasInterrupted,
            })
          );
          persistQueueRef.current = persistQueueRef.current
            .then(async () => {
              const persisted = await liveAudioService.persistLiveTurnToStorage({
                sessionId: activeSessionIdRef.current,
                currentMessages: messagesRef.current,
                userText: ev.userText,
                assistantText: ev.assistantText,
                modelName: selectedModelRef.current.name,
                backend: activeBackendRef.current,
              });
              if (persisted.addedMessages.length > 0 && persisted.sessionId) {
                onSessionTurnsPersisted(persisted.sessionId, persisted.addedMessages);
              }
            })
            .catch((persistErr) => {
              console.warn('[useLiveAudio] Failed to persist live turn:', persistErr);
            });
        }),
        liveAudioService.onRouteOrFocusChange((ev) => {
          dispatch(
            updateRouteOrFocus({
              route: ev.route as LiveOutputRoute,
              aecEnabled: ev.aecEnabled,
            })
          );
          if (ev.focusState === 'focus_lost') {
            dispatch(setLiveTalkError('Audio focus was taken by another app.'));
          } else if (ev.focusState === 'focus_gained') {
            dispatch(setLiveTalkError(null));
          }
        }),
        liveAudioService.onError((ev) => {
          dispatch(setLiveTalkError(ev.message));
          if (!ev.recoverable) {
            sessionRunningRef.current = false;
            sessionStartingRef.current = false;
            cleanupListeners();
            if (ev.code === 'ERR_MODEL_LOST' || ev.code === 'ERR_MODEL_NOT_LOADED') {
              syncReduxIfNativeUnloaded();
            }
          }
        }),
      ];
      unsubscribersRef.current = subs;

      const seedHistory = messagesRef.current
        .filter((m) => m.text.trim().length > 0)
        .slice(-10)
        .map((m) => ({
          role: m.role,
          text: m.text.trim(),
        }));

      const modelPath = modelStatuses[model.id]?.localPath || model.fileName;
      const startRes = await liveAudioService.startSession({
        modelPath,
        backend: preferredBackend,
        supportsAudio: !!model.supportsAudio,
        maxContextLength: model.maxContextLength,
        systemInstruction: '',
        seedHistory,
        useDeviceAsrFallback: !model.supportsAudio,
        vadSensitivity: 0.55,
        speakerRoute: liveTalk.preferredRoute,
        disableVision: true,
        ttsEngine: prefs.ttsEngine,
        voiceId: prefs.voiceId,
      });

      if (sessionAttemptIdRef.current !== attemptId) {
        cleanupListeners();
        liveAudioService.stopSession().catch(() => {});
        return;
      }

      sessionRunningRef.current = true;
      dispatch(
        sessionStarted({
          inputMode: startRes.inputMode === 'os_asr' ? 'os_asr' : 'audio_bytes',
          vadBackend: (startRes.vadBackend as LiveVadBackend) || 'dsp_fallback',
          activeRoute: (startRes.activeRoute as LiveOutputRoute) || 'speaker',
          aecEnabled: startRes.aecEnabled,
          ttsBackend: (startRes.ttsBackend === 'phonon_31m' ? 'phonon_31m' : 'android_tts') as LiveTtsBackend,
          voiceId: startRes.voiceId || prefs.voiceId,
        })
      );
      dispatch(setVadSpeechActive(false));
    } catch (err: any) {
      cleanupListeners();
      sessionRunningRef.current = false;
      await syncReduxIfNativeUnloaded();
      if (sessionAttemptIdRef.current === attemptId) {
        dispatch(setLiveTalkError(err?.message || 'Failed to start Live Talk.'));
      }
    } finally {
      if (sessionAttemptIdRef.current === attemptId) {
        sessionStartingRef.current = false;
      }
    }
  }, [
    activeSessionIdRef,
    cleanupListeners,
    dispatch,
    liveTalk.preferredRoute,
    messagesRef,
    micLevelSV,
    modelStatuses,
    onOpenModelSelector,
    onSessionTurnsPersisted,
    preferredBackend,
    speakerLevelSV,
    syncReduxIfNativeUnloaded,
  ]);

  const openLiveTalk = useCallback(async () => {
    if (isGenerating) return;

    if (!liveAudioService.isSupported()) {
      Alert.alert(
        'Android Only (Phase 1)',
        'Live Voice Talk is currently available on Android devices.'
      );
      return;
    }

    if (agentExecutionStatus === 'running') {
      Alert.alert(
        'Automation Agent Running',
        'Please wait for or stop the active Accessibility Agent task before starting Live Voice Talk.'
      );
      return;
    }

    if (
      selectedModel.isEmbedding ||
      selectedModel.isASR ||
      selectedModel.isOCR ||
      selectedModel.isDraftModel ||
      selectedModel.isExperimental
    ) {
      Alert.alert(
        'Unsupported Model for Live Talk',
        `"${selectedModel.name}" cannot be used for conversational voice chat. Please choose a conversational or audio-capable model (such as Gemma 4 E2B).`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Select Model', onPress: onOpenModelSelector },
        ]
      );
      return;
    }

    const perm = await checkMicPermission();
    if (perm === 'granted') {
      await startNativeLiveSession();
    } else {
      setMicPermissionState({ visible: true, isPermanentlyDenied: false });
    }
  }, [
    agentExecutionStatus,
    checkMicPermission,
    isGenerating,
    onOpenModelSelector,
    selectedModel,
    startNativeLiveSession,
  ]);

  const handleGrantMicPermission = useCallback(async () => {
    if (micPermissionState.isPermanentlyDenied) {
      setMicPermissionState({ visible: false, isPermanentlyDenied: false });
      await Linking.openSettings();
      return;
    }

    const outcome = await requestSystemMicPermission();
    if (outcome === 'granted') {
      setMicPermissionState({ visible: false, isPermanentlyDenied: false });
      await startNativeLiveSession();
    } else if (outcome === 'never_ask_again') {
      setMicPermissionState({ visible: true, isPermanentlyDenied: true });
    } else {
      setMicPermissionState({ visible: false, isPermanentlyDenied: false });
    }
  }, [
    micPermissionState.isPermanentlyDenied,
    requestSystemMicPermission,
    startNativeLiveSession,
  ]);

  const handleCancelMicPermission = useCallback(() => {
    setMicPermissionState({ visible: false, isPermanentlyDenied: false });
  }, []);

  const toggleMute = useCallback(async () => {
    const next = !liveTalk.isMuted;
    try {
      await liveAudioService.muteMic(next);
      dispatch(setMicMuted(next));
    } catch (err) {
      console.warn('[useLiveAudio] muteMic error:', err);
    }
  }, [dispatch, liveTalk.isMuted]);

  const triggerInterrupt = useCallback(async () => {
    try {
      await liveAudioService.interrupt();
    } catch (err) {
      console.warn('[useLiveAudio] interrupt error:', err);
    }
  }, []);

  const commitManualTurn = useCallback(async () => {
    try {
      await liveAudioService.commitTurn();
    } catch (err) {
      console.warn('[useLiveAudio] commitTurn error:', err);
    }
  }, []);

  const cycleOutputRoute = useCallback(async () => {
    const order: LiveOutputRoute[] = ['auto', 'speaker', 'earpiece', 'bluetooth'];
    const filtered = order.filter(
      (r) => r === 'auto' || availableRoutes.includes(r) || r === 'speaker'
    );
    const idx = filtered.indexOf(liveTalk.preferredRoute);
    const nextRoute = filtered[(idx + 1) % filtered.length] || 'speaker';
    dispatch(setPreferredRoute(nextRoute));
    try {
      const applied = await liveAudioService.setOutputRoute(nextRoute);
      dispatch(updateRouteOrFocus({ route: (applied as LiveOutputRoute) || 'speaker' }));
    } catch (err) {
      console.warn('[useLiveAudio] setOutputRoute error:', err);
    }
  }, [availableRoutes, dispatch, liveTalk.preferredRoute]);

  const downloadPhononModel = useCallback(
    async (variant: 'q4' | 'fp32' = 'q4') => {
      if (!liveAudioService.isSupported()) return;
      const voiceId = selectedVoiceIdRef.current || 'easton';
      dispatch(
        setPhononDownloadProgress({
          status: 'downloading',
          percent: 0,
          downloadedBytes: 0,
          totalBytes: liveTalk.phononExpectedBytes,
          currentFile: null,
          error: null,
        })
      );
      try {
        const ok = await liveAudioService.downloadPhononModel(variant, voiceId);
        if (ok) {
          ttsEnginePrefRef.current = 'phonon_31m';
          dispatch(setTtsPreference({ ttsEnginePref: 'phonon_31m', selectedVoiceId: voiceId }));
          await liveAudioService.saveTtsPreferences({ ttsEngine: 'phonon_31m', voiceId });
          const caps = await liveAudioService.setTtsConfig('phonon_31m', voiceId);
          dispatch(applyTtsCapabilities(caps));
        } else {
          const caps = await liveAudioService.getCapabilities();
          dispatch(applyTtsCapabilities(caps));
        }
      } catch (err: any) {
        dispatch(
          setPhononDownloadProgress({
            status: 'error',
            percent: 0,
            downloadedBytes: 0,
            totalBytes: liveTalk.phononExpectedBytes,
            currentFile: null,
            error: err?.message || 'Failed to download Phonon-31M.',
          })
        );
      }
    },
    [dispatch, liveTalk.phononExpectedBytes]
  );

  const cancelPhononDownload = useCallback(async () => {
    try {
      await liveAudioService.cancelPhononDownload();
    } catch (err) {
      console.warn('[useLiveAudio] cancelPhononDownload error:', err);
    }
  }, []);

  const deletePhononModel = useCallback(async () => {
    try {
      const voiceId = selectedVoiceIdRef.current || 'easton';
      ttsEnginePrefRef.current = 'auto';
      dispatch(setTtsPreference({ ttsEnginePref: 'auto' }));
      await liveAudioService.saveTtsPreferences({ ttsEngine: 'auto', voiceId });
      await liveAudioService.deletePhononModel();
      const caps = await liveAudioService.getCapabilities();
      dispatch(applyTtsCapabilities(caps));
    } catch (err) {
      console.warn('[useLiveAudio] deletePhononModel error:', err);
    }
  }, [dispatch]);

  const selectTtsEngine = useCallback(
    async (engine: LiveTtsEnginePref) => {
      const voiceId = selectedVoiceIdRef.current || 'easton';
      ttsEnginePrefRef.current = engine;
      dispatch(setTtsPreference({ ttsEnginePref: engine }));
      await liveAudioService.saveTtsPreferences({ ttsEngine: engine, voiceId });
      try {
        const caps = await liveAudioService.setTtsConfig(engine, voiceId);
        dispatch(applyTtsCapabilities(caps));
      } catch (err) {
        console.warn('[useLiveAudio] selectTtsEngine error:', err);
      }
    },
    [dispatch]
  );

  const selectVoice = useCallback(
    async (voiceId: string) => {
      const engine =
        ttsEnginePrefRef.current === 'android_tts' ? 'phonon_31m' : ttsEnginePrefRef.current;
      ttsEnginePrefRef.current = engine;
      selectedVoiceIdRef.current = voiceId;
      dispatch(setTtsPreference({ ttsEnginePref: engine, selectedVoiceId: voiceId }));
      await liveAudioService.saveTtsPreferences({ ttsEngine: engine, voiceId });
      try {
        const caps = await liveAudioService.setTtsConfig(engine, voiceId);
        dispatch(applyTtsCapabilities(caps));
      } catch (err) {
        console.warn('[useLiveAudio] selectVoice error:', err);
      }
    },
    [dispatch]
  );

  const selectOutputRoute = useCallback(
    async (route: LiveOutputRoute) => {
      dispatch(setPreferredRoute(route));
      try {
        const applied = await liveAudioService.setOutputRoute(route);
        dispatch(updateRouteOrFocus({ route: (applied as LiveOutputRoute) || 'speaker' }));
      } catch (err) {
        console.warn('[useLiveAudio] selectOutputRoute error:', err);
      }
    },
    [dispatch]
  );

  return {
    liveTalk,
    selectedModel,
    micLevelSV,
    speakerLevelSV,
    availableRoutes,
    openLiveTalk,
    stopLiveSession,
    toggleMute,
    triggerInterrupt,
    commitManualTurn,
    cycleOutputRoute,
    selectOutputRoute,
    retrySession: startNativeLiveSession,
    downloadPhononModel,
    cancelPhononDownload,
    deletePhononModel,
    selectTtsEngine,
    selectVoice,
    micPermissionModal: {
      visible: micPermissionState.visible,
      isPermanentlyDenied: micPermissionState.isPermanentlyDenied,
      onGrant: handleGrantMicPermission,
      onCancel: handleCancelMicPermission,
    } as MicPermissionPromptState,
  };
}

export default useLiveAudio;
