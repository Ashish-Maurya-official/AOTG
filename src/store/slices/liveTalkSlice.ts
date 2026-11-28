import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  isValidTtsEnginePref,
  LiveTtsEnginePref,
  SPEECH_MODEL_IDS,
  SpeechModelId,
} from '../../utils/speechModels';

export type { LiveTtsEnginePref, SpeechModelId };
export { isValidTtsEnginePref, SPEECH_MODEL_IDS };

export type LiveTalkState =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'SPEAKING'
  | 'INTERRUPTED';

export type LiveInputMode = 'audio_bytes' | 'os_asr';
export type LiveVadBackend = 'silero_onnx' | 'dsp_fallback';
export type LiveOutputRoute = 'auto' | 'speaker' | 'earpiece' | 'bluetooth' | 'wired';
export type LiveTtsBackend = SpeechModelId | 'android_tts';
export type LiveLanguage = 'auto' | 'en' | 'hi';
export type PhononDownloadStatus =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'ready'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface PhononVoiceOption {
  id: string;
  label: string;
  description: string;
  downloaded: boolean;
}

export interface SpeechModelVoiceOption {
  id: string;
  label: string;
  description: string;
  language: string;
  downloaded: boolean;
}

export interface SpeechModelOption {
  id: SpeechModelId;
  label: string;
  subtitle: string;
  engineFamily: string;
  languages: string[];
  sampleRate: number;
  estimatedBytes: number;
  installedBytes: number;
  installed: boolean;
  downloading: boolean;
  percent: number;
  supportsHindi: boolean;
  supportsEnglish: boolean;
  defaultVoiceId: string;
  installedVoices: string[];
  voices: SpeechModelVoiceOption[];
}

export interface SpeechDownloadState {
  modelId: string;
  status: PhononDownloadStatus;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
}

export interface PhononDownloadState {
  status: PhononDownloadStatus;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  currentFile: string | null;
  error: string | null;
}

