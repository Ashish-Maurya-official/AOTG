import {createSlice, PayloadAction} from '@reduxjs/toolkit';
import type {
  AgentStep,
  AgentResult,
  AgentExecutionStatus,
} from '../../agents/types';

interface AgentState {
  /** Whether the accessibility service is enabled in system settings */
  isServiceEnabled: boolean;
  /** Current execution status */
  executionStatus: AgentExecutionStatus;
  /** The instruction currently being executed */
  currentInstruction: string | null;
  /** ID of the agent handling the current instruction */
  currentAgentId: string | null;
  /** Steps from the current/last execution */
  steps: AgentStep[];
  /** Result of the last completed execution */
  lastResult: AgentResult | null;
  /** Current error message, if any */
  error: string | null;
}

const initialState: AgentState = {
  isServiceEnabled: false,
  executionStatus: 'idle',
  currentInstruction: null,
  currentAgentId: null,
  steps: [],
  lastResult: null,
  error: null,
};

const agentSlice = createSlice({
  name: 'agent',
  initialState,
  reducers: {
    setServiceEnabled: (state, action: PayloadAction<boolean>) => {
      state.isServiceEnabled = action.payload;
    },

    startExecution: (
      state,
      action: PayloadAction<{instruction: string; agentId: string}>,
    ) => {
      state.executionStatus = 'running';
      state.currentInstruction = action.payload.instruction;
      state.currentAgentId = action.payload.agentId;
      state.steps = [];
      state.lastResult = null;
      state.error = null;
    },

    updateStep: (state, action: PayloadAction<AgentStep>) => {
      const step = action.payload;
      const existingIndex = state.steps.findIndex(
        s => s.stepIndex === step.stepIndex,
      );
      if (existingIndex >= 0) {
        state.steps[existingIndex] = step;
      } else {
        state.steps.push(step);
      }
    },

    completeExecution: (state, action: PayloadAction<AgentResult>) => {
      state.executionStatus = action.payload.success ? 'completed' : 'failed';
      state.lastResult = action.payload;
      state.error = action.payload.error || null;
    },

    cancelExecution: state => {
      state.executionStatus = 'cancelled';
    },

    resetAgent: state => {
      state.executionStatus = 'idle';
      state.currentInstruction = null;
      state.currentAgentId = null;
      state.steps = [];
      state.lastResult = null;
      state.error = null;
    },
  },
});

export const {
  setServiceEnabled,
  startExecution,
  updateStep,
  completeExecution,
  cancelExecution,
  resetAgent,
} = agentSlice.actions;

export default agentSlice.reducer;
