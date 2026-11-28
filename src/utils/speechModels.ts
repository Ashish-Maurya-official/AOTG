export type SpeechModelId =
  | 'phonon_31m'
  | 'mms_tts_hin'
  | 'indic_tiny_hi'
  | 'piper_hi'
  | 'kokoro_multi'
  | 'piper_en'
  | 'kitten_en'
  | 'pocket_tts';

export type LiveTtsEnginePref = 'auto' | SpeechModelId | 'android_tts';

export const SPEECH_MODEL_IDS: SpeechModelId[] = [
  'phonon_31m',
  'mms_tts_hin',
  'indic_tiny_hi',
  'piper_hi',
  'kokoro_multi',
  'piper_en',
  'kitten_en',
  'pocket_tts',
];

export function isValidTtsEnginePref(raw: unknown): raw is LiveTtsEnginePref {
  if (raw === 'auto' || raw === 'android_tts') return true;
  return typeof raw === 'string' && SPEECH_MODEL_IDS.includes(raw as SpeechModelId);
}
