import { configureStore } from '@reduxjs/toolkit';
import themeReducer from './slices/themeSlice';
import llmReducer from './slices/llmSlice';
import agentReducer from './slices/agentSlice';

export const store = configureStore({
  reducer: {
    theme: themeReducer,
    llm: llmReducer,
    agent: agentReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

