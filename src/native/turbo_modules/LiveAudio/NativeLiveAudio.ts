import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface LiveSeedMessage {
  role: string;
  text: string;
}

export interface LiveAudioSessionConfig {
  modelPath: string;
  backend: string;
  supportsAudio: boolean;
  maxContextLength: number;
  systemInstruction: string;
  seedHistory: Array<LiveSeedMessage>;
  useDeviceAsrFallback: boolean;
  vadSensitivity: number;
  speakerRoute: string;
  disableVision: boolean;
  ttsEngine?: string;
  voiceId?: string;
  language?: string;
}

export interface LiveAudioStartResult {
  success: boolean;
  inputMode: string;
  vadBackend: string;
  ttsBackend: string;
  voiceId: string;
  activeRoute: string;
  aecEnabled: boolean;
  hwSampleRate: number;
}

export interface PhononVoiceInfo {
  id: string;
  label: string;
  description: string;
  downloaded: boolean;
}

export interface SpeechVoiceInfo {
  id: string;
  label: string;
  description: string;
  language: string;
  downloaded: boolean;
}

export interface SpeechModelInfo {
  id: string;
  label: string;
  subtitle: string;
  engineFamily: string;
  languages: Array<string>;
  sampleRate: number;
  estimatedBytes: number;
  installedBytes: number;
  installed: boolean;
  downloading: boolean;
  percent: number;
  supportsHindi: boolean;
  supportsEnglish: boolean;
  defaultVoiceId: string;
  installedVoices: Array<string>;
  voices: Array<SpeechVoiceInfo>;
}

export interface LiveAudioCapabilities {
  hasSileroModel: boolean;
  hasDeviceAsr: boolean;
  hasTtsEngine: boolean;
  hasAcousticEchoCanceler: boolean;
  hasNoiseSuppressor: boolean;
  isModelLoaded: boolean;
  modelSupportsAudio: boolean;
  availableRoutes: Array<string>;
  phononInstalled: boolean;
  phononDownloading: boolean;
  phononExpectedBytes: number;
  phononDiskBytes: number;
  phononVariant: string;
  selectedTtsEngine: string;
  selectedVoiceId: string;
  downloadedVoices: Array<string>;
  availableVoices: Array<PhononVoiceInfo>;
  ttsModels: Array<SpeechModelInfo>;
}

export interface Spec extends TurboModule {
  startSession(config: LiveAudioSessionConfig): Promise<LiveAudioStartResult>;
  stopSession(): Promise<boolean>;
  interrupt(): Promise<boolean>;
  muteMic(muted: boolean): Promise<boolean>;
  commitTurn(): Promise<boolean>;
  setOutputRoute(route: string): Promise<string>;
  getCapabilities(): Promise<LiveAudioCapabilities>;
  downloadPhononModel(variant: string, voiceId: string): Promise<boolean>;
  cancelPhononDownload(): Promise<boolean>;
  deletePhononModel(): Promise<boolean>;
  downloadTtsModel(modelId: string, voiceId: string): Promise<boolean>;
  cancelTtsModelDownload(modelId: string): Promise<boolean>;
  deleteTtsModel(modelId: string): Promise<boolean>;
  setTtsConfig(ttsEngine: string, voiceId: string): Promise<LiveAudioCapabilities>;
  setLanguage(language: string): Promise<string>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('LiveAudio');
