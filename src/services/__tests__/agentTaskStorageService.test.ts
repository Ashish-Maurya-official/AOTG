import AsyncStorage from '@react-native-async-storage/async-storage';
import {loadAgentTasks, saveAgentTask} from '../agentTaskStorageService';
import {DEFAULT_AGENT_CONFIG} from '../../agents/types';
import type {AgentStep, AgentTask} from '../../agents/types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(),
}));

const storage = jest.mocked(AsyncStorage);
let persisted: string | null;
const task: AgentTask = {
  id: 'task-1', instruction: 'Open settings', agentId: 'accessibility-agent', modelId: 'model',
  config: {...DEFAULT_AGENT_CONFIG, taskId: 'task-1'}, status: 'running',
  createdAt: 1, updatedAt: 2, steps: [], result: null,
};

beforeEach(() => {
  jest.resetAllMocks();
  persisted = null;
  storage.getItem.mockImplementation(async () => persisted);
  storage.setItem.mockImplementation(async (_key, value) => { persisted = value; });
});

it('serializes overlapping checkpoints without losing another task', async () => {
  await Promise.all([
    saveAgentTask(task),
    saveAgentTask({...task, id: 'task-2', updatedAt: 3}),
    saveAgentTask({...task, status: 'completed', updatedAt: 4}),
  ]);
  expect(await loadAgentTasks()).toEqual([
    {...task, status: 'completed', updatedAt: 4}, {...task, id: 'task-2', updatedAt: 3},
  ]);
});

it('omits captured screen content and streamed model output from persisted steps', async () => {
  const step: AgentStep = {
    stepIndex: 0, timestamp: 1, status: 'completed', reasoning: '', action: {type: 'home'},
    rawThinking: 'model output', observation: {
      app: 'settings', timestamp: 1, totalNodes: 0, elements: [], screenshotBase64: 'private-screen',
    },
  };
  await saveAgentTask({...task, steps: [step], result: {
    success: true, steps: [step], summary: 'Done', startTime: 1, endTime: 2,
  }});
  expect(persisted).not.toContain('private-screen');
  expect(persisted).not.toContain('model output');
  expect((await loadAgentTasks())[0].steps[0].observation).toBeNull();
  expect(step.observation?.screenshotBase64).toBe('private-screen');
});

it('reports write failure and allows a later checkpoint to succeed', async () => {
  storage.setItem.mockRejectedValueOnce(new Error('Disk full'));
  await expect(saveAgentTask(task)).rejects.toThrow('Disk full');
  await saveAgentTask({...task, status: 'failed'});
  expect((await loadAgentTasks())[0].status).toBe('failed');
});

it('does not silently replace corrupt history', async () => {
  persisted = '{broken';
  await expect(loadAgentTasks()).rejects.toThrow();
  await expect(saveAgentTask(task)).rejects.toThrow();
  expect(storage.setItem).not.toHaveBeenCalled();
});
