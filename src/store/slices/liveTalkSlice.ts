import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type LiveTalkState =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'SPEAKING'
  | 'INTERRUPTED';

export type LiveInputMode = 'audio_bytes' | 'os_asr';
export type LiveVadBackend = 'silero_onnx' | 'dsp_fallback';
export type LiveOutputRoute = 'auto' | 'speaker' | 'earpiece' | 'bluetooth' | 'wired';
export type LiveTtsEnginePref = 'auto' | 'phonon_31m' | 'android_tts';
export type LiveTtsBackend = 'phonon_31m' | 'android_tts';
export type LiveLanguage = 'auto' | 'en' | 'hi';
export type PhononDownloadStatus = 'idle' | 'downloading' | 'ready' | 'cancelled' | 'error';

export interface PhononVoiceOption {
  id: string;
  label: string;
  description: string;
  downloaded: boolean;
}

export interface PhononDownloadState {
  status: PhononDownloadStatus;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  currentFile: string | null;
  error: string | null;
}

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
        state.ttsEnginePref = action.payload.ttsEnginePref;
        if (action.payload.ttsEnginePref === 'android_tts') {
          state.ttsBackend = 'android_tts';
        } else if (state.phononInstalled) {
          state.ttsBackend = 'phonon_31m';
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
      if (
        p.selectedTtsEngine === 'auto' ||
        p.selectedTtsEngine === 'phonon_31m' ||
        p.selectedTtsEngine === 'android_tts'
      ) {
        state.ttsEnginePref = p.selectedTtsEngine;
      }
      if (p.selectedVoiceId) {
        state.selectedVoiceId = p.selectedVoiceId;
      }
      if (p.availableVoices && p.availableVoices.length > 0) {
        state.availableVoices = p.availableVoices;
      }
      state.ttsBackend =
        p.phononInstalled && state.ttsEnginePref !== 'android_tts'
          ? 'phonon_31m'
          : 'android_tts';
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
      state.phononDownloading = p.status === 'downloading';
      state.phononDownload = {
        status: p.status,
        percent: p.percent,
        downloadedBytes: p.downloadedBytes,
        totalBytes: p.totalBytes > 0 ? p.totalBytes : state.phononExpectedBytes,
        currentFile: p.currentFile ?? null,
        error: p.error ?? null,
      };
      if (p.status === 'ready') {
        state.phononInstalled = true;
        state.phononDownloading = false;
        if (state.ttsEnginePref !== 'android_tts') {
          state.ttsBackend = 'phonon_31m';
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
} = liveTalkSlice.actions;

export default liveTalkSlice.reducer;
