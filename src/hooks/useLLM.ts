import { useState, useCallback, useRef, useEffect } from 'react';
import LLMService, { BackendType, TokenEvent } from '../services/llmService';
import { InitializeResult } from '../native/turbo_modules/LLM/NativeLLM';

export interface UseLLMReturn {
  isLoaded: boolean;
  isGenerating: boolean;
  activeBackend: string | null;
  streamedText: string;
  error: string | null;
  loadModel: (modelPath: string, backend?: BackendType) => Promise<InitializeResult>;
  generate: (prompt: string, onToken?: (token: string) => void) => Promise<string>;
  stopGeneration: () => Promise<boolean>;
  unloadModel: () => Promise<boolean>;
}

export const useLLM = (): UseLLMReturn => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeBackend, setActiveBackend] = useState<string | null>(null);
  const [streamedText, setStreamedText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cleanupRef = useRef<(() => void) | null>(null);

  // Sync loaded state on mount
  useEffect(() => {
    LLMService.isModelLoaded().then(setIsLoaded).catch(() => setIsLoaded(false));

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, []);

  const loadModel = useCallback(
    async (modelPath: string, backend: BackendType = 'AUTO'): Promise<InitializeResult> => {
      setError(null);
      try {
        const result = await LLMService.initialize(modelPath, backend);
        setIsLoaded(result.success);
        setActiveBackend(result.actualBackend);
        return result;
      } catch (err: any) {
        const msg = err?.message || 'Failed to initialize LLM model';
        setError(msg);
        setIsLoaded(false);
        setActiveBackend(null);
        throw err;
      }
    },
    []
  );

  const generate = useCallback(
    async (prompt: string, onToken?: (token: string) => void): Promise<string> => {
      setError(null);
      setIsGenerating(true);
      setStreamedText('');

      return new Promise(async (resolve, reject) => {
        try {
          cleanupRef.current = await LLMService.startGeneration(
            prompt,
            (event: TokenEvent) => {
              setStreamedText(event.text);
              if (onToken) {
                onToken(event.token);
              }
            },
            (completeEvent) => {
              setIsGenerating(false);
              setStreamedText(completeEvent.fullText);
              if (cleanupRef.current) {
                cleanupRef.current();
                cleanupRef.current = null;
              }
              resolve(completeEvent.fullText);
            },
            (errorEvent) => {
              setIsGenerating(false);
              setError(errorEvent.error);
              if (cleanupRef.current) {
                cleanupRef.current();
                cleanupRef.current = null;
              }
              reject(new Error(errorEvent.error));
            }
          );
        } catch (err: any) {
          setIsGenerating(false);
          setError(err?.message || 'Failed to start generation');
          reject(err);
        }
      });
    },
    []
  );

  const stopGeneration = useCallback(async () => {
    const stopped = await LLMService.stopGeneration();
    // NOTE: we intentionally do NOT remove the token/complete listeners here.
    // The native side emits a final onGenerationComplete (with the partial
    // text) when stopped, which resolves the pending generate() promise and
    // runs its own cleanup. Removing listeners now would drop that event and
    // leave the awaiting caller hanging forever.
    if (stopped) {
      setIsGenerating(false);
    }
    return stopped;
  }, []);

  const unloadModel = useCallback(async () => {
    // Stop any active generation first before unloading
    if (isGenerating) {
      try {
        await LLMService.stopGeneration();
      } catch (_) {
        // Ignore — we're unloading anyway
      }
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      setIsGenerating(false);
    }

    const success = await LLMService.unloadModel();
    if (success) {
      setIsLoaded(false);
      setIsGenerating(false);
      setActiveBackend(null);
      setStreamedText('');
    }
    return success;
  }, [isGenerating]);

  return {
    isLoaded,
    isGenerating,
    activeBackend,
    streamedText,
    error,
    loadModel,
    generate,
    stopGeneration,
    unloadModel,
  };
};

export default useLLM;
