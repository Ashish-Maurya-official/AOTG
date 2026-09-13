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

export interface ContextUsage {
  /** Tokens currently held in the conversation KV cache (prompt + responses). */
  tokenCount: number;
  /** Hard cap configured on the engine. */
  maxTokens: number;
  isLoaded: boolean;
}

export interface Spec extends TurboModule {
  downloadModel(modelId: string, url: string, fileName: string): Promise<string>;
  cancelDownload(modelId: string): Promise<boolean>;
  checkModelStatus(fileName: string): Promise<ModelStatusResult>;
  deleteDownloadedModel(fileName: string): Promise<boolean>;
  getModelsDirectory(): Promise<string>;

  initialize(modelPath: string, backend: string): Promise<InitializeResult>;
  /** Text-only generation */
  startGeneration(prompt: string): Promise<boolean>;
  /** Multimodal generation with optional image — imagePath is an absolute file path on device */
  startGenerationWithImage(prompt: string, imagePath: string): Promise<boolean>;
  stopGeneration(): Promise<boolean>;
  /** True while the model is actively decoding a response */
  isGenerating(): Promise<boolean>;
  isModelLoaded(): Promise<boolean>;
  /** KV-cache usage of the live conversation */
  getContextUsage(): Promise<ContextUsage>;
  /** Drop the conversation history / KV cache and start a fresh one on the same engine */
  resetConversation(): Promise<boolean>;
  unloadModel(): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('LLM');
