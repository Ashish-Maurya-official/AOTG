import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export interface ModelStatusResult {
  isDownloaded: boolean;
  localPath: string;
  fileSizeBytes: number;
}

export interface InitializeResult {
  success: boolean;
  modelPath: string;
  requestedBackend: string;
  actualBackend: string;
  wasFallback: boolean;
}

export interface Spec extends TurboModule {
  downloadModel(modelId: string, url: string, fileName: string): Promise<string>;
  cancelDownload(modelId: string): Promise<boolean>;
  checkModelStatus(fileName: string): Promise<ModelStatusResult>;
  deleteDownloadedModel(fileName: string): Promise<boolean>;
  getModelsDirectory(): Promise<string>;

  initialize(modelPath: string, backend: string): Promise<InitializeResult>;
  startGeneration(prompt: string): Promise<boolean>;
  stopGeneration(): Promise<boolean>;
  isModelLoaded(): Promise<boolean>;
  unloadModel(): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('LLM');
