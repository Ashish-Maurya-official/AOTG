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
}

export interface LiveAudioStartResult {
  success: boolean;
  inputMode: string;
  vadBackend: string;
  ttsBackend: string;
  activeRoute: string;
  aecEnabled: boolean;
  hwSampleRate: number;
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
}

export interface Spec extends TurboModule {
  startSession(config: LiveAudioSessionConfig): Promise<LiveAudioStartResult>;
  stopSession(): Promise<boolean>;
  interrupt(): Promise<boolean>;
  muteMic(muted: boolean): Promise<boolean>;
  commitTurn(): Promise<boolean>;
  setOutputRoute(route: string): Promise<string>;
  getCapabilities(): Promise<LiveAudioCapabilities>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('LiveAudio');
