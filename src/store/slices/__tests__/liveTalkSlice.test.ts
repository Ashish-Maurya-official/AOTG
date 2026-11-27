jest.mock('@reduxjs/toolkit', () => ({
  createSlice: jest.fn(({ name, initialState, reducers }) => {
    const actions: Record<string, (payload?: any) => any> = {};
    for (const key of Object.keys(reducers)) {
      actions[key] = (payload?: any) => ({ type: `${name}/${key}`, payload });
    }
    const reducer = (
      state = JSON.parse(JSON.stringify(initialState)),
      action: any
    ) => {
      const next = JSON.parse(JSON.stringify(state));
      const key = action?.type?.startsWith(`${name}/`)
        ? action.type.slice(name.length + 1)
        : '';
      const fn = key ? reducers[key] : undefined;
      if (fn) {
        const res = fn(next, action);
        return res !== undefined ? res : next;
      }
      return next;
    };
    return { name, initialState, actions, reducer };
  }),
}));

import reducer, {
  applyTranscriptDelta,
  applyTtsCapabilities,
  closeLiveTalkModal,
  commitLiveTurn,
  DEFAULT_PHONON_VOICES,
  openLiveTalkModal,
  seedModalTurns,
  sessionStarted,
  setLiveTalkError,
  setMicMuted,
  setPhononDownloadProgress,
  setPreferredRoute,
  setSessionStarting,
  setSessionState,
  setTtsPreference,
  setVadSpeechActive,
  updateRouteOrFocus,
} from '../liveTalkSlice';

