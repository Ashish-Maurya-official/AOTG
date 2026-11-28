import {createSlice, PayloadAction} from '@reduxjs/toolkit';
import type {
  AgentStep,
  AgentResult,
  AgentExecutionStatus,
  AgentTask,
} from '../../agents/types';

interface AgentState {
  taskId: string | null;
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
  taskId: null,
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
    restoreTask: (state, action: PayloadAction<AgentTask>) => {
      const task = action.payload;
      state.taskId = task.id;
      state.executionStatus = task.status;
      state.currentInstruction = task.instruction;
      state.currentAgentId = task.agentId;
      state.steps = task.steps;
      state.lastResult = task.result;
      state.error = task.result?.error || null;
    },

    setTaskStatus: (
      state,
      action: PayloadAction<{taskId: string; status: AgentExecutionStatus}>,
    ) => {
      if (state.taskId === action.payload.taskId &&
          ['starting', 'running', 'paused', 'cancelling'].includes(state.executionStatus)) {
        state.executionStatus = action.payload.status;
      }
    },
    setServiceEnabled: (state, action: PayloadAction<boolean>) => {
      state.isServiceEnabled = action.payload;
    },

    startExecution: (
      state,
      action: PayloadAction<{instruction: string; agentId: string; taskId: string}>,
    ) => {
      state.taskId = action.payload.taskId;
      state.executionStatus = 'running';
      state.currentInstruction = action.payload.instruction;
      state.currentAgentId = action.payload.agentId;
      state.steps = [];
      state.lastResult = null;
      state.error = null;
    },

    updateStep: (state, action: PayloadAction<{taskId: string; step: AgentStep}>) => {
      if (state.taskId !== action.payload.taskId) return;
      const step = action.payload.step;
      const existingIndex = state.steps.findIndex(
        s => s.stepIndex === step.stepIndex,
      );
      if (existingIndex >= 0) {
        state.steps[existingIndex] = step;
      } else {
        state.steps.push(step);
      }
    },

    completeExecution: (state, action: PayloadAction<{taskId: string; result: AgentResult}>) => {
      if (state.taskId !== action.payload.taskId) return;
      const result = action.payload.result;
      state.executionStatus = result.cancelled ? 'cancelled' : result.success ? 'completed' : 'failed';
      state.lastResult = result;
      state.error = result.error || null;
    },

    cancelExecution: state => {
      state.executionStatus = 'cancelled';
    },

    resetAgent: state => {
      if (['starting', 'running', 'paused', 'cancelling'].includes(state.executionStatus)) return;
      state.taskId = null;
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
  restoreTask,
  setTaskStatus,
  setServiceEnabled,
  startExecution,
  updateStep,
  completeExecution,
  cancelExecution,
  resetAgent,
} = agentSlice.actions;

export default agentSlice.reducer;