export const DEFAULT_SPEECH_MODELS: SpeechModelOption[] = [
  {
    id: 'mms_tts_hin',
    label: 'Xenova MMS-TTS Hindi',
    subtitle: 'Meta VITS INT8 · Fast pure-Devanagari Hindi (16 kHz)',
    engineFamily: 'onnx_vits',
    languages: ['hi'],
    sampleRate: 16_000,
    estimatedBytes: 38_371_388,
    installedBytes: 0,
    installed: false,
    downloading: false,
    percent: 0,
    supportsHindi: true,
    supportsEnglish: false,
    defaultVoiceId: 'default',
    installedVoices: [],
    voices: [
      {
        id: 'default',
        label: 'MMS Hindi',
        description: 'Natural native Hindi speaker',
        language: 'hi',
        downloaded: false,
      },
    ],
  },
  {
    id: 'indic_tiny_hi',
    label: 'Indic-Tiny-TTS Hindi',
    subtitle: 'Matcha + Vocos 24 kHz studio Hindi (Female & Male)',
    engineFamily: 'onnx_matcha',
    languages: ['hi'],
    sampleRate: 24_000,
    estimatedBytes: 91_021_687,
    installedBytes: 0,
    installed: false,
    downloading: false,
    percent: 0,
    supportsHindi: true,
    supportsEnglish: false,
    defaultVoiceId: 'female',
    installedVoices: [],
    voices: [
      { id: 'female', label: 'Hindi Female', description: 'Expressive studio female', language: 'hi', downloaded: false },
      { id: 'male', label: 'Hindi Male', description: 'Warm clear male', language: 'hi', downloaded: false },
    ],
  },
  {
    id: 'piper_hi',
    label: 'Piper Hindi (VITS INT8)',
    subtitle: 'Ultra-fast ~21 MB Hindi voices with eSpeak phonemizer',
    engineFamily: 'sherpa_vits',
    languages: ['hi'],
    sampleRate: 22_050,
    estimatedBytes: 21_064_499,
    installedBytes: 0,
    installed: false,
    downloading: false,
    percent: 0,
    supportsHindi: true,
    supportsEnglish: false,
    defaultVoiceId: 'rohan',
    installedVoices: [],
    voices: [
      { id: 'rohan', label: 'Rohan (Medium)', description: 'Clear conversational male', language: 'hi', downloaded: false },
      { id: 'pratham', label: 'Pratham (Medium)', description: 'Deep balanced Hindi male', language: 'hi', downloaded: false },
      { id: 'priyamvada', label: 'Priyamvada (Medium)', description: 'Natural expressive female', language: 'hi', downloaded: false },
    ],
  },
  {
    id: 'kokoro_multi',
    label: 'Kokoro-82M Multi-Lang INT8',
    subtitle: 'Bilingual English + Hindi 24 kHz studio neural voices',
    engineFamily: 'sherpa_kokoro',
    languages: ['hi', 'en'],
    sampleRate: 24_000,
    estimatedBytes: 132_353_410,
    installedBytes: 0,
    installed: false,
    downloading: false,
    percent: 0,
    supportsHindi: true,
    supportsEnglish: true,
    defaultVoiceId: 'af_heart',
    installedVoices: [],
    voices: [
      { id: 'hf_alpha', label: 'Alpha (Hindi F)', description: 'Natural Hindi female', language: 'hi', downloaded: false },
      { id: 'hf_beta', label: 'Beta (Hindi F)', description: 'Soft Hindi female', language: 'hi', downloaded: false },
      { id: 'hm_omega', label: 'Omega (Hindi M)', description: 'Warm Hindi male', language: 'hi', downloaded: false },
      { id: 'hm_psi', label: 'Psi (Hindi M)', description: 'Clear Hindi male', language: 'hi', downloaded: false },
      { id: 'af_heart', label: 'Heart (EN F)', description: 'Expressive US female', language: 'en', downloaded: false },
      { id: 'af_bella', label: 'Bella (EN F)', description: 'Warm US female', language: 'en', downloaded: false },
      { id: 'am_adam', label: 'Adam (EN M)', description: 'Crisp US male', language: 'en', downloaded: false },
      { id: 'bf_emma', label: 'Emma (EN UK F)', description: 'Clear British female', language: 'en', downloaded: false },
      { id: 'bm_george', label: 'George (EN UK M)', description: 'Steady British male', language: 'en', downloaded: false },
    ],
  },
  {
    id: 'piper_en',
    label: 'Piper English (VITS INT8)',
    subtitle: 'Ultra-fast ~21 MB US English voices for low-RAM devices',
    engineFamily: 'sherpa_vits',
    languages: ['en'],
    sampleRate: 22_050,
    estimatedBytes: 20_969_179,
    installedBytes: 0,
    installed: false,
    downloading: false,
    percent: 0,
    supportsHindi: false,
    supportsEnglish: true,
    defaultVoiceId: 'lessac',
    installedVoices: [],
    voices: [
      { id: 'lessac', label: 'Lessac (US Medium)', description: 'Articulate balanced neutral', language: 'en', downloaded: false },
      { id: 'amy', label: 'Amy (US Medium)', description: 'Warm conversational US female', language: 'en', downloaded: false },
    ],
  },
  {
    id: 'kitten_en',
    label: 'KittenTTS Nano v0.8 INT8',
    subtitle: 'Tiny 31 MB 8-voice expressive English generator',
    engineFamily: 'sherpa_kitten',
    languages: ['en'],
    sampleRate: 24_000,
    estimatedBytes: 31_220_690,
    installedBytes: 0,
    installed: false,
    downloading: false,
    percent: 0,
    supportsHindi: false,
    supportsEnglish: true,
    defaultVoiceId: 'jasper',
    installedVoices: [],
    voices: [
      { id: 'bella', label: 'Bella', description: 'Warm expressive female', language: 'en', downloaded: false },
      { id: 'jasper', label: 'Jasper', description: 'Balanced studio male', language: 'en', downloaded: false },
      { id: 'luna', label: 'Luna', description: 'Soft gentle female', language: 'en', downloaded: false },
      { id: 'bruno', label: 'Bruno', description: 'Deep steady male', language: 'en', downloaded: false },
      { id: 'rosie', label: 'Rosie', description: 'Upbeat friendly female', language: 'en', downloaded: false },
      { id: 'hugo', label: 'Hugo', description: 'Crisp narrator male', language: 'en', downloaded: false },
      { id: 'kiki', label: 'Kiki', description: 'Bright energetic female', language: 'en', downloaded: false },
      { id: 'leo', label: 'Leo', description: 'Conversational male', language: 'en', downloaded: false },
    ],
  },
  {
    id: 'pocket_tts',
    label: 'PocketTTS INT8 (Kyutai)',
    subtitle: 'High-fidelity zero-shot voice-conditioned English (24 kHz)',
    engineFamily: 'sherpa_pocket',
    languages: ['en'],
    sampleRate: 24_000,
    estimatedBytes: 98_337_865,
    installedBytes: 0,
    installed: false,
    downloading: false,
    percent: 0,
    supportsHindi: false,
    supportsEnglish: true,
    defaultVoiceId: 'default',
    installedVoices: [],
    voices: [
      { id: 'default', label: 'Pocket Studio', description: 'Default zero-shot reference voice', language: 'en', downloaded: false },
    ],
  },
];

