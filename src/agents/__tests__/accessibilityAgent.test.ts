import {AccessibilityAgent} from '../accessibilityAgent';
import {DEFAULT_AGENT_CONFIG} from '../types';
import type {AgentServiceState, AgentStep, ScreenObservation} from '../types';
import AccessibilityService from '../../services/accessibilityService';
import LLMService from '../../services/llmService';

jest.mock('../../services/accessibilityService', () => ({
  getAgentServiceState: jest.fn(), isServiceEnabled: jest.fn(),
  observeScreen: jest.fn(), executeAgentAction: jest.fn(), takeScreenshotToFile: jest.fn(),
}));
jest.mock('../../services/llmService', () => ({
  __esModule: true,
  default: {
    isModelLoaded: jest.fn(), generate: jest.fn(), generateWithVision: jest.fn(),
    stopGeneration: jest.fn(), resetConversation: jest.fn(), getRemainingContextTokens: jest.fn(),
  },
  estimateTokens: (text: string) => Math.ceil(text.length / 3.2),
}));

const accessibility = jest.mocked(AccessibilityService);
const llm = jest.mocked(LLMService);
const config = {...DEFAULT_AGENT_CONFIG, taskId: 'task-1', maxSteps: 6, stepDelayMs: 0};
const screen: ScreenObservation = {
  app: 'com.android.settings', windowId: 1, screenEpoch: 0, timestamp: 1, totalNodes: 1,
  elements: [{
    id: '0', resourceId: 'button', type: 'android.widget.Button', text: 'Open', hint: '',
    contentDescription: '', clickable: true, longClickable: false, editable: false,
    focusable: true, scrollable: false, enabled: true, checked: false, selected: false,
    bounds: {left: 0, top: 0, right: 100, bottom: 100},
  }],
};
let native: AgentServiceState;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  native = {taskId: 'task-1', cancelled: false, paused: false, reason: '', screenEpoch: 0};
  accessibility.getAgentServiceState.mockImplementation(async () => ({...native}));
  accessibility.isServiceEnabled.mockResolvedValue(true);
  accessibility.observeScreen.mockResolvedValue(screen);
  accessibility.executeAgentAction.mockResolvedValue(true);
  llm.isModelLoaded.mockResolvedValue(true);
  llm.getRemainingContextTokens.mockResolvedValue(10000);
  llm.stopGeneration.mockResolvedValue(true);
  llm.resetConversation.mockResolvedValue(true);
  llm.generate.mockResolvedValue('{"type":"done","result":"Finished"}');
});

afterEach(() => { jest.useRealTimers(); });

async function execute(onStep: (step: AgentStep) => void | Promise<void> = jest.fn()) {
  const result = AccessibilityAgent.execute('Open settings', config, onStep);
  await jest.runAllTimersAsync();
  return result;
}

it('does not press Home without an active native task', async () => {
  native.taskId = null;
  expect(await execute()).toMatchObject({success: false, cancelled: true});
  expect(accessibility.executeAgentAction).not.toHaveBeenCalled();
  expect(llm.generate).not.toHaveBeenCalled();
});

it('ignores a completed inference after cancellation', async () => {
  llm.generate.mockImplementationOnce(async () => {
    native.cancelled = true;
    native.reason = 'cancelled';
    AccessibilityAgent.cancel();
    return '{"type":"click","target":"0"}';
  });
  expect(await execute()).toMatchObject({success: false, cancelled: true});
  expect(llm.stopGeneration).toHaveBeenCalledWith('task-1');
  expect(accessibility.executeAgentAction.mock.calls.map(call => call[2])).toEqual([{type: 'home'}]);
});

it('waits while locked and discards the pre-lock plan before observing again', async () => {
  llm.generate.mockImplementationOnce(async () => {
    native.paused = true;
    native.screenEpoch++;
    setTimeout(() => {
      native.paused = false;
      native.screenEpoch++;
    }, 1000);
    return '{"type":"click","target":"0"}';
  });
  expect(await execute()).toMatchObject({success: true});
  expect(llm.generate).toHaveBeenCalledTimes(2);
  expect(accessibility.executeAgentAction.mock.calls.map(call => call[2])).toEqual([{type: 'home'}]);
});

it('does not perform a planned action when its durable checkpoint fails', async () => {
  llm.generate.mockResolvedValueOnce('{"type":"click","target":"0"}');
  const result = await execute(async step => {
    if (step.status === 'executing') throw new Error('Storage full');
  });
  expect(result).toMatchObject({success: false, error: 'Storage full'});
  expect(accessibility.executeAgentAction.mock.calls.map(call => call[2])).toEqual([{type: 'home'}]);
});

it('observes again when native validation rejects a changed target', async () => {
  llm.generate.mockResolvedValueOnce('{"type":"click","target":"0"}');
  accessibility.executeAgentAction.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const result = await execute();
  expect(result.success).toBe(true);
  expect(result.steps[0]).toMatchObject({status: 'failed', error: 'Screen or target changed; observing again'});
  expect(accessibility.observeScreen).toHaveBeenCalledTimes(3);
});

it('stops repeated actions on an unchanged screen even when model reasoning varies', async () => {
  let count = 0;
  llm.generate.mockImplementation(async () => JSON.stringify({type: 'click', target: '0', reasoning: `Attempt ${++count}`}));
  const result = await execute();
  expect(result).toMatchObject({success: false, error: 'Agent stopped after repeated actions without progress'});
  expect(accessibility.executeAgentAction).toHaveBeenCalledTimes(4); // Home + three clicks.
});

it('bounds a stalled inference and stops only its own model session', async () => {
  llm.generate.mockImplementation(() => new Promise(() => {}));
  const result = await execute();
  expect(result).toMatchObject({success: false, error: 'Agent inference timed out'});
  expect(llm.stopGeneration.mock.calls).toEqual([['task-1'], ['task-1'], ['task-1']]);
});
