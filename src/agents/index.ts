/**
 * AOTG Agent System — Public API
 *
 * Usage:
 *   import { agentOrchestrator, AccessibilityAgent } from './agents';
 *
 *   // Register custom agents
 *   agentOrchestrator.registerAgent(myCustomAgent);
 *
 *   // Execute
 *   const taskId = await agentRuntime.start("Do something", loadedModelId);
 */

export {agentOrchestrator} from './agentOrchestrator';
export {agentRuntime} from './agentRuntime';
export {AccessibilityAgent} from './accessibilityAgent';
export {buildActionPrompt, parseActionResponse} from './promptBuilder';
export type {
  Agent,
  AgentConfig,
  AgentStep,
  AgentResult,
  AgentAction,
  AgentExecutionStatus,
  ScreenObservation,
  UIElement,
  Bounds,
  StepStatus,
  ScreenChangedEvent,
} from './types';
export {DEFAULT_AGENT_CONFIG} from './types';
