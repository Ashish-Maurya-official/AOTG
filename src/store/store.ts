import { configureStore } from '@reduxjs/toolkit';
import themeReducer from './slices/themeSlice';
import llmReducer from './slices/llmSlice';

export const store = configureStore({
  reducer: {
    theme: themeReducer,
    llm: llmReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