describe('liveTalkSlice', () => {
  it('transitions cleanly through session lifecycle states', () => {
    let state = reducer(undefined, openLiveTalkModal());
    expect(state.isVisible).toBe(true);
    expect(state.sessionState).toBe('IDLE');

    state = reducer(state, setSessionStarting(true));
    expect(state.isStarting).toBe(true);

    state = reducer(
      state,
      sessionStarted({
        inputMode: 'audio_bytes',
        vadBackend: 'silero_onnx',
        activeRoute: 'bluetooth',
        aecEnabled: true,
      })
    );
    expect(state.isStarting).toBe(false);
    expect(state.sessionState).toBe('LISTENING');
    expect(state.inputMode).toBe('audio_bytes');
    expect(state.vadBackend).toBe('silero_onnx');
    expect(state.activeRoute).toBe('bluetooth');
    expect(state.aecEnabled).toBe(true);

    state = reducer(state, setVadSpeechActive(true));
    expect(state.vadSpeechActive).toBe(true);

    state = reducer(state, setSessionState('THINKING'));
    expect(state.sessionState).toBe('THINKING');

    state = reducer(state, setSessionState('SPEAKING'));
    expect(state.sessionState).toBe('SPEAKING');

    state = reducer(state, setSessionState('LISTENING'));
    expect(state.sessionState).toBe('LISTENING');
    expect(state.vadSpeechActive).toBe(false);
  });

  it('tracks streaming transcript deltas and resets captions on turn commit', () => {
    let state = reducer(undefined, openLiveTalkModal());
    state = reducer(
      state,
      applyTranscriptDelta({
        turnId: 't1',
        role: 'user',
        fullText: 'Voice message',
        isFinal: true,
      })
    );
    expect(state.userTranscript).toBe('Voice message');
    expect(state.assistantTranscript).toBe('');

    state = reducer(
      state,
      applyTranscriptDelta({
        turnId: 't1',
        role: 'assistant',
        fullText: 'Hello, how can I help?',
        isFinal: true,
      })
    );
    expect(state.assistantTranscript).toBe('Hello, how can I help?');

    state = reducer(
      state,
      commitLiveTurn({
        turnId: 't1',
        userText: 'Voice message',
        assistantText: 'Hello... (interrupted)',
        wasInterrupted: true,
      })
    );
    expect(state.turns).toHaveLength(2);
    expect(state.turns[1].wasInterrupted).toBe(true);
    expect(state.userTranscript).toBe('');
    expect(state.assistantTranscript).toBe('');
    expect(state.activeTurnId).toBeNull();
  });

  it('caps caption history at 24 items and resets cleanly on close', () => {
    const initialTurns = Array.from({ length: 24 }, (_, idx) => ({
      id: `seed_${idx}`,
      role: (idx % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `msg ${idx}`,
      isFinal: true,
    }));
    let state = reducer(undefined, seedModalTurns(initialTurns));
    expect(state.turns).toHaveLength(24);

    state = reducer(
      state,
      commitLiveTurn({
        turnId: 'new_t',
        userText: 'latest q',
        assistantText: 'latest a',
        wasInterrupted: false,
      })
    );
    expect(state.turns).toHaveLength(24);
    expect(state.turns[0].id).toBe('seed_2');
    expect(state.turns[23].text).toBe('latest a');

    state = reducer(state, setMicMuted(true));
    state = reducer(state, setPreferredRoute('earpiece'));
    state = reducer(state, updateRouteOrFocus({ route: 'earpiece', aecEnabled: false }));
    state = reducer(state, setLiveTalkError('Focus lost'));
    expect(state.error).toBe('Focus lost');

    state = reducer(state, closeLiveTalkModal());
    expect(state.isVisible).toBe(false);
    expect(state.sessionState).toBe('IDLE');
    expect(state.isMuted).toBe(false);
    expect(state.error).toBeNull();
  });

  it('tracks Phonon-31M download progress, voice selection, and preserves install state on close', () => {
    let state = reducer(undefined, openLiveTalkModal());
    expect(state.phononInstalled).toBe(false);
    expect(state.selectedVoiceId).toBe('easton');
    expect(state.availableVoices).toHaveLength(DEFAULT_PHONON_VOICES.length);

    state = reducer(
      state,
      setPhononDownloadProgress({
        status: 'downloading',
        percent: 42,
        downloadedBytes: 28_000_000,
        totalBytes: 68_565_296,
        currentFile: 'onnx/mimi_decoder.onnx',
      })
    );
    expect(state.phononDownloading).toBe(true);
    expect(state.phononDownload.percent).toBe(42);
    expect(state.phononInstalled).toBe(false);

    state = reducer(
      state,
      setPhononDownloadProgress({
        status: 'ready',
        percent: 100,
        downloadedBytes: 68_565_296,
        totalBytes: 68_565_296,
      })
    );
    expect(state.phononDownloading).toBe(false);
    expect(state.phononInstalled).toBe(true);
    expect(state.ttsBackend).toBe('phonon_31m');

    state = reducer(
      state,
      setTtsPreference({ ttsEnginePref: 'phonon_31m', selectedVoiceId: 'juniper' })
    );
    expect(state.selectedVoiceId).toBe('juniper');

    state = reducer(
      state,
      applyTtsCapabilities({
        phononInstalled: true,
        phononDownloading: false,
        phononExpectedBytes: 68_565_296,
        phononDiskBytes: 68_821_296,
        phononVariant: 'q4',
        selectedTtsEngine: 'android_tts',
        selectedVoiceId: 'zoey',
      })
    );
    expect(state.ttsEnginePref).toBe('android_tts');
    expect(state.ttsBackend).toBe('android_tts');
    expect(state.selectedVoiceId).toBe('zoey');

    state = reducer(
      state,
      sessionStarted({
        inputMode: 'audio_bytes',
        vadBackend: 'silero_onnx',
        activeRoute: 'speaker',
        aecEnabled: true,
        ttsBackend: 'phonon_31m',
        voiceId: 'harper',
      })
    );
    expect(state.ttsBackend).toBe('phonon_31m');
    expect(state.selectedVoiceId).toBe('harper');

    state = reducer(state, closeLiveTalkModal());
    expect(state.phononInstalled).toBe(true);
    expect(state.selectedVoiceId).toBe('harper');
  });
});
