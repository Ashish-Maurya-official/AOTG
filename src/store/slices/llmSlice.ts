import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type ModelStatus =
  | 'not_downloaded'
  | 'downloading'
  | 'downloaded'
  | 'loading'
  | 'loaded';

export type BackendType = 'AUTO' | 'NPU' | 'GPU' | 'CPU';

export interface ModelInfo {
  id: string;
  name: string;
  tag: string;
  size: string;
  description: string;
  url: string;
  fileName: string;
  badge?: string;
  /** Whether this model can accept image input (multimodal). Text-only models must NOT be sent screenshots. */
  supportsVision: boolean;
}

export interface ModelState {
  status: ModelStatus;
  progress: number;
  speedMBs?: number;
  bytesDownloaded?: number;
  totalBytes?: number;
  localPath?: string;
  error?: string | null;
}

export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    id: 'gemma-4-e2b',
    name: 'Gemma 4 E2B (IT)',
    tag: 'Google',
    size: '2.6 GB',
    description: 'The absolute latest generation (April 2026). Optimized for LiteRT-LM with top reasoning.',
    url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm?download=true',
    fileName: 'gemma-4-e2b.litertlm',
    supportsVision: false,
    badge: 'Latest 2026',
  },
  {
    id: 'deepseek-r1-distill-qwen-1.5b',
    name: 'DeepSeek R1 Distill 1.5B',
    tag: 'DeepSeek',
    size: '1.8 GB',
    description: "Edge-optimized distillation of DeepSeek's reasoning model, packaged specifically for the LiteRT-LM runtime.",
    url: 'https://huggingface.co/litert-community/DeepSeek-R1-Distill-Qwen-1.5B/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B_multi-prefill-seq_q8_ekv4096.litertlm?download=true',
    fileName: 'deepseek-r1-distill-qwen-1.5b.litertlm',
    supportsVision: false,
    badge: 'Reasoning',
  },
  {
    id: 'qwen-2.5-1.5b-instruct',
    name: 'Qwen 2.5 1.5B (IT)',
    tag: 'Alibaba',
    size: '1.6 GB',
    description: 'Excellent balance of speed and capability. Features 8-bit quantization and multi-prefill sequence packaging.',
    url: 'https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct/resolve/main/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm?download=true',
    fileName: 'qwen-2.5-1.5b-instruct.litertlm',
    supportsVision: false,
    badge: 'Fast',
  },
  {
    id: 'gemma-4-e4b',
    name: 'Gemma 4 E4B (IT)',
    tag: 'Google',
    size: '3.7 GB',
    description: 'Larger, highly capable sibling to E2B. Stronger reasoning capabilities at the cost of higher RAM footprint.',
    url: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm?download=true',
    fileName: 'gemma-4-e4b.litertlm',
    supportsVision: false,
  },
  {
    id: 'phi-4-mini-instruct',
    name: 'Phi-4-Mini Instruct',
    tag: 'Microsoft',
    size: '3.9 GB',
    description: "Microsoft's highly optimized SLM for mobile. 8-bit quantized configuration with a 4096 context window.",
    url: 'https://huggingface.co/litert-community/Phi-4-mini-instruct/resolve/main/Phi-4-mini-instruct_multi-prefill-seq_q8_ekv4096.litertlm?download=true',
    fileName: 'phi-4-mini-instruct.litertlm',
    supportsVision: false,
  },
];

interface LLMState {
  selectedModelId: string;
  loadedModelId: string | null;
  preferredBackend: BackendType;
  activeBackend: string | null;
  modelStatuses: Record<string, ModelState>;
}

const initialModelStatuses: Record<string, ModelState> = AVAILABLE_MODELS.reduce(
  (acc, model) => {
    acc[model.id] = {
      status: 'not_downloaded',
      progress: 0,
      speedMBs: 0,
      bytesDownloaded: 0,
      totalBytes: 0,
      error: null,
    };
    return acc;
  },
  {} as Record<string, ModelState>
);

const initialState: LLMState = {
  selectedModelId: 'gemma-4-e2b',
  loadedModelId: null,
  preferredBackend: 'AUTO',
  activeBackend: null,
  modelStatuses: initialModelStatuses,
};

