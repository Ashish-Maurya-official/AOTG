import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeEventEmitter, Platform } from 'react-native';
import NativeAgentTools from '../native/turbo_modules/AgentTools/NativeAgentTools';
import { createToolRegistry } from '../plugins/registerPlugins';
import type { ToolRegistry } from './registry';
import type { ToolActivity } from './types';

const ENABLED_KEY = '@aotg/tools/enabled';
export const areToolsAvailable = Platform.OS === 'android' && !!NativeAgentTools;
const requests = new Map<string, AbortController>();
const listeners = new Set<(activity: ToolActivity) => void>();
let initialization: Promise<ToolRegistry> | undefined;
let lastActivity: ToolActivity | undefined;
let activeGenerationId: string | undefined;
let enabled = false;
let modelSupportsTools = false;

interface ToolRequest {
  requestId: string;
  generationId: string;
  name: string;
  argumentsJson: string;
  maxResultBytes: number;
  mode?: string;
}

function isToolRequest(value: unknown): value is ToolRequest {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return ['requestId', 'generationId', 'name', 'argumentsJson'].every(key => typeof event[key] === 'string') &&
    (event.argumentsJson as string).length <= 6000 && typeof event.maxResultBytes === 'number' && Number.isFinite(event.maxResultBytes);
}

function emit(activity: ToolActivity): void {
  if (activeGenerationId && activity.generationId !== activeGenerationId) return;
  lastActivity = activity;
  listeners.forEach(listener => listener(activity));
}

async function handleRequest(registry: ToolRegistry, event: ToolRequest): Promise<void> {
  if (activeGenerationId && event.generationId !== activeGenerationId) return;
  if (requests.has(event.requestId)) return;
  const controller = new AbortController();
  requests.set(event.requestId, controller);
  const activity: ToolActivity = {
    requestId: event.requestId, generationId: event.generationId,
    toolName: event.name, mode: event.mode === 'live' ? 'live' : 'chat', state: 'running', sources: [],
  };
  emit(activity);
  const timer = setTimeout(() => controller.abort(), 22000);
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error('Task cancelled')); });
  controller.signal.addEventListener('abort', rejectAbort);
  try {
    if (!enabled || !modelSupportsTools) throw new Error('Online tools are disabled');
    const result = await Promise.race([registry.execute(event.name, JSON.parse(event.argumentsJson), {
      requestId: event.requestId, generationId: event.generationId,
      signal: controller.signal, maxResultBytes: Math.max(256, Math.min(6000, event.maxResultBytes)),
    }), aborted]);
    if (controller.signal.aborted) return;
    const accepted = await NativeAgentTools?.resolveTool(event.requestId, JSON.stringify(result));
    if (accepted) emit({ ...activity, state: result.status === 'ok' ? 'complete' : result.status === 'partial' ? 'partial' : 'failed', sources: result.sources || [] });
  } catch {
    // Never expose cookies, request URLs, or arbitrary native exception bodies to the model/logs.
    if (!controller.signal.aborted) {
      await NativeAgentTools?.resolveTool(event.requestId, JSON.stringify({
        status: 'unavailable', content: 'The source could not be retrieved. Do not claim current information was verified.',
      })).catch(() => {});
      emit({ ...activity, state: 'failed' });
    }
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', rejectAbort);
    requests.delete(event.requestId);
    if (controller.signal.aborted) {
      await NativeAgentTools?.resolveTool(event.requestId, JSON.stringify({ status: 'unavailable', content: 'Request cancelled or timed out.' })).catch(() => {});
      emit({ ...activity, state: 'cancelled' });
    }
  }
}

export function initializeTools(): Promise<ToolRegistry> {
  if (!initialization) initialization = (async () => {
    const registry = await createToolRegistry();
    enabled = (await AsyncStorage.getItem(ENABLED_KEY).catch(() => null)) === 'true';
    if (areToolsAvailable && NativeAgentTools) {
      const emitter = new NativeEventEmitter(NativeAgentTools);
      // Process-lifetime listeners: tool execution survives screen unmounts.
      emitter.addListener('onAgentToolRequest', event => { if (isToolRequest(event)) handleRequest(registry, event).catch(() => {}); });
      emitter.addListener('onAgentToolCancelled', event => {
        if (event && typeof event === 'object' && 'requestId' in event && typeof event.requestId === 'string') requests.get(event.requestId)?.abort();
      });
      emitter.addListener('onAgentToolTurnStarted', event => {
        if (event && typeof event === 'object' && 'generationId' in event && typeof event.generationId === 'string') {
          if (activeGenerationId !== event.generationId) requests.forEach(controller => controller.abort());
          activeGenerationId = event.generationId;
          emit({ requestId: '', generationId: event.generationId, toolName: '',
            mode: 'mode' in event && event.mode === 'live' ? 'live' : 'chat', state: 'idle', sources: [] });
        }
      });
    }
    return registry;
  })();
  return initialization;
}

export async function prepareModelTools(supported: boolean): Promise<void> {
  const registry = await initializeTools();
  modelSupportsTools = supported;
  await NativeAgentTools?.configure(JSON.stringify(enabled && supported ? registry.descriptions() : []));
}

export async function getToolsEnabled(): Promise<boolean> {
  await initializeTools();
  return enabled;
}

export async function setToolsEnabled(value: boolean): Promise<void> {
  await initializeTools();
  await AsyncStorage.setItem(ENABLED_KEY, String(value));
  enabled = value;
  if (!value) requests.forEach(controller => controller.abort());
  await prepareModelTools(modelSupportsTools);
}

export function subscribeToolActivity(listener: (activity: ToolActivity) => void): () => void {
  listeners.add(listener);
  if (lastActivity) listener(lastActivity);
  return () => { listeners.delete(listener); };
}
