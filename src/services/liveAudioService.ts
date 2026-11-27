import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeEventEmitter, Platform } from 'react-native';
import NativeLiveAudio, {
  LiveAudioCapabilities,
  LiveAudioSessionConfig,
  LiveAudioStartResult,
} from '../native/turbo_modules/LiveAudio/NativeLiveAudio';
import {
  LiveInputMode,
  LiveOutputRoute,
  LiveTalkState,
  LiveTtsEnginePref,
  PhononDownloadStatus,
} from '../store/slices/liveTalkSlice';
import {
  ChatMessage,
  createSession,
  loadSessions,
  saveActiveSessionId,
  saveSession,
} from './chatStorageService';

export interface AudioLevelEvent {
  micLevel: number;
  speakerLevel: number;
  vadProb: number;
  speechActive: boolean;
}

export interface TranscriptDeltaEvent {
  turnId: string;
  role: 'user' | 'assistant';
  textDelta: string;
  fullText: string;
  isFinal: boolean;
}

export interface StateChangeEvent {
  state: LiveTalkState;
  previousState: LiveTalkState;
}

export interface TurnCommittedEvent {
  turnId: string;
  userText: string;
  assistantText: string;
  wasInterrupted: boolean;
  inputMode: LiveInputMode;
}

export interface RouteOrFocusChangeEvent {
  route: LiveOutputRoute;
  focusState: string;
  aecEnabled: boolean;
}

export interface LiveErrorEvent {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface TtsDownloadProgressEvent {
  status: PhononDownloadStatus;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  currentFile?: string;
  error?: string;
}

export interface LiveTtsPreferences {
  ttsEngine: LiveTtsEnginePref;
  voiceId: string;
}

const LIVE_TTS_PREFS_STORAGE_KEY = '@aotg/live_tts_prefs';
const DEFAULT_TTS_PREFERENCES: LiveTtsPreferences = {
  ttsEngine: 'auto',
  voiceId: 'easton',
};

export interface PersistLiveTurnParams {
  sessionId: string | null;
  currentMessages: ChatMessage[];
  userText: string;
  assistantText: string;
  modelName: string;
  backend: string;
}

export interface PersistLiveTurnResult {
  sessionId: string;
  addedMessages: ChatMessage[];
}

class LiveAudioServiceImpl {
  private eventEmitter: NativeEventEmitter | null = null;
  private persistQueue: Promise<unknown> = Promise.resolve();

  constructor() {
    if (Platform.OS === 'android' && NativeLiveAudio) {
      try {
        this.eventEmitter = new NativeEventEmitter(NativeLiveAudio as any);
      } catch (err) {
        console.warn('[LiveAudioService] Could not initialize NativeEventEmitter:', err);
      }
    }
  }

  public isSupported(): boolean {
    return Platform.OS === 'android' && NativeLiveAudio != null;
  }

  public async getCapabilities(): Promise<LiveAudioCapabilities> {
    if (!this.isSupported() || !NativeLiveAudio) {
      return {
        hasSileroModel: false,
        hasDeviceAsr: false,
        hasTtsEngine: false,
        hasAcousticEchoCanceler: false,
        hasNoiseSuppressor: false,
        isModelLoaded: false,
        modelSupportsAudio: false,
        availableRoutes: ['speaker'],
        phononInstalled: false,
        phononDownloading: false,
        phononExpectedBytes: 68_565_296,
        phononDiskBytes: 0,
        phononVariant: '',
        selectedTtsEngine: 'auto',
        selectedVoiceId: 'easton',
        downloadedVoices: [],
        availableVoices: [],
      };
    }
    return NativeLiveAudio.getCapabilities();
  }

  public async downloadPhononModel(
    variant: 'q4' | 'fp32' = 'q4',
    voiceId: string = 'easton'
  ): Promise<boolean> {
    if (!this.isSupported() || !NativeLiveAudio) {
      return false;
    }
    return NativeLiveAudio.downloadPhononModel(variant, voiceId);
  }

  public async cancelPhononDownload(): Promise<boolean> {
    if (!this.isSupported() || !NativeLiveAudio) {
      return false;
    }
    return NativeLiveAudio.cancelPhononDownload();
  }

  public async deletePhononModel(): Promise<boolean> {
    if (!this.isSupported() || !NativeLiveAudio) {
      return false;
    }
    return NativeLiveAudio.deletePhononModel();
  }

  public async setTtsConfig(
    ttsEngine: LiveTtsEnginePref,
    voiceId: string
  ): Promise<LiveAudioCapabilities> {
    if (!this.isSupported() || !NativeLiveAudio) {
      return this.getCapabilities();
    }
    return NativeLiveAudio.setTtsConfig(ttsEngine, voiceId);
  }

  public async loadTtsPreferences(): Promise<LiveTtsPreferences> {
    try {
      const raw = await AsyncStorage.getItem(LIVE_TTS_PREFS_STORAGE_KEY);
      if (!raw) return DEFAULT_TTS_PREFERENCES;
      const parsed = JSON.parse(raw);
      const engine: LiveTtsEnginePref =
        parsed?.ttsEngine === 'phonon_31m' ||
        parsed?.ttsEngine === 'android_tts' ||
        parsed?.ttsEngine === 'auto'
          ? parsed.ttsEngine
          : 'auto';
      const voiceId =
        typeof parsed?.voiceId === 'string' && parsed.voiceId.trim().length > 0
          ? parsed.voiceId.trim().toLowerCase()
          : 'easton';
      return { ttsEngine: engine, voiceId };
    } catch {
      return DEFAULT_TTS_PREFERENCES;
    }
  }