const llmSlice = createSlice({
  name: 'llm',
  initialState,
  reducers: {
    setSelectedModel: (state, action: PayloadAction<string>) => {
      state.selectedModelId = action.payload;
    },
    setPreferredBackend: (state, action: PayloadAction<BackendType>) => {
      state.preferredBackend = action.payload;
    },
    setActiveBackend: (state, action: PayloadAction<string | null>) => {
      state.activeBackend = action.payload;
    },
    startDownload: (state, action: PayloadAction<string>) => {
      const modelId = action.payload;
      state.modelStatuses[modelId] = {
        status: 'downloading',
        progress: 0,
        speedMBs: 0,
        bytesDownloaded: 0,
        totalBytes: 0,
        error: null,
      };
    },
    setDownloadProgress: (
      state,
      action: PayloadAction<{
        modelId: string;
        progress: number;
        speedMBs?: number;
        bytesDownloaded?: number;
        totalBytes?: number;
      }>
    ) => {
      const { modelId, progress, speedMBs, bytesDownloaded, totalBytes } =
        action.payload;
      if (state.modelStatuses[modelId]) {
        state.modelStatuses[modelId].status = 'downloading';
        state.modelStatuses[modelId].progress = progress;
        if (speedMBs !== undefined) state.modelStatuses[modelId].speedMBs = speedMBs;
        if (bytesDownloaded !== undefined)
          state.modelStatuses[modelId].bytesDownloaded = bytesDownloaded;
        if (totalBytes !== undefined)
          state.modelStatuses[modelId].totalBytes = totalBytes;
      }
    },
    setDownloaded: (
      state,
      action: PayloadAction<{ modelId: string; localPath?: string }>
    ) => {
      const { modelId, localPath } = action.payload;
      state.modelStatuses[modelId] = {
        status: 'downloaded',
        progress: 100,
        localPath: localPath || state.modelStatuses[modelId]?.localPath,
        error: null,
      };
    },
    setDownloadError: (
      state,
      action: PayloadAction<{ modelId: string; error: string }>
    ) => {
      const { modelId, error } = action.payload;
      if (state.modelStatuses[modelId]) {
        state.modelStatuses[modelId].status = 'not_downloaded';
        state.modelStatuses[modelId].progress = 0;
        state.modelStatuses[modelId].error = error;
      }
    },
    syncModelStatus: (
      state,
      action: PayloadAction<{
        modelId: string;
        isDownloaded: boolean;
        localPath?: string;
      }>
    ) => {
      const { modelId, isDownloaded, localPath } = action.payload;
      if (state.modelStatuses[modelId]) {
        if (isDownloaded) {
          state.modelStatuses[modelId].status =
            state.loadedModelId === modelId ? 'loaded' : 'downloaded';
          state.modelStatuses[modelId].progress = 100;
          state.modelStatuses[modelId].localPath = localPath;
        } else if (state.modelStatuses[modelId].status !== 'downloading') {
          state.modelStatuses[modelId].status = 'not_downloaded';
          state.modelStatuses[modelId].progress = 0;
        }
      }
    },
    startLoadingModel: (state, action: PayloadAction<string>) => {
      const modelId = action.payload;
      if (state.modelStatuses[modelId]) {
        state.modelStatuses[modelId].status = 'loading';
        state.modelStatuses[modelId].error = null;
      }
    },
    setModelLoadFailed: (
      state,
      action: PayloadAction<{ modelId: string; error: string }>
    ) => {
      // A load attempt only starts once a model is downloaded, so on failure
      // we revert its status back to 'downloaded' (never stuck on 'loading').
      const { modelId, error } = action.payload;
      if (state.modelStatuses[modelId]) {
        state.modelStatuses[modelId].status = 'downloaded';
        state.modelStatuses[modelId].error = error;
      }
      if (state.loadedModelId === modelId) {
        state.loadedModelId = null;
        state.activeBackend = null;
      }
    },
    setLoadedModel: (
      state,
      action: PayloadAction<{ modelId: string; backend?: string }>
    ) => {
      const { modelId, backend } = action.payload;
      if (state.loadedModelId && state.loadedModelId !== modelId) {
        if (state.modelStatuses[state.loadedModelId]?.status === 'loaded') {
          state.modelStatuses[state.loadedModelId].status = 'downloaded';
        }
      }
      state.selectedModelId = modelId;
      state.loadedModelId = modelId;
      if (backend) {
        state.activeBackend = backend;
      }
      if (state.modelStatuses[modelId]) {
        state.modelStatuses[modelId].status = 'loaded';
      }
    },
    deleteModel: (state, action: PayloadAction<string>) => {
      const modelId = action.payload;
      state.modelStatuses[modelId] = {
        status: 'not_downloaded',
        progress: 0,
        speedMBs: 0,
        bytesDownloaded: 0,
        totalBytes: 0,
        localPath: undefined,
        error: null,
      };
      if (state.loadedModelId === modelId) {
        state.loadedModelId = null;
        state.activeBackend = null;
      }
    },
    unloadModel: (state) => {
      if (state.loadedModelId && state.modelStatuses[state.loadedModelId]) {
        state.modelStatuses[state.loadedModelId].status = 'downloaded';
      }
      state.loadedModelId = null;
      state.activeBackend = null;
    },
  },
});

export const {
  setSelectedModel,
  setPreferredBackend,
  setActiveBackend,
  startDownload,
  setDownloadProgress,
  setDownloaded,
  setDownloadError,
  syncModelStatus,
  startLoadingModel,
  setModelLoadFailed,
  setLoadedModel,
  deleteModel,
  unloadModel,
} = llmSlice.actions;

export default llmSlice.reducer;