export const DEFAULT_PHONON_VOICES: PhononVoiceOption[] = [
  { id: 'easton', label: 'Easton', description: 'Warm & clear', downloaded: false },
  { id: 'juniper', label: 'Juniper', description: 'Bright & friendly', downloaded: false },
  { id: 'zoey', label: 'Zoey', description: 'Crisp & expressive', downloaded: false },
  { id: 'harper', label: 'Harper', description: 'Calm narrator', downloaded: false },
  { id: 'micah', label: 'Micah', description: 'Steady & natural', downloaded: false },
  { id: 'freya', label: 'Freya', description: 'Soft conversational', downloaded: false },
  { id: 'alfie', label: 'Alfie', description: 'Upbeat & brisk', downloaded: false },
  { id: 'delia', label: 'Delia', description: 'Balanced & studio', downloaded: false },
];

export interface LiveCaptionTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isFinal: boolean;
  wasInterrupted?: boolean;
}

export interface LiveTalkSliceState {
  isVisible: boolean;
  isStarting: boolean;
  sessionState: LiveTalkState;
  isMuted: boolean;
  inputMode: LiveInputMode;
  vadBackend: LiveVadBackend;
  preferredRoute: LiveOutputRoute;
  activeRoute: LiveOutputRoute;
  aecEnabled: boolean;
  vadSpeechActive: boolean;
  activeTurnId: string | null;
  userTranscript: string;
  assistantTranscript: string;
  turns: LiveCaptionTurn[];
  error: string | null;
  language: LiveLanguage;
  ttsEnginePref: LiveTtsEnginePref;
  ttsBackend: LiveTtsBackend;
  selectedVoiceId: string;
  phononInstalled: boolean;
  phononDownloading: boolean;
  phononExpectedBytes: number;
  phononDiskBytes: number;
  phononVariant: string;
  availableVoices: PhononVoiceOption[];
  phononDownload: PhononDownloadState;
  ttsModels: SpeechModelOption[];
  speechDownloads: Record<string, SpeechDownloadState>;
}

const MAX_DISPLAY_TURNS = 24;
const DEFAULT_PHONON_EXPECTED_BYTES = 68_565_296;

