/**
 * Core type definitions for the AOTG AI Agent system.
 *
 * This module defines the interfaces and types used across the entire
 * agent framework. It is designed for loose coupling — new agents can
 * be added by implementing the Agent interface without modifying
 * existing code.
 */

// ─────────────────────────────────────────────────────────────
// UI Observation Types
// ─────────────────────────────────────────────────────────────

/** Bounding rectangle in screen coordinates */
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Single UI element from the accessibility tree */
export interface UIElement {
  id: string;
  resourceId: string;
  type: string;
  text: string;
  hint: string;
  contentDescription: string;
  clickable: boolean;
  longClickable: boolean;
  editable: boolean;
  focusable: boolean;
  scrollable: boolean;
  enabled: boolean;
  checked: boolean;
  selected: boolean;
  bounds: Bounds;
}

/** Complete screen observation from the accessibility tree */
export interface ScreenObservation {
  app: string;
  timestamp: number;
  elements: UIElement[];
  totalNodes: number;
  error?: string;
  screenshotBase64?: string;
}

// ─────────────────────────────────────────────────────────────
// Agent Action Types
// ─────────────────────────────────────────────────────────────

/** Actions the LLM can decide to take */
export type AgentAction =
  | { type: 'click'; target: string; reasoning?: string }
  | { type: 'long_click'; target: string; reasoning?: string }
  | { type: 'set_text'; target: string; value: string; reasoning?: string }
  | { type: 'scroll'; target: string; direction: 'forward' | 'backward'; reasoning?: string }
  | { type: 'swipe'; startX: number; startY: number; endX: number; endY: number; reasoning?: string }
  | { type: 'tap_coordinates'; x: number; y: number; reasoning?: string }
  | { type: 'back'; reasoning?: string }
  | { type: 'home'; reasoning?: string }
  | { type: 'wait'; durationMs: number; reasoning?: string }
  | { type: 'done'; result: string }
  | { type: 'error'; message: string };

// ─────────────────────────────────────────────────────────────
// Agent Execution Types
// ─────────────────────────────────────────────────────────────

/** Status of a single agent step */
export type StepStatus = 'pending' | 'observing' | 'thinking' | 'executing' | 'completed' | 'failed';

export interface AgentStep {
  stepIndex: number;
  observation: ScreenObservation | null;
  reasoning: string;
  rawThinking?: string;
  action: AgentAction | null;
  timestamp: number;
  status: StepStatus;
  error?: string;
}

/** Overall status of agent execution */
export type AgentExecutionStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Result of a complete agent execution */
export interface AgentResult {
  success: boolean;
  steps: AgentStep[];
  summary: string;
  error?: string;
  startTime: number;
  endTime: number;
}

// ─────────────────────────────────────────────────────────────
// Agent Interface (Implement this for new agents)
// ─────────────────────────────────────────────────────────────

/** Configuration options for agent execution */
export interface AgentConfig {
  /** Maximum number of observe→think→act steps before giving up */
  maxSteps: number;
  /** Delay in ms between steps to allow UI to update */
  stepDelayMs: number;
  /** Whether to include screenshots in observations */
  includeScreenshots: boolean;
  /** Whether the loaded model can accept image input. When false, the agent runs text-only (accessibility tree only). */
  useVision: boolean;
  /** Max time to wait for a single LLM inference before treating the step as failed */
  inferenceTimeoutMs: number;
  /** Max elements to include in the LLM prompt (for token efficiency) */
  maxElementsInPrompt: number;
}

/** Default agent configuration */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxSteps: 25,
  stepDelayMs: 800,
  includeScreenshots: true,   // Vision model takes a screenshot when supported
  useVision: false,           // Enabled only for vision-capable models (see AVAILABLE_MODELS.supportsVision)
  inferenceTimeoutMs: 120000, // 2 min hard cap per step so a stalled model can't hang the loop
  maxElementsInPrompt: 20,    // Aggressive compression — vision handles the rest
};

/**
 * Agent interface — implement this for each agent type.
 *
 * Example agents:
 * - AccessibilityAgent: general-purpose screen interaction
 * - FormFillerAgent: specialized for filling forms
 * - SearchAgent: specialized for searching within apps
 */
export interface Agent {
  /** Unique identifier for this agent */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Description of what this agent does */
  readonly description: string;

  /**
   * Returns true if this agent can handle the given instruction.
   * Used by the AgentOrchestrator for routing.
   */
  canHandle(instruction: string): boolean;

  /**
   * Executes the given instruction.
   * Calls onStep for each step in the execution for live UI updates.
   * Returns the final result when done.
   */
  execute(
    instruction: string,
    config: AgentConfig,
    onStep: (step: AgentStep) => void,
  ): Promise<AgentResult>;

  /** Cancels the current execution */
  cancel(): void;
}

// ─────────────────────────────────────────────────────────────
// Screen Change Event
// ─────────────────────────────────────────────────────────────

export interface ScreenChangedEvent {
  packageName: string;
  className: string;
  eventType: number;
}
