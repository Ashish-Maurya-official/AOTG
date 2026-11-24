import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@reduxjs/toolkit', () => ({
    createSlice: jest.fn(({ name, initialState, reducers }) => ({
        name,
        initialState,
        actions: {
            setTheme: (payload: any) => ({ type: `${name}/setTheme`, payload }),
            toggleTheme: (payload?: any) => ({ type: `${name}/toggleTheme`, payload }),
        },
        reducer: (state = initialState, action: any) => {
            if (action.type === `${name}/setTheme`) {
                const handler = typeof reducers.setTheme === 'function' ? reducers.setTheme : reducers.setTheme.reducer;
                handler(state, action);
            } else if (action.type === `${name}/toggleTheme`) {
                const handler = typeof reducers.toggleTheme === 'function' ? reducers.toggleTheme : reducers.toggleTheme.reducer;
                handler(state, action);
            }
            return state;
        },
    })),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(),
    setItem: jest.fn(),
}));

import themeReducer, {
    setTheme,
    toggleTheme,
    loadPersistedTheme,
    THEME_STORAGE_KEY,
} from '../themeSlice';

describe('themeSlice', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('sets theme mode and triggers persistence', () => {
        const state = themeReducer({ themeMode: 'system' }, setTheme('dark'));
        expect(state.themeMode).toBe('dark');
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark');
    });

    it('toggles theme mode from light to dark and triggers persistence', () => {
        const state = themeReducer({ themeMode: 'light' }, toggleTheme());
        expect(state.themeMode).toBe('dark');
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark');
    });

    it('toggles theme mode from dark to light and triggers persistence', () => {
        const state = themeReducer({ themeMode: 'dark' }, toggleTheme());
        expect(state.themeMode).toBe('light');
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'light');
    });

    it('toggles theme with explicit target mode and triggers persistence', () => {
        const state = themeReducer({ themeMode: 'system' }, toggleTheme('dark'));
        expect(state.themeMode).toBe('dark');
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark');
    });

    it('loads persisted theme mode when valid', async () => {
        (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('dark');
        const mode = await loadPersistedTheme();
        expect(mode).toBe('dark');
    });

    it('returns null when persisted theme is absent or corrupted', async () => {
        (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);
        const mode = await loadPersistedTheme();
        expect(mode).toBeNull();
    });
});
