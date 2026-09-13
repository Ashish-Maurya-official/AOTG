import { NativeEventEmitter, Platform } from 'react-native';
import NativeLLM, {
  ModelStatusResult,
  InitializeResult,
  ContextUsage,
} from '../native/turbo_modules/LLM/NativeLLM';

export type { ContextUsage };

/**
 * Conservative chars→tokens estimate for on-device tokenizers. JSON-heavy
 * prompts (accessibility trees) tokenize densely, so ~3.2 chars/token.
 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3.2);

/** Tokens kept free for the model's own answer on every turn. */
export const RESPONSE_RESERVE_TOKENS = 512;

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
   * Multimodal generation — passes a screenshot image + text prompt to a
   * vision-capable LiteRT-LM model (e.g. PaliGemma, Gemma 3n, InternVL3).
   *
   * @param prompt     The text prompt describing what to decide/reason about
   * @param imagePath  Absolute path to a JPEG/PNG screenshot on the device
   * @param onStream   Optional callback for streaming tokens as they arrive
   */
  public generateWithVision(
    prompt: string,
    imagePath: string,
    onStream?: (chunk: string) => void
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const subscriptions: {remove: () => void}[] = [];

      if (this.eventEmitter) {
        subscriptions.push(
          this.eventEmitter.addListener('onToken', (data: any) => {
            if (onStream) onStream(data.token);
          })
        );
        subscriptions.push(
          this.eventEmitter.addListener('onGenerationComplete', (data: any) => {
            subscriptions.forEach(s => s.remove());
            resolve(data.fullText);
          })
        );
        subscriptions.push(
          this.eventEmitter.addListener('onGenerationError', (data: any) => {
            subscriptions.forEach(s => s.remove());
            reject(new Error(data.error));
          })
        );
      }

      try {
        await NativeLLM.startGenerationWithImage(prompt, imagePath);
      } catch (err) {
        subscriptions.forEach(s => s.remove());
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
   * True while the model is actively decoding a response
   */
  public async isGenerating(): Promise<boolean> {
    try {
      return await NativeLLM.isGenerating();
    } catch (err) {
      return false;
    }
  }

  /**
   * KV-cache usage of the live conversation
   */
  public async getContextUsage(): Promise<ContextUsage> {
    try {
      return await NativeLLM.getContextUsage();
    } catch (err) {
      return { tokenCount: 0, maxTokens: 0, isLoaded: false };
    }
  }

  /**
   * Tokens still available for the NEXT prompt, after keeping room for the answer.
   * Returns Infinity when no model is loaded (nothing to budget against).
   */
  public async getRemainingContextTokens(): Promise<number> {
    const usage = await this.getContextUsage();
    if (!usage.isLoaded || usage.maxTokens <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(0, usage.maxTokens - usage.tokenCount - RESPONSE_RESERVE_TOKENS);
  }

  /**
   * Drops the conversation history / KV cache and starts a fresh one on the same engine
   */
  public async resetConversation(): Promise<boolean> {
    try {
      return await NativeLLM.resetConversation();
    } catch (err) {
      console.error('[LLMService] resetConversation error:', err);
      return false;
    }
  }

  /**
   * Guarantees a prompt of `promptTokens` fits in the live conversation. When the
   * accumulated KV cache leaves too little room, the conversation is reset (this is
   * the only way to free KV memory). Returns true when a reset happened so callers
   * can inform the user.
   */
  public async ensureContextBudget(promptTokens: number): Promise<boolean> {
    const remaining = await this.getRemainingContextTokens();
    if (promptTokens <= remaining) return false;
    console.warn(
      `[LLMService] Context nearly full (need ${promptTokens}, have ${remaining}) — resetting conversation`
    );
    return this.resetConversation();
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
