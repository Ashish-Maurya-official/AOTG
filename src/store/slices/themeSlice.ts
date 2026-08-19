import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  themeMode: 'system',
};

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    setTheme: (state, action) => {
      state.themeMode = action.payload;
    },

    toggleTheme: (state) => {
      state.themeMode =
        state.themeMode === 'light' ? 'dark' : 'light';
    },
  },
});

export const { setTheme, toggleTheme } = themeSlice.actions;

export default themeSlice.reducer;
