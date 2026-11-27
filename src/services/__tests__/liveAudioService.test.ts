jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 34 },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  })),
}));

jest.mock('../../native/turbo_modules/LLM/NativeLLM', () => ({
  __esModule: true,
  default: {
    initialize: jest.fn().mockResolvedValue({
      success: true,
      modelPath: '/data/models/gemma-4-E2B-it-gpu.litertlm',
      requestedBackend: 'GPU,CPU',
      actualBackend: 'GPU',
      wasFallback: false,
    }),
  },
}));

jest.mock('../../native/turbo_modules/LiveAudio/NativeLiveAudio', () => ({
  __esModule: true,
  default: {
    startSession: jest.fn().mockResolvedValue({
      success: true,
      inputMode: 'audio_bytes',
      vadBackend: 'silero_onnx',
      ttsBackend: 'android_tts',
      voiceId: 'easton',
      activeRoute: 'speaker',
      aecEnabled: true,
      hwSampleRate: 48000,
    }),
    stopSession: jest.fn().mockResolvedValue(true),
    interrupt: jest.fn().mockResolvedValue(true),
    muteMic: jest.fn().mockResolvedValue(true),
    commitTurn: jest.fn().mockResolvedValue(true),
    setOutputRoute: jest.fn().mockResolvedValue('speaker'),
    getCapabilities: jest.fn().mockResolvedValue({
      hasSileroModel: false,
      hasDeviceAsr: true,
      hasTtsEngine: true,
      hasAcousticEchoCanceler: true,
      hasNoiseSuppressor: true,
      isModelLoaded: true,
      modelSupportsAudio: true,
      availableRoutes: ['speaker', 'earpiece'],
      phononInstalled: false,
      phononDownloading: false,
      phononExpectedBytes: 68_565_296,
      phononDiskBytes: 0,
      phononVariant: '',
      selectedTtsEngine: 'auto',
      selectedVoiceId: 'easton',
      downloadedVoices: [],
      availableVoices: [],
    }),
    downloadPhononModel: jest.fn().mockResolvedValue(true),
    cancelPhononDownload: jest.fn().mockResolvedValue(true),
    deletePhononModel: jest.fn().mockResolvedValue(true),
    setTtsConfig: jest.fn().mockResolvedValue({
      hasSileroModel: false,
      hasDeviceAsr: true,
      hasTtsEngine: true,
      hasAcousticEchoCanceler: true,
      hasNoiseSuppressor: true,
      isModelLoaded: true,
      modelSupportsAudio: true,
      availableRoutes: ['speaker'],
      phononInstalled: true,
      phononDownloading: false,
      phononExpectedBytes: 68_565_296,
      phononDiskBytes: 68_565_296,
      phononVariant: 'q4',
      selectedTtsEngine: 'phonon_31m',
      selectedVoiceId: 'juniper',
      downloadedVoices: ['juniper'],
      availableVoices: [],
    }),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  },
}));

