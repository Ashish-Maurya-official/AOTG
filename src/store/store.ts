import { configureStore } from '@reduxjs/toolkit';
import themeReducer from './slices/themeSlice';
import llmReducer from './slices/llmSlice';
import agentReducer from './slices/agentSlice';
import liveTalkReducer from './slices/liveTalkSlice';

export const store = configureStore({
  reducer: {
    theme: themeReducer,
    llm: llmReducer,
    agent: agentReducer,
    liveTalk: liveTalkReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

