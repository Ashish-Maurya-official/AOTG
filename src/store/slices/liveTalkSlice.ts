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
}

const MAX_DISPLAY_TURNS = 24;

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
      }>
    ) {
      state.isStarting = false;
      state.sessionState = 'LISTENING';
      state.isMuted = false;
      state.inputMode = action.payload.inputMode;
      state.vadBackend = action.payload.vadBackend;
      state.activeRoute = action.payload.activeRoute;
      state.aecEnabled = action.payload.aecEnabled;
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
} = liveTalkSlice.actions;

export default liveTalkSlice.reducer;