jest.mock('../../native/turbo_modules/DocumentProcessor/NativeDocumentProcessor', () => ({
  __esModule: true,
  default: {
    processDocument: jest.fn(),
    cancelProcessing: jest.fn(),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store[k] ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        store[k] = v;
      }),
      removeItem: jest.fn(async (k: string) => {
        delete store[k];
      }),
      clear: jest.fn(async () => {
        Object.keys(store).forEach((k) => {
          delete store[k];
        });
      }),
    },
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import NativeLLM from '../../native/turbo_modules/LLM/NativeLLM';
import NativeLiveAudio from '../../native/turbo_modules/LiveAudio/NativeLiveAudio';
import LLMService from '../llmService';
import liveAudioService from '../liveAudioService';
import documentService from '../documentService';
import {
  loadSessions,
  resetMemoryStoreForTesting,
} from '../chatStorageService';

describe('Phase 1 Live Talk & LLM Service Contracts', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    resetMemoryStoreForTesting();
    (Platform as any).OS = 'android';
  });

  it('skips NPU probing on AUTO for GPU-packaged .litertlm and propagates supportsAudio', async () => {
    await LLMService.initialize(
      '/data/models/gemma-4-E2B-it-gpu.litertlm',
      'AUTO',
      ['NPU', 'GPU', 'CPU'],
      true,
      128000,
      true
    );

    expect(NativeLLM.initialize).toHaveBeenCalledWith(
      '/data/models/gemma-4-E2B-it-gpu.litertlm',
      'GPU,CPU',
      true,
      true,
      4096
    );
  });

  it('tries NPU first when explicitly requested by user', async () => {
    await LLMService.initialize(
      '/data/models/gemma-4-E2B-it-gpu.litertlm',
      'NPU',
      ['NPU', 'GPU', 'CPU'],
      true,
      4096,
      true
    );

    expect(NativeLLM.initialize).toHaveBeenCalledWith(
      '/data/models/gemma-4-E2B-it-gpu.litertlm',
      'NPU,GPU,CPU',
      true,
      true,
      4096
    );
  });

  it('safely guards liveAudioService and documentService on iOS and subscribes on Android', async () => {
    const unsubAndroidDoc = documentService.onProgress(() => {});
    expect(() => unsubAndroidDoc()).not.toThrow();

    jest.resetModules();
    jest.doMock('react-native', () => ({
      Platform: { OS: 'ios', Version: '18.0' },
      NativeEventEmitter: jest.fn(() => {
        throw new Error('NativeEventEmitter must not be constructed on iOS for Android-only modules');
      }),
    }));
    jest.doMock('../../native/turbo_modules/LiveAudio/NativeLiveAudio', () => ({
      __esModule: true,
      default: null,
    }));
    jest.doMock('../../native/turbo_modules/DocumentProcessor/NativeDocumentProcessor', () => ({
      __esModule: true,
      default: null,
    }));

    const iosDoc = require('../documentService').default;
    const iosLive = require('../liveAudioService').default;

    expect(iosLive.isSupported()).toBe(false);
    const caps = await iosLive.getCapabilities();
    expect(caps.availableRoutes).toEqual(['speaker']);

    const unsubDoc = iosDoc.onProgress(() => {});
    const unsubLive = iosLive.onAudioLevel(() => {});
    expect(() => unsubDoc()).not.toThrow();
    expect(() => unsubLive()).not.toThrow();

    await expect(
      iosLive.startSession({
        modelPath: 'x',
        backend: 'AUTO',
        supportsAudio: true,
        maxContextLength: 4096,
        systemInstruction: '',
        seedHistory: [],
        useDeviceAsrFallback: false,
        vadSensitivity: 0.5,
        speakerRoute: 'auto',
        disableVision: true,
      })
    ).rejects.toThrow('Android only');
  });

  it('persists committed voice turns cleanly into chatStorageService', async () => {
    const first = await liveAudioService.persistLiveTurnToStorage({
      sessionId: null,
      currentMessages: [],
      userText: 'Voice message',
      assistantText: 'Hi there!',
      modelName: 'gemma-4-E2B-it',
      backend: 'GPU',
    });

    expect(first.sessionId).toBeTruthy();
    expect(first.addedMessages).toHaveLength(2);

    const second = await liveAudioService.persistLiveTurnToStorage({
      sessionId: first.sessionId,
      currentMessages: first.addedMessages,
      userText: 'Tell me more',
      assistantText: 'Sure thing... (interrupted)',
      modelName: 'gemma-4-E2B-it',
      backend: 'GPU',
    });

    expect(second.sessionId).toBe(first.sessionId);
    const all = await loadSessions();
    expect(all).toHaveLength(1);
    expect(all[0].messages).toHaveLength(4);
    expect(all[0].messages[3].text).toBe('Sure thing... (interrupted)');
  });

  it('serializes concurrent persistLiveTurnToStorage calls without dropping turns', async () => {
    const first = await liveAudioService.persistLiveTurnToStorage({
      sessionId: null,
      currentMessages: [],
      userText: 'Turn 1',
      assistantText: 'Answer 1',
      modelName: 'gemma-4-E2B-it',
      backend: 'GPU',
    });

    await Promise.all([
      liveAudioService.persistLiveTurnToStorage({
        sessionId: first.sessionId,
        currentMessages: [],
        userText: 'Turn 2',
        assistantText: 'Answer 2',
        modelName: 'gemma-4-E2B-it',
        backend: 'GPU',
      }),
      liveAudioService.persistLiveTurnToStorage({
        sessionId: first.sessionId,
        currentMessages: [],
        userText: 'Turn 3',
        assistantText: 'Answer 3',
        modelName: 'gemma-4-E2B-it',
        backend: 'GPU',
      }),
    ]);

    const all = await loadSessions();
    expect(all).toHaveLength(1);
    expect(all[0].messages.map((m) => m.text)).toEqual([
      'Turn 1',
      'Answer 1',
      'Turn 2',
      'Answer 2',
      'Turn 3',
      'Answer 3',
    ]);
  });

  it('ignores empty whitespace turns without creating empty sessions', async () => {
    const empty = await liveAudioService.persistLiveTurnToStorage({
      sessionId: null,
      currentMessages: [],
      userText: '   ',
      assistantText: '\n',
      modelName: 'gemma-4-E2B-it',
      backend: 'GPU',
    });

    expect(empty.addedMessages).toHaveLength(0);
    expect(await loadSessions()).toHaveLength(0);
  });

  it('persists and restores Phonon TTS preferences and delegates native TTS config methods', async () => {
    const defaults = await liveAudioService.loadTtsPreferences();
    expect(defaults).toEqual({ ttsEngine: 'auto', voiceId: 'easton' });

    await liveAudioService.saveTtsPreferences({
      ttsEngine: 'phonon_31m',
      voiceId: 'juniper',
    });
    const loaded = await liveAudioService.loadTtsPreferences();
    expect(loaded).toEqual({ ttsEngine: 'phonon_31m', voiceId: 'juniper' });

    await AsyncStorage.setItem('@aotg/live_tts_prefs', '{corrupt json');
    const recovered = await liveAudioService.loadTtsPreferences();
    expect(recovered).toEqual({ ttsEngine: 'auto', voiceId: 'easton' });

    await expect(liveAudioService.downloadPhononModel('q4', 'juniper')).resolves.toBe(true);
    expect(NativeLiveAudio?.downloadPhononModel).toHaveBeenCalledWith('q4', 'juniper');

    const updatedCaps = await liveAudioService.setTtsConfig('phonon_31m', 'juniper');
    expect(updatedCaps.phononInstalled).toBe(true);
    expect(updatedCaps.selectedVoiceId).toBe('juniper');

    await expect(liveAudioService.cancelPhononDownload()).resolves.toBe(true);
    await expect(liveAudioService.deletePhononModel()).resolves.toBe(true);

    const unsubProgress = liveAudioService.onTtsDownloadProgress(() => {});
    const unsubConfig = liveAudioService.onTtsConfigChanged(() => {});
    expect(() => unsubProgress()).not.toThrow();
    expect(() => unsubConfig()).not.toThrow();
  });
});
