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
 *   const result = await agentOrchestrator.execute("Do something", onStep);
 */

export {agentOrchestrator} from './agentOrchestrator';
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