  public async saveTtsPreferences(prefs: LiveTtsPreferences): Promise<void> {
    try {
      await AsyncStorage.setItem(LIVE_TTS_PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch (err) {
      console.warn('[LiveAudioService] Failed to save TTS preferences:', err);
    }
  }

  public async startSession(config: LiveAudioSessionConfig): Promise<LiveAudioStartResult> {
    if (!this.isSupported() || !NativeLiveAudio) {
      throw new Error('Live Voice Talk is currently supported on Android only.');
    }
    return NativeLiveAudio.startSession(config);
  }

  public async stopSession(): Promise<boolean> {
    if (!this.isSupported() || !NativeLiveAudio) return false;
    return NativeLiveAudio.stopSession();
  }

  public async interrupt(): Promise<boolean> {
    if (!this.isSupported() || !NativeLiveAudio) return false;
    return NativeLiveAudio.interrupt();
  }

  public async muteMic(muted: boolean): Promise<boolean> {
    if (!this.isSupported() || !NativeLiveAudio) return false;
    return NativeLiveAudio.muteMic(muted);
  }

  public async commitTurn(): Promise<boolean> {
    if (!this.isSupported() || !NativeLiveAudio) return false;
    return NativeLiveAudio.commitTurn();
  }

  public async setOutputRoute(route: LiveOutputRoute): Promise<string> {
    if (!this.isSupported() || !NativeLiveAudio) return 'speaker';
    return NativeLiveAudio.setOutputRoute(route);
  }

  public onAudioLevel(callback: (event: AudioLevelEvent) => void): () => void {
    if (!this.eventEmitter) return () => {};
    const sub = this.eventEmitter.addListener('onAudioLevel', (data: any) => {
      callback(data as AudioLevelEvent);
    });
    return () => sub.remove();
  }

  public onTranscriptDelta(callback: (event: TranscriptDeltaEvent) => void): () => void {
    if (!this.eventEmitter) return () => {};
    const sub = this.eventEmitter.addListener('onTranscriptDelta', (data: any) => {
      callback(data as TranscriptDeltaEvent);
    });
    return () => sub.remove();
  }

  public onStateChange(callback: (event: StateChangeEvent) => void): () => void {
    if (!this.eventEmitter) return () => {};
    const sub = this.eventEmitter.addListener('onStateChange', (data: any) => {
      callback(data as StateChangeEvent);
    });
    return () => sub.remove();
  }

  public onTurnCommitted(callback: (event: TurnCommittedEvent) => void): () => void {
    if (!this.eventEmitter) return () => {};
    const sub = this.eventEmitter.addListener('onTurnCommitted', (data: any) => {
      callback(data as TurnCommittedEvent);
    });
    return () => sub.remove();
  }

  public onRouteOrFocusChange(
    callback: (event: RouteOrFocusChangeEvent) => void
  ): () => void {
    if (!this.eventEmitter) return () => {};
    const sub = this.eventEmitter.addListener('onRouteOrFocusChange', (data: any) => {
      callback(data as RouteOrFocusChangeEvent);
    });
    return () => sub.remove();
  }

  public onError(callback: (event: LiveErrorEvent) => void): () => void {
    if (!this.eventEmitter) return () => {};
    const sub = this.eventEmitter.addListener('onError', (data: any) => {
      callback(data as LiveErrorEvent);
    });
    return () => sub.remove();
  }

  public onTtsDownloadProgress(
    callback: (event: TtsDownloadProgressEvent) => void
  ): () => void {
    if (!this.eventEmitter) return () => {};
    const sub = this.eventEmitter.addListener('onTtsDownloadProgress', (data: any) => {
      callback(data as TtsDownloadProgressEvent);
    });
    return () => sub.remove();
  }

  public onTtsConfigChanged(
    callback: (event: LiveAudioCapabilities) => void
  ): () => void {
    if (!this.eventEmitter) return () => {};
    const sub = this.eventEmitter.addListener('onTtsConfigChanged', (data: any) => {
      callback(data as LiveAudioCapabilities);
    });
    return () => sub.remove();
  }

  public persistLiveTurnToStorage(
    params: PersistLiveTurnParams
  ): Promise<PersistLiveTurnResult> {
    const task = this.persistQueue.then(async (): Promise<PersistLiveTurnResult> => {
      const {
        sessionId,
        currentMessages,
        userText,
        assistantText,
        modelName,
        backend,
      } = params;

      const now = Date.now();
      const addedMessages: ChatMessage[] = [];
      if (userText.trim()) {
        addedMessages.push({
          id: `${now}_live_u`,
          role: 'user',
          text: userText.trim(),
        });
      }
      if (assistantText.trim()) {
        addedMessages.push({
          id: `${now + 1}_live_a`,
          role: 'assistant',
          text: assistantText.trim(),
          modelName,
          backend,
        });
      }

      if (addedMessages.length === 0) {
        return { sessionId: sessionId || '', addedMessages };
      }

      const allSessions = await loadSessions();
      const existing = sessionId
        ? allSessions.find((s) => s.id === sessionId)
        : undefined;

      if (existing) {
        existing.messages = [...existing.messages, ...addedMessages];
        existing.updatedAt = Date.now();
        existing.modelName = modelName;
        existing.backend = backend;
        await saveSession(existing);
        return { sessionId: existing.id, addedMessages };
      }

      const combinedMessages = [...currentMessages, ...addedMessages];
      const firstMsg = combinedMessages[0];
      const created = createSession(firstMsg, modelName, backend);
      created.messages = combinedMessages;
      await saveSession(created);
      await saveActiveSessionId(created.id);
      return { sessionId: created.id, addedMessages };
    });

    this.persistQueue = task.catch(() => {});
    return task;
  }
}

export const liveAudioService = new LiveAudioServiceImpl();
export default liveAudioService;
