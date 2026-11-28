jest.mock('react-native', () => {
  const emitter = new (require('events').EventEmitter)();
  return { Platform: { OS: 'android' }, DeviceEventEmitter: emitter,
    NativeEventEmitter: class {
      addListener(name: string, callback: (...args: unknown[]) => void) {
        emitter.on(name, callback);
        return { remove: () => emitter.off(name, callback) };
      }
    },
  };
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => 'true'), setItem: jest.fn(async () => {}),
}));
jest.mock('../../native/turbo_modules/AgentTools/NativeAgentTools', () => ({
  configure: jest.fn(async () => true), resolveTool: jest.fn(async () => true),
}));
jest.mock('../../plugins/registerPlugins', () => ({ createToolRegistry: jest.fn() }));

describe('shared chat and voice tool execution', () => {
  let runtime: typeof import('../toolRuntime');
  let emitter: typeof import('react-native').DeviceEventEmitter;
  let native: jest.Mocked<NonNullable<typeof import('../../native/turbo_modules/AgentTools/NativeAgentTools').default>>;
  let execute: jest.Mock;
  const event = { requestId: 'request-1', generationId: 'turn-1', name: 'test_read', argumentsJson: '{"url":"https://example.com"}', maxResultBytes: 1000 };
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));

  beforeEach(async () => {
    jest.resetModules();
    emitter = require('react-native').DeviceEventEmitter;
    native = require('../../native/turbo_modules/AgentTools/NativeAgentTools');
    execute = jest.fn(async () => ({ status: 'ok', content: 'Verified evidence' }));
    require('../../plugins/registerPlugins').createToolRegistry.mockResolvedValue({
      execute, descriptions: () => [{ name: 'test_read' }], getPlugins: () => [],
    });
    runtime = require('../toolRuntime');
    await runtime.prepareModelTools(true);
  });
  afterEach(() => { jest.useRealTimers(); });

  it('configures tools only for a supported model and an enabled preference', async () => {
    expect(native.configure).toHaveBeenLastCalledWith('[{"name":"test_read"}]');
    await runtime.prepareModelTools(false);
    expect(native.configure).toHaveBeenLastCalledWith('[]');
    await runtime.setToolsEnabled(false);
    emitter.emit('onAgentToolRequest', event);
    await flush();
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.parse(native.resolveTool.mock.calls[0][1]).status).toBe('unavailable');
  });

  it('dispatches validated native tool requests without touching model ownership', async () => {
    emitter.emit('onAgentToolRequest', event);
    await flush();
    expect(execute).toHaveBeenCalledWith('test_read', { url: 'https://example.com' }, expect.objectContaining({ generationId: 'turn-1' }));
    expect(JSON.parse(native.resolveTool.mock.calls[0][1]).content).toBe('Verified evidence');
  });

  it('ignores malformed bridge events and duplicate in-flight requests', async () => {
    let finish!: (value: unknown) => void;
    execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    emitter.emit('onAgentToolRequest', {});
    emitter.emit('onAgentToolRequest', { ...event, maxResultBytes: NaN });
    emitter.emit('onAgentToolRequest', event);
    emitter.emit('onAgentToolRequest', event);
    expect(execute).toHaveBeenCalledTimes(1);
    finish({ status: 'ok', content: 'Result' });
    await flush();
    expect(native.resolveTool).toHaveBeenCalledTimes(1);
  });

  it('cancels pending work on barge-in and never forwards its late evidence', async () => {
    let finish!: (value: unknown) => void;
    execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const activity = jest.fn();
    const unsubscribe = runtime.subscribeToolActivity(activity);
    emitter.emit('onAgentToolRequest', event);
    emitter.emit('onAgentToolCancelled', { requestId: event.requestId });
    await flush();
    expect(execute.mock.calls[0][2].signal.aborted).toBe(true);
    finish({ status: 'ok', content: 'Stale private result' });
    await flush();
    expect(native.resolveTool.mock.calls.some(call => call[1].includes('Stale private result'))).toBe(false);
    expect(activity.mock.calls.at(-1)?.[0].state).toBe('cancelled');
    unsubscribe();
  });

  it('settles a timeout even if a future plugin ignores AbortSignal', async () => {
    jest.useFakeTimers();
    execute.mockImplementation(() => new Promise(() => {}));
    emitter.emit('onAgentToolRequest', event);
    await jest.advanceTimersByTimeAsync(22000);
    expect(execute.mock.calls[0][2].signal.aborted).toBe(true);
    expect(JSON.parse(native.resolveTool.mock.calls[0][1]).content).toContain('timed out');
  });

  it('keeps cancellation from an old turn out of the new turn UI', async () => {
    execute.mockImplementation(() => new Promise(() => {}));
    const activity = jest.fn();
    const unsubscribe = runtime.subscribeToolActivity(activity);
    emitter.emit('onAgentToolTurnStarted', { generationId: 'turn-1', mode: 'chat' });
    emitter.emit('onAgentToolRequest', event);
    emitter.emit('onAgentToolTurnStarted', { generationId: 'turn-2', mode: 'live' });
    emitter.emit('onAgentToolCancelled', null);
    emitter.emit('onAgentToolTurnStarted', undefined);
    await flush();
    expect(execute.mock.calls[0][2].signal.aborted).toBe(true);
    expect(activity.mock.calls.at(-1)?.[0]).toMatchObject({ generationId: 'turn-2', mode: 'live', state: 'idle' });
    emitter.emit('onAgentToolRequest', event);
    expect(execute).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