const initialState: LiveTalkSliceState = {
  isVisible: false,
  isStarting: false,
  sessionState: 'IDLE',
  isMuted: false,
  inputMode: 'audio_bytes',
  vadBackend: 'dsp_fallback',
  preferredRoute: 'auto',
  activeRoute: 'speaker',
  aecEnabled: false,
  vadSpeechActive: false,
  activeTurnId: null,
  userTranscript: '',
  assistantTranscript: '',
  turns: [],
  error: null,
  language: 'auto',
  ttsEnginePref: 'auto',
  ttsBackend: 'android_tts',
  selectedVoiceId: 'easton',
  phononInstalled: false,
  phononDownloading: false,
  phononExpectedBytes: DEFAULT_PHONON_EXPECTED_BYTES,
  phononDiskBytes: 0,
  phononVariant: '',
  availableVoices: DEFAULT_PHONON_VOICES,
  phononDownload: {
    status: 'idle',
    percent: 0,
    downloadedBytes: 0,
    totalBytes: DEFAULT_PHONON_EXPECTED_BYTES,
    currentFile: null,
    error: null,
  },
  ttsModels: DEFAULT_SPEECH_MODELS,
  speechDownloads: {},
};

const liveTalkSlice = createSlice({
  name: 'liveTalk',
  initialState,
  reducers: {
    openLiveTalkModal(state) {
      state.isVisible = true;
      state.error = null;
    },
    closeLiveTalkModal(state) {
      state.isVisible = false;
      state.isStarting = false;
      state.sessionState = 'IDLE';
      state.isMuted = false;
      state.vadSpeechActive = false;
      state.activeTurnId = null;
      state.userTranscript = '';
      state.assistantTranscript = '';
      state.error = null;
    },
    setSessionStarting(state, action: PayloadAction<boolean>) {
      state.isStarting = action.payload;
      if (action.payload) {
        state.error = null;
      }
    },
    sessionStarted(
      state,
      action: PayloadAction<{
        inputMode: LiveInputMode;
        vadBackend: LiveVadBackend;
        activeRoute: LiveOutputRoute;
        aecEnabled: boolean;
        ttsBackend?: LiveTtsBackend;
        voiceId?: string;
      }>
    ) {
      state.isStarting = false;
      state.sessionState = 'LISTENING';
      state.isMuted = false;
      state.inputMode = action.payload.inputMode;
      state.vadBackend = action.payload.vadBackend;
      state.activeRoute = action.payload.activeRoute;
      state.aecEnabled = action.payload.aecEnabled;
      if (action.payload.ttsBackend) {
        state.ttsBackend = action.payload.ttsBackend;
      }
      if (action.payload.voiceId) {
        state.selectedVoiceId = action.payload.voiceId;
      }
      state.error = null;
    },
    setSessionState(state, action: PayloadAction<LiveTalkState>) {
      state.sessionState = action.payload;
      if (action.payload === 'LISTENING') {
        state.vadSpeechActive = false;
      }
    },
    setMicMuted(state, action: PayloadAction<boolean>) {
      state.isMuted = action.payload;
    },
    setPreferredRoute(state, action: PayloadAction<LiveOutputRoute>) {
      state.preferredRoute = action.payload;
    },
    updateRouteOrFocus(
      state,
      action: PayloadAction<{ route: LiveOutputRoute; aecEnabled?: boolean }>
    ) {
      state.activeRoute = action.payload.route;
      if (typeof action.payload.aecEnabled === 'boolean') {
        state.aecEnabled = action.payload.aecEnabled;
      }
    },
    setVadSpeechActive(state, action: PayloadAction<boolean>) {
      state.vadSpeechActive = action.payload;
    },
    applyTranscriptDelta(
      state,
      action: PayloadAction<{
        turnId: string;
        role: 'user' | 'assistant';
        fullText: string;
        isFinal: boolean;
      }>
    ) {
      const { turnId, role, fullText } = action.payload;
      if (state.activeTurnId !== turnId && role === 'user') {
        state.activeTurnId = turnId;
        state.userTranscript = fullText;
        state.assistantTranscript = '';
        return;
      }
      state.activeTurnId = turnId;
      if (role === 'user') {
        state.userTranscript = fullText;
      } else {
        state.assistantTranscript = fullText;
      }
    },
    commitLiveTurn(
      state,
      action: PayloadAction<{
        turnId: string;
        userText: string;
        assistantText: string;
        wasInterrupted: boolean;
      }>
    ) {
      const { turnId, userText, assistantText, wasInterrupted } = action.payload;
      if (userText.trim()) {
        state.turns.push({
          id: `${turnId}_u`,
          role: 'user',
          text: userText.trim(),
          isFinal: true,
        });
      }
      if (assistantText.trim()) {
        state.turns.push({
          id: `${turnId}_a`,
          role: 'assistant',
          text: assistantText.trim(),
          isFinal: true,
          wasInterrupted,
        });
      }
      if (state.turns.length > MAX_DISPLAY_TURNS) {
        state.turns = state.turns.slice(state.turns.length - MAX_DISPLAY_TURNS);
      }
      state.activeTurnId = null;
      state.userTranscript = '';
      state.assistantTranscript = '';
    },
    seedModalTurns(state, action: PayloadAction<LiveCaptionTurn[]>) {
      state.turns = action.payload.slice(-MAX_DISPLAY_TURNS);
    },
    setLiveTalkError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
      state.isStarting = false;
    },
    setLiveLanguage(state, action: PayloadAction<LiveLanguage>) {
      state.language = action.payload;
    },
    setTtsPreference(
      state,
      action: PayloadAction<{
        ttsEnginePref?: LiveTtsEnginePref;
        selectedVoiceId?: string;
      }>
    ) {
      if (action.payload.ttsEnginePref) {
        const pref = action.payload.ttsEnginePref;
        state.ttsEnginePref = pref;
        if (pref === 'android_tts') {
          state.ttsBackend = 'android_tts';
        } else if (pref !== 'auto') {
          const model = state.ttsModels.find((m) => m.id === pref);
          if ((pref === 'phonon_31m' && state.phononInstalled) || model?.installed) {
            state.ttsBackend = pref;
          }
        }
      }
      if (action.payload.selectedVoiceId) {
        state.selectedVoiceId = action.payload.selectedVoiceId;
      }
    },
    applyTtsCapabilities(
      state,
      action: PayloadAction<{
        phononInstalled: boolean;
        phononDownloading: boolean;
        phononExpectedBytes: number;
        phononDiskBytes: number;
        phononVariant: string;
        selectedTtsEngine: string;
        selectedVoiceId: string;
        availableVoices?: PhononVoiceOption[];
        ttsModels?: Array<Omit<SpeechModelOption, 'id'> & { id: string }>;
      }>
    ) {
      const p = action.payload;
      state.phononInstalled = p.phononInstalled;
      state.phononDownloading = p.phononDownloading;
      if (p.phononExpectedBytes > 0) {
        state.phononExpectedBytes = p.phononExpectedBytes;
      }
      state.phononDiskBytes = p.phononDiskBytes;
      state.phononVariant = p.phononVariant || '';
      if (isValidTtsEnginePref(p.selectedTtsEngine)) {
        state.ttsEnginePref = p.selectedTtsEngine;
      }
      if (p.selectedVoiceId) {
        state.selectedVoiceId = p.selectedVoiceId;
      }
      if (p.availableVoices && p.availableVoices.length > 0) {
        state.availableVoices = p.availableVoices;
      }
      if (p.ttsModels && p.ttsModels.length > 0) {
        const validModels = p.ttsModels.filter(
          (m): m is SpeechModelOption =>
            isValidTtsEnginePref(m.id) && m.id !== 'auto' && m.id !== 'android_tts'
        );
        if (validModels.length > 0) {
          state.ttsModels = validModels;
        }
      }

      if (state.ttsEnginePref === 'android_tts') {
        state.ttsBackend = 'android_tts';
      } else if (state.ttsEnginePref === 'auto') {
        const firstInstalledSpeech = state.ttsModels.find((m) => m.installed);
        state.ttsBackend = p.phononInstalled
          ? 'phonon_31m'
          : firstInstalledSpeech
          ? firstInstalledSpeech.id
          : 'android_tts';
      } else {
        const chosenModel = state.ttsModels.find((m) => m.id === state.ttsEnginePref);
        if (state.ttsEnginePref === 'phonon_31m') {
          state.ttsBackend = p.phononInstalled ? 'phonon_31m' : 'android_tts';
        } else {
          state.ttsBackend = chosenModel?.installed ? chosenModel.id : 'android_tts';
        }
      }

      if (p.phononInstalled && !p.phononDownloading) {
        state.phononDownload.status = 'ready';
        state.phononDownload.percent = 100;
        state.phononDownload.error = null;
      } else if (!p.phononInstalled && !p.phononDownloading && state.phononDownload.status === 'ready') {
        state.phononDownload.status = 'idle';
        state.phononDownload.percent = 0;
        state.phononDownload.downloadedBytes = 0;
      }
    },
    setPhononDownloadProgress(
      state,
      action: PayloadAction<{
        status: PhononDownloadStatus;
        percent: number;
        downloadedBytes: number;
        totalBytes: number;
        currentFile?: string | null;
        error?: string | null;
      }>
    ) {
      const p = action.payload;
      const normalizedStatus: PhononDownloadStatus = p.status === 'completed' ? 'ready' : p.status;
      state.phononDownloading = normalizedStatus === 'downloading' || normalizedStatus === 'extracting';
      state.phononDownload = {
        status: normalizedStatus,
        percent: p.percent,
        downloadedBytes: p.downloadedBytes,
        totalBytes: p.totalBytes > 0 ? p.totalBytes : state.phononExpectedBytes,
        currentFile: p.currentFile ?? null,
        error: p.error ?? null,
      };
      if (normalizedStatus === 'ready') {
        state.phononInstalled = true;
        state.phononDownloading = false;
        if (state.ttsEnginePref !== 'android_tts') {
          state.ttsBackend = 'phonon_31m';
        }
      }
    },
    setSpeechModelDownloadProgress(
      state,
      action: PayloadAction<{
        modelId: string;
        status: PhononDownloadStatus;
        percent: number;
        downloadedBytes: number;
        totalBytes: number;
        error?: string | null;
      }>
    ) {
      const p = action.payload;
      const normalizedStatus: PhononDownloadStatus = p.status === 'completed' ? 'ready' : p.status;
      const active = normalizedStatus === 'downloading' || normalizedStatus === 'extracting';
      state.speechDownloads[p.modelId] = {
        modelId: p.modelId,
        status: normalizedStatus,
        percent: p.percent,
        downloadedBytes: p.downloadedBytes,
        totalBytes: p.totalBytes,
        error: p.error ?? null,
      };
      const target = state.ttsModels.find((m) => m.id === p.modelId);
      if (target) {
        target.downloading = active;
        target.percent = p.percent;
        if (normalizedStatus === 'ready') {
          target.installed = true;
          target.installedBytes = p.totalBytes > 0 ? p.totalBytes : target.estimatedBytes;
          if (state.ttsEnginePref === p.modelId || state.ttsEnginePref === 'auto') {
            state.ttsBackend = target.id;
          }
        } else if (normalizedStatus === 'idle' && p.downloadedBytes === 0) {
          target.installed = false;
          target.installedBytes = 0;
        }
      }
    },
  },
});

export const {
  openLiveTalkModal,
  closeLiveTalkModal,
  setSessionStarting,
  sessionStarted,
  setSessionState,
  setMicMuted,
  setPreferredRoute,
  updateRouteOrFocus,
  setVadSpeechActive,
  applyTranscriptDelta,
  commitLiveTurn,
  seedModalTurns,
  setLiveTalkError,
  setLiveLanguage,
  setTtsPreference,
  applyTtsCapabilities,
  setPhononDownloadProgress,
  setSpeechModelDownloadProgress,
} = liveTalkSlice.actions;

export default liveTalkSlice.reducer;
