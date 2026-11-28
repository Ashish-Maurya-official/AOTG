import {DeviceEventEmitter} from 'react-native';
import NativeLLM from '../../native/turbo_modules/LLM/NativeLLM';
import LLMService from '../llmService';

jest.mock('react-native', () => {
  const emitter = new (require('events').EventEmitter)();
  return {
    Platform: {OS: 'android'},
    DeviceEventEmitter: emitter,
    NativeEventEmitter: class {
      addListener(event: string, callback: (...args: unknown[]) => void) {
        emitter.on(event, callback);
        return {remove: () => emitter.off(event, callback)};
      }
    },
  };
});
jest.mock('../../native/turbo_modules/LLM/NativeLLM', () => ({
  startGeneration: jest.fn(), startGenerationWithImage: jest.fn(), startGenerationWithAudio: jest.fn(),
  stopGeneration: jest.fn(), resetConversation: jest.fn(),
  claimAgentSession: jest.fn(), releaseAgentSession: jest.fn(),
}));

const native = jest.mocked(NativeLLM);

beforeEach(() => {
  jest.resetAllMocks();
  DeviceEventEmitter.removeAllListeners();
  native.startGeneration.mockResolvedValue(true);
  native.startGenerationWithImage.mockResolvedValue(true);
  native.startGenerationWithAudio.mockResolvedValue(true);
});

it('isolates chat and agent tokens, completions and errors by request ID', async () => {
  const chatToken = jest.fn();
  const agentToken = jest.fn();
  const chat = LLMService.generate('chat', chatToken);
  const agent = LLMService.generateWithVision('agent', '/screen.png', agentToken, 'task-1');
  const chatId = native.startGeneration.mock.calls[0][1];
  const agentId = native.startGenerationWithImage.mock.calls[0][2];
  expect(chatId).not.toBe(agentId);
  expect(native.startGenerationWithImage).toHaveBeenCalledWith('agent', '/screen.png', agentId, 'task-1');
  DeviceEventEmitter.emit('onToken', {requestId: agentId, token: 'agent token'});
  DeviceEventEmitter.emit('onToken', {requestId: chatId, token: 'chat token'});
  DeviceEventEmitter.emit('onGenerationError', {requestId: 'older-request', error: 'stale'});
  DeviceEventEmitter.emit('onGenerationComplete', {requestId: chatId, fullText: 'chat answer'});
  DeviceEventEmitter.emit('onGenerationComplete', {requestId: agentId, fullText: 'agent action'});
  await expect(chat).resolves.toBe('chat answer');
  await expect(agent).resolves.toBe('agent action');
  expect(chatToken.mock.calls).toEqual([['chat token']]);
  expect(agentToken.mock.calls).toEqual([['agent token']]);
  expect(DeviceEventEmitter.listenerCount('onToken')).toBe(0);
});

it('cleans listeners when completion arrives before the native start promise resolves', async () => {
  native.startGeneration.mockImplementationOnce(async (_prompt, requestId) => {
    DeviceEventEmitter.emit('onGenerationComplete', {requestId, fullText: 'immediate answer'});
    return true;
  });
  await expect(LLMService.generate('prompt')).resolves.toBe('immediate answer');
  expect(DeviceEventEmitter.listenerCount('onToken')).toBe(0);
  expect(DeviceEventEmitter.listenerCount('onGenerationComplete')).toBe(0);
  expect(DeviceEventEmitter.listenerCount('onGenerationError')).toBe(0);
});

it('ignores late audio events after an error and removes subscriptions on rejection', async () => {
  const audio = LLMService.generateWithAudio('transcribe', '/audio.wav');
  const failure = audio.catch(error => error);
  const requestId = native.startGenerationWithAudio.mock.calls[0][2];
  DeviceEventEmitter.emit('onGenerationError', {requestId, error: 'Audio failed'});
  DeviceEventEmitter.emit('onGenerationComplete', {requestId, fullText: 'late answer'});
  expect(await failure).toEqual(new Error('Audio failed'));
  expect(DeviceEventEmitter.listenerCount('onGenerationComplete')).toBe(0);
  native.startGeneration.mockRejectedValueOnce(new Error('Model owned by agent'));
  await expect(LLMService.generate('chat')).rejects.toThrow('Model owned by agent');
  expect(DeviceEventEmitter.listenerCount('onToken')).toBe(0);
});

it('scopes stop and reset to the caller so chat cleanup cannot cancel the agent', async () => {
  native.stopGeneration.mockResolvedValue(true);
  native.resetConversation.mockResolvedValue(true);
  await LLMService.stopGeneration();
  await LLMService.stopGeneration('task-1');
  await LLMService.resetConversation('task-1');
  expect(native.stopGeneration.mock.calls).toEqual([[''], ['task-1']]);
  expect(native.resetConversation).toHaveBeenCalledWith('task-1');
});
