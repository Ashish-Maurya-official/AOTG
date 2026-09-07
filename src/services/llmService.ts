import { NativeEventEmitter, Platform } from 'react-native';
import NativeLLM, {
  ModelStatusResult,
  InitializeResult,
} from '../native/turbo_modules/LLM/NativeLLM';

export interface TokenEvent {
  token: string;
  text: string;
  isFinished: boolean;
}

export interface GenerationCompleteEvent {
  fullText: string;
  isFinished: boolean;
}

export interface GenerationErrorEvent {
  error: string;
}

export interface DownloadProgressEvent {
  modelId: string;
  progress: number;
  bytesDownloaded: number;
  totalBytes: number;
  speedMBs: number;
}

export interface DownloadCompleteEvent {
  modelId: string;
  localPath: string;
  fileName: string;
  fileSizeBytes: number;
}

export interface DownloadErrorEvent {
  modelId: string;
  error: string;
}

export type BackendType = 'AUTO' | 'NPU' | 'GPU' | 'CPU';

class LLMServiceImpl {
  private eventEmitter: NativeEventEmitter | null = null;

  constructor() {
    if (Platform.OS === 'android') {
      try {
        this.eventEmitter = new NativeEventEmitter(NativeLLM);
      } catch (err) {
        console.warn('[LLMService] Could not initialize NativeEventEmitter:', err);
      }
    }
  }

  /**
   * Downloads a model file directly to disk from a remote URL
   */
  public async downloadModel(
    modelId: string,
    url: string,
    fileName: string,
    onProgress?: (event: DownloadProgressEvent) => void,
    onComplete?: (event: DownloadCompleteEvent) => void,
    onError?: (event: DownloadErrorEvent) => void
  ): Promise<() => void> {
    const subscriptions: { remove: () => void }[] = [];

    if (this.eventEmitter) {
      if (onProgress) {
        subscriptions.push(
          this.eventEmitter.addListener('onDownloadProgress', (data: any) => {
            if (data?.modelId === modelId) {
              onProgress(data as DownloadProgressEvent);
            }
          })
        );
      }

      if (onComplete) {
        subscriptions.push(
          this.eventEmitter.addListener('onDownloadComplete', (data: any) => {
            if (data?.modelId === modelId) {
              onComplete(data as DownloadCompleteEvent);
            }
          })
        );
      }

      if (onError) {
        subscriptions.push(
          this.eventEmitter.addListener('onDownloadError', (data: any) => {
            if (data?.modelId === modelId) {
              onError(data as DownloadErrorEvent);
            }
          })
        );
      }
    }

    try {
      NativeLLM.downloadModel(modelId, url, fileName).catch((err) => {
        if (onError) {
          onError({ modelId, error: err?.message || 'Download failed' });
        }
      });
    } catch (err) {
      subscriptions.forEach((sub) => sub.remove());
      throw err;
    }

    return () => {
      subscriptions.forEach((sub) => sub.remove());
    };
  }

  /**
   * Cancel an ongoing download
   */
  public async cancelDownload(modelId: string): Promise<boolean> {
    try {
      return await NativeLLM.cancelDownload(modelId);
    } catch (err) {
      console.error('[LLMService] cancelDownload error:', err);
      return false;
    }
  }

  /**
   * Check if a model file is downloaded on disk
   */
  public async checkModelStatus(fileName: string): Promise<ModelStatusResult> {
    try {
      return await NativeLLM.checkModelStatus(fileName);
    } catch (err) {
      return { isDownloaded: false, localPath: '', fileSizeBytes: 0 };
    }
  }

  /**
   * Delete a downloaded model file
   */
  public async deleteDownloadedModel(fileName: string): Promise<boolean> {
    try {
      return await NativeLLM.deleteDownloadedModel(fileName);
    } catch (err) {
      return false;
    }
  }

  /**
   * Load and initialize on-device LLM model weights with NPU -> GPU -> CPU fallback
   */
  public async initialize(
    modelPath: string,
    backend: BackendType = 'AUTO'
  ): Promise<InitializeResult> {
    try {
      return await NativeLLM.initialize(modelPath, backend);
    } catch (error) {
      console.error('[LLMService] initialize error:', error);
      throw error;
    }
  }

  /**
   * Start generating tokens for the given prompt with live token streaming
   */
  public async startGeneration(
    prompt: string,
    onToken?: (event: TokenEvent) => void,
    onComplete?: (event: GenerationCompleteEvent) => void,
    onError?: (event: GenerationErrorEvent) => void
  ): Promise<() => void> {
    const subscriptions: { remove: () => void }[] = [];

    if (this.eventEmitter) {
      if (onToken) {
        subscriptions.push(
          this.eventEmitter.addListener('onToken', (data: any) => {
            onToken(data as TokenEvent);
          })
        );
      }

      if (onComplete) {
        subscriptions.push(
          this.eventEmitter.addListener(
            'onGenerationComplete',
            (data: any) => {
              onComplete(data as GenerationCompleteEvent);
            }
          )
        );
      }

      if (onError) {
        subscriptions.push(
          this.eventEmitter.addListener(
            'onGenerationError',
            (data: any) => {
              onError(data as GenerationErrorEvent);
            }
          )
        );
      }
    }

    try {
      await NativeLLM.startGeneration(prompt);
    } catch (err) {
      subscriptions.forEach((sub) => sub.remove());
      throw err;
    }

    return () => {
      subscriptions.forEach((sub) => sub.remove());
    };
  }

  /**
   * Promise-based one-shot generation helper
   */
  public generate(
    prompt: string,
    onStream?: (chunk: string) => void
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      let unsubscribe: (() => void) | null = null;

      try {
        unsubscribe = await this.startGeneration(
          prompt,
          (event) => {
            if (onStream) {
              onStream(event.token);
            }
          },
          (event) => {
            if (unsubscribe) unsubscribe();
            resolve(event.fullText);
          },
          (errorEvent) => {
            if (unsubscribe) unsubscribe();
            reject(new Error(errorEvent.error));
          }
        );
      } catch (err) {
        if (unsubscribe) unsubscribe();
        reject(err);
      }
    });
  }

  /**
   * Immediately stops active token generation
   */
  public async stopGeneration(): Promise<boolean> {
    try {
      return await NativeLLM.stopGeneration();
    } catch (err) {
      console.error('[LLMService] stopGeneration error:', err);
      return false;
    }
  }

  /**
   * Checks if an LLM model is currently loaded in memory
   */
  public async isModelLoaded(): Promise<boolean> {
    try {
      return await NativeLLM.isModelLoaded();
    } catch (err) {
      return false;
    }
  }

  /**
   * Unloads the model to free device RAM
   */
  public async unloadModel(): Promise<boolean> {
    try {
      return await NativeLLM.unloadModel();
    } catch (err) {
      console.error('[LLMService] unloadModel error:', err);
      return false;
    }
  }
}

export const LLMService = new LLMServiceImpl();
export default LLMService;
