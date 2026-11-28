import reducer, {completeExecution, resetAgent, setTaskStatus, startExecution, updateStep} from '../agentSlice';
import type {AgentResult, AgentStep} from '../../../agents/types';

const running = reducer(undefined, startExecution({taskId: 'current', instruction: 'Open settings', agentId: 'agent'}));
const result: AgentResult = {success: false, cancelled: true, steps: [], summary: 'Cancelled', startTime: 1, endTime: 2};
const step: AgentStep = {stepIndex: 0, observation: null, reasoning: '', action: null, timestamp: 1, status: 'thinking'};

it('ignores steps and completion from a previous task', () => {
  expect(reducer(running, updateStep({taskId: 'old', step}))).toEqual(running);
  expect(reducer(running, completeExecution({taskId: 'old', result}))).toEqual(running);
});

it('preserves active execution when the screen requests a reset', () => {
  expect(reducer(running, resetAgent())).toEqual(running);
});

it('keeps cancellation terminal despite a delayed native status event', () => {
  const cancelled = reducer(running, completeExecution({taskId: 'current', result}));
  expect(cancelled.executionStatus).toBe('cancelled');
  expect(reducer(cancelled, setTaskStatus({taskId: 'current', status: 'running'}))).toEqual(cancelled);
});
