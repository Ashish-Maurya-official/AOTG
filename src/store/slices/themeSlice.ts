import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const THEME_STORAGE_KEY = '@aotg/theme_mode';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface ThemeState {
  themeMode: ThemeMode;
}

const initialState: ThemeState = {
  themeMode: 'system',
};

/**
 * Load persisted theme mode from AsyncStorage.
 */
export async function loadPersistedTheme(): Promise<ThemeMode | null> {
  try {
    const raw = await AsyncStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist theme mode preference to AsyncStorage.
 */
export async function savePersistedTheme(mode: ThemeMode): Promise<void> {
  try {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {}
}

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    setTheme: (state, action: PayloadAction<ThemeMode>) => {
      state.themeMode = action.payload;
      savePersistedTheme(action.payload);
    },

    toggleTheme: {
      reducer: (state, action: PayloadAction<ThemeMode | undefined>) => {
        let newMode: ThemeMode;
        if (action.payload) {
          newMode = action.payload;
        } else {
          newMode = state.themeMode === 'light' ? 'dark' : 'light';
        }
        state.themeMode = newMode;
        savePersistedTheme(newMode);
      },
      prepare: (targetMode?: ThemeMode) => ({ payload: targetMode }),
    },
  },
});

export const { setTheme, toggleTheme } = themeSlice.actions;

export default themeSlice.reducer;
