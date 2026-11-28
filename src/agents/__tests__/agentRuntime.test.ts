import {AgentRuntime} from '../agentRuntime';
import {DEFAULT_AGENT_CONFIG} from '../types';
import type {AgentResult, AgentServiceState, AgentTask} from '../types';
import AccessibilityService from '../../services/accessibilityService';
import LLMService from '../../services/llmService';
import {loadAgentTasks, saveAgentTask} from '../../services/agentTaskStorageService';
import agentOrchestrator from '../agentOrchestrator';
import {store} from '../../store/store';

jest.mock('../../services/accessibilityService', () => ({
  getAgentServiceState: jest.fn(), startAgentService: jest.fn(),
  stopAgentService: jest.fn(), cancelAgentTask: jest.fn(), onAgentControl: jest.fn(),
}));
jest.mock('../../services/llmService', () => ({
  claimAgentSession: jest.fn(), releaseAgentSession: jest.fn(),
}));
jest.mock('../../services/agentTaskStorageService', () => ({
  loadAgentTasks: jest.fn(), saveAgentTask: jest.fn(),
  isActiveTask: jest.requireActual('../../services/agentTaskStorageService').isActiveTask,
}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('../agentOrchestrator', () => ({
  routeInstruction: jest.fn(), execute: jest.fn(), cancel: jest.fn(),
}));
jest.mock('../../store/store', () => {
  const {configureStore} = jest.requireActual('@reduxjs/toolkit');
  const reducer = jest.requireActual('../../store/slices/agentSlice').default;
  return {store: configureStore({reducer: {agent: reducer}})};
});

const accessibility = jest.mocked(AccessibilityService);
const llm = jest.mocked(LLMService);
const orchestrator = jest.mocked(agentOrchestrator);
const load = jest.mocked(loadAgentTasks);
const save = jest.mocked(saveAgentTask);
const result: AgentResult = {success: true, steps: [], summary: 'Finished', startTime: 1, endTime: 2};
let saved: AgentTask[];
let native: AgentServiceState;
let control: ((state: AgentServiceState) => void) | undefined;
let remove: jest.Mock;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return {promise, resolve};
}

beforeEach(() => {
  jest.resetAllMocks();
  saved = [];
  native = {taskId: null, paused: false, cancelled: false, reason: '', screenEpoch: 0};
  control = undefined;
  remove = jest.fn(() => { control = undefined; });
  load.mockImplementation(async () => JSON.parse(JSON.stringify(saved)));
  save.mockImplementation(async task => {
    saved = [JSON.parse(JSON.stringify(task)), ...saved.filter(item => item.id !== task.id)];
  });
  accessibility.getAgentServiceState.mockImplementation(async () => ({...native}));
  accessibility.startAgentService.mockImplementation(async taskId => {
    native.taskId = taskId;
    return true;
  });
  accessibility.stopAgentService.mockResolvedValue(true);
  accessibility.cancelAgentTask.mockImplementation(async taskId => {
    if (native.taskId === taskId) {
      native.cancelled = true;
      native.reason = 'cancelled';
      control?.({...native});
    }
    return true;
  });
  accessibility.onAgentControl.mockImplementation(callback => {
    control = callback;
    return {remove};
  });
  llm.claimAgentSession.mockResolvedValue(true);
  llm.releaseAgentSession.mockResolvedValue(true);
  orchestrator.routeInstruction.mockReturnValue({id: 'accessibility-agent'} as never);
  orchestrator.execute.mockResolvedValue(result);
});

it('persists before native startup and executes only from the headless entry point', async () => {
  const runtime = new AgentRuntime();
  accessibility.startAgentService.mockImplementation(async taskId => {
    expect(saved[0]).toMatchObject({id: taskId, status: 'starting'});
    native.taskId = taskId;
    return true;
  });
  const id = await runtime.start(' Open settings ', 'local-model');
  expect(orchestrator.execute).not.toHaveBeenCalled();
  await runtime.run(id);
  expect(orchestrator.execute).toHaveBeenCalledWith('Open settings', expect.any(Function),
    {...DEFAULT_AGENT_CONFIG, taskId: id}, 'accessibility-agent');
  expect(saved[0].status).toBe('completed');
  expect(store.getState().agent.executionStatus).toBe('completed');
  expect(llm.releaseAgentSession).toHaveBeenCalledWith(id);
  expect(accessibility.stopAgentService).toHaveBeenCalledWith(id);
  expect(remove).toHaveBeenCalledTimes(1);
});

it('rejects duplicate submissions while startup is awaiting storage', async () => {
  const gate = deferred<AgentTask[]>();
  load.mockReturnValueOnce(gate.promise);
  const runtime = new AgentRuntime();
  const first = runtime.start('first', 'model');
  await expect(runtime.start('second', 'model')).rejects.toThrow('already running');
  gate.resolve([]);
  const id = await first;
  await runtime.run(id);
  expect(accessibility.startAgentService).toHaveBeenCalledTimes(1);
});

it('does not launch or leave the app when foreground startup is rejected', async () => {
  accessibility.startAgentService.mockRejectedValueOnce(new Error('Foreground start denied'));
  const runtime = new AgentRuntime();
  await expect(runtime.start('Open settings', 'model')).rejects.toThrow('Foreground start denied');
  expect(saved[0].status).toBe('failed');
  expect(orchestrator.execute).not.toHaveBeenCalled();
  expect(llm.releaseAgentSession).toHaveBeenCalledWith(saved[0].id);
  const id = await runtime.start('Try again', 'model');
  await runtime.run(id);
  expect(saved[0].status).toBe('completed');
});

it('honors cancellation while model ownership is still being acquired', async () => {
  const claim = deferred<boolean>();
  const entered = deferred<void>();
  llm.claimAgentSession.mockImplementationOnce(() => {
    entered.resolve();
    return claim.promise;
  });
  const runtime = new AgentRuntime();
  const start = runtime.start('Open settings', 'model');
  const failure = start.catch(error => error);
  await entered.promise;
  await runtime.cancel(saved[0].id);
  claim.resolve(true);
  expect(await failure).toEqual(new Error('Task cancelled before startup'));
  expect(saved[0].status).toBe('cancelled');
  expect(accessibility.startAgentService).not.toHaveBeenCalled();
  expect(llm.releaseAgentSession).toHaveBeenCalledWith(saved[0].id);
});

it('does not overwrite a cancellation with a late successful result', async () => {
  const execution = deferred<AgentResult>();
  const entered = deferred<void>();
  orchestrator.execute.mockImplementationOnce(() => {
    entered.resolve();
    return execution.promise;
  });
  const runtime = new AgentRuntime();
  const id = await runtime.start('Open settings', 'model');
  const run = runtime.run(id);
  await entered.promise;
  await runtime.run(id); // Duplicate headless delivery.
  await runtime.cancel(id);
  execution.resolve(result);
  await run;
  expect(orchestrator.execute).toHaveBeenCalledTimes(1);
  expect(saved[0].status).toBe('cancelled');
  expect(store.getState().agent.executionStatus).toBe('cancelled');
});

it('records a native deadline as failed instead of user cancellation', async () => {
  orchestrator.execute.mockImplementationOnce(async () => {
    native = {...native, cancelled: true, reason: 'timeout'};
    control?.({...native});
    return {...result, success: false, cancelled: true};
  });
  const runtime = new AgentRuntime();
  await runtime.run(await runtime.start('Open settings', 'model'));
  expect(saved[0]).toMatchObject({status: 'failed', result: {cancelled: false, error: 'Task timeout'}});
});

it('restores interrupted history without replaying side effects', async () => {
  const oldRuntime = new AgentRuntime();
  const id = await oldRuntime.start('Open settings', 'model');
  native.taskId = null; // Android killed the process; memory reservations are gone.
  await new AgentRuntime().restore();
  expect(saved[0]).toMatchObject({id, status: 'interrupted'});
  expect(store.getState().agent.executionStatus).toBe('interrupted');
  expect(orchestrator.execute).not.toHaveBeenCalled();
  expect(accessibility.startAgentService).toHaveBeenCalledTimes(1);
});

it('records a deadline reached before headless delivery without executing the task', async () => {
  const runtime = new AgentRuntime();
  const id = await runtime.start('Open settings', 'model');
  native = {...native, cancelled: true, reason: 'timeout'};
  await runtime.run(id);
  expect(saved[0]).toMatchObject({status: 'failed', result: {cancelled: false, error: 'Task timeout'}});
  expect(orchestrator.execute).not.toHaveBeenCalled();
});

it('refuses to reserve the model if the initial durable write fails', async () => {
  save.mockRejectedValueOnce(new Error('Storage full'));
  await expect(new AgentRuntime().start('Open settings', 'model')).rejects.toThrow('Storage full');
  expect(llm.claimAgentSession).not.toHaveBeenCalled();
  expect(accessibility.startAgentService).not.toHaveBeenCalled();
});
