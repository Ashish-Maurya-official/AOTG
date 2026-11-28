import orchestrator from '../agentOrchestrator';
import {AccessibilityAgent} from '../accessibilityAgent';
import type {AgentResult} from '../types';

jest.mock('../accessibilityAgent', () => ({
  AccessibilityAgent: {
    id: 'accessibility-agent', name: 'Accessibility Agent',
    canHandle: jest.fn(() => true), execute: jest.fn(), cancel: jest.fn(),
  },
}));

it('keeps the first agent cancellable after a duplicate execution is rejected', async () => {
  let finish!: (result: AgentResult) => void;
  jest.mocked(AccessibilityAgent.execute).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const execution = orchestrator.execute('First task', jest.fn());
  await expect(orchestrator.execute('Duplicate task', jest.fn())).rejects.toThrow('already running');
  expect(orchestrator.isRunning()).toBe(true);
  orchestrator.cancel();
  expect(AccessibilityAgent.cancel).toHaveBeenCalledTimes(1);
  finish({success: false, cancelled: true, steps: [], summary: 'Cancelled', startTime: 1, endTime: 2});
  await execution;
  expect(orchestrator.isRunning()).toBe(false);
});

it('rejects an explicit unknown agent without falling back to another agent', async () => {
  jest.mocked(AccessibilityAgent.execute).mockClear();
  await expect(orchestrator.execute('Task', jest.fn(), undefined, 'missing')).rejects.toThrow();
  expect(AccessibilityAgent.execute).not.toHaveBeenCalled();
});
