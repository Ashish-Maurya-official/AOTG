/**
 * PromptBuilder — Constructs structured prompts for the LLM to decide agent actions.
 *
 * This module handles:
 * 1. System prompt defining the agent's role and action schema
 * 2. Screen observation formatting (pruning for token efficiency)
 * 3. History formatting (context from previous steps)
 * 4. Edge case handling (empty screens, popups, etc.)
 */

import type {
  ScreenObservation,
  UIElement,
  AgentStep,
  AgentAction,
  AgentConfig,
} from './types';

// ─────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_VISION = `You are an AI agent controlling an Android device to complete user tasks.
You receive BOTH a screenshot of the current screen AND a compact accessibility tree.

## How to use your inputs
- The SCREENSHOT shows you visually what is on screen (positions, colours, text, images).
- The ACCESSIBILITY TREE gives you semantic IDs to interact with elements precisely.
- Always prefer node actions using the element "id" over coordinate taps.

## Rules
1. Respond with ONLY a valid JSON object — no markdown, no explanation.
2. Analyze the screenshot AND the element list before deciding.
3. If a target element is not visible, scroll to find it.
4. After typing text, tap the search/submit button or press enter.
5. Handle any dialog/popup before proceeding.
6. If stuck (same screen after action), try an alternative approach.
7. Use "done" when the task is complete, "error" if it cannot be completed.

## Action Schema — respond with ONE of:
{"type":"click","target":"<id>","reasoning":"<why>"}
{"type":"long_click","target":"<id>","reasoning":"<why>"}
{"type":"set_text","target":"<id>","value":"<text>","reasoning":"<why>"}
{"type":"scroll","target":"<id>","direction":"forward|backward","reasoning":"<why>"}
{"type":"tap_coordinates","x":<n>,"y":<n>,"reasoning":"<why>"}
{"type":"swipe","startX":<n>,"startY":<n>,"endX":<n>,"endY":<n>,"reasoning":"<why>"}
{"type":"back","reasoning":"<why>"}
{"type":"home","reasoning":"<why>"}
{"type":"wait","durationMs":<ms>,"reasoning":"<why>"}
{"type":"done","result":"<summary>"}
{"type":"error","message":"<why>"}`;

const SYSTEM_PROMPT_TEXT = `You are an AI agent controlling an Android device to complete user tasks.
You receive a compact accessibility tree describing the elements currently on screen. You do NOT have a screenshot — rely only on the element list.

## How to use your inputs
- Each element has a semantic "id", plus text/description/type and a center point "xy":[x,y].
- Always prefer node actions using the element "id". Only use tap_coordinates when no suitable id exists (use the element's "xy" values).

## Rules
1. Respond with ONLY a valid JSON object — no markdown, no explanation.
2. Analyze the element list carefully before deciding.
3. If a target element is not in the list, scroll to reveal more elements.
4. After typing text, tap the search/submit button or press enter.
5. Handle any dialog/popup before proceeding.
6. If stuck (same screen after action), try an alternative approach.
7. Use "done" when the task is complete, "error" if it cannot be completed.

## Action Schema — respond with ONE of:
{"type":"click","target":"<id>","reasoning":"<why>"}
{"type":"long_click","target":"<id>","reasoning":"<why>"}
{"type":"set_text","target":"<id>","value":"<text>","reasoning":"<why>"}
{"type":"scroll","target":"<id>","direction":"forward|backward","reasoning":"<why>"}
{"type":"tap_coordinates","x":<n>,"y":<n>,"reasoning":"<why>"}
{"type":"swipe","startX":<n>,"startY":<n>,"endX":<n>,"endY":<n>,"reasoning":"<why>"}
{"type":"back","reasoning":"<why>"}
{"type":"home","reasoning":"<why>"}
{"type":"wait","durationMs":<ms>,"reasoning":"<why>"}
{"type":"done","result":"<summary>"}
{"type":"error","message":"<why>"}`;

// ─────────────────────────────────────────────────────────────
// Prompt Building
// ─────────────────────────────────────────────────────────────

/**
 * Builds the complete prompt for the LLM to decide the next action.
 * When useVision=true, the prompt is text-only (image is passed separately).
 */
export function buildActionPrompt(
  instruction: string,
  observation: ScreenObservation,
  history: AgentStep[],
  config: AgentConfig,
  useVision: boolean = true,
): string {
  const parts: string[] = [];

  parts.push(useVision ? SYSTEM_PROMPT_VISION : SYSTEM_PROMPT_TEXT);
  parts.push('');

  parts.push(`## Task`);
  parts.push(`"${instruction}"`);
  parts.push('');

  if (history.length > 0) {
    parts.push(`## Steps so far (${history.length})`);
    const recent = history.slice(-4);
    for (const step of recent) {
      parts.push(`• Step ${step.stepIndex}: ${formatStepSummary(step)}`);
    }
    parts.push('');
  }

  parts.push(`## Current Screen`);
  parts.push(`App: ${observation.app}`);

  if (observation.error) {
    parts.push(`Error: ${observation.error}`);
    parts.push('No elements. Try waiting or pressing back.');
  } else {
    const pruned = pruneElements(observation.elements, config.maxElementsInPrompt);
    parts.push(`Interactive elements (${pruned.length} of ${observation.totalNodes}):`);
    // Compact inline JSON — one element per line, not pretty-printed
    parts.push(pruned.map(e => JSON.stringify(e)).join('\n'));
  }

  parts.push('');
  parts.push('## Decision');
  parts.push('Respond with a single JSON action object only.');

  return parts.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Element Pruning (for token efficiency)
// ─────────────────────────────────────────────────────────────

/**
 * Prunes the elements list to stay within token budget.
 * Prioritizes actionable and text-containing elements.
 */
function pruneElements(
  elements: UIElement[],
  maxCount: number,
): PrunedElement[] {
  // Sort: actionable elements first, then by screen position (top to bottom)
  const sorted = [...elements].sort((a, b) => {
    const aScore = getElementPriority(a);
    const bScore = getElementPriority(b);
    if (aScore !== bScore) return bScore - aScore;
    return a.bounds.top - b.bounds.top;
  });

  // Take top N elements
  const selected = sorted.slice(0, maxCount);

  // Re-sort by screen position for natural reading order
  selected.sort((a, b) => {
    if (Math.abs(a.bounds.top - b.bounds.top) < 20) {
      return a.bounds.left - b.bounds.left;
    }
    return a.bounds.top - b.bounds.top;
  });

  // Convert to pruned format (remove unnecessary fields)
  return selected.map(formatElementForPrompt);
}

/** Assigns a priority score to an element for pruning decisions */
function getElementPriority(element: UIElement): number {
  let score = 0;
  if (element.clickable) score += 3;
  if (element.editable) score += 4; // Input fields are high priority
  if (element.text) score += 2;
  if (element.contentDescription) score += 1;
  if (element.scrollable) score += 1;
  if (!element.enabled) score -= 5;
  return score;
}

/** Condensed element format for the LLM prompt */
interface PrunedElement {
  id: string;
  t?: string;         // type (omitted for generic containers)
  text?: string;
  hint?: string;
  desc?: string;
  rid?: string;       // shortened resourceId
  c?: boolean;        // clickable
  e?: boolean;        // editable
  s?: boolean;        // scrollable
  ck?: boolean;       // checked
  xy: [number, number]; // center point [cx, cy] — much cheaper than full bounds
}

/** Generic container types that provide no semantic value to the LLM */
const SKIP_TYPES = new Set([
  'View', 'ViewGroup', 'FrameLayout', 'LinearLayout', 'RelativeLayout',
  'ConstraintLayout', 'CoordinatorLayout', 'ScrollView', 'HorizontalScrollView',
]);

/** Formats a UI element for inclusion in the prompt — ultra-compact */
function formatElementForPrompt(element: UIElement): PrunedElement {
  const cx = Math.round((element.bounds.left + element.bounds.right) / 2);
  const cy = Math.round((element.bounds.top + element.bounds.bottom) / 2);

  const pruned: PrunedElement = {
    id: element.id,
    xy: [cx, cy],
  };

  // Only include type when semantically meaningful
  if (element.type && !SKIP_TYPES.has(element.type)) {
    pruned.t = element.type;
  }

  if (element.text) pruned.text = element.text;
  if (element.hint) pruned.hint = element.hint;
  if (element.contentDescription) pruned.desc = element.contentDescription;
  if (element.resourceId) {
    const parts = element.resourceId.split('/');
    const shortId = parts.length > 1 ? parts[1] : element.resourceId;
    if (shortId) pruned.rid = shortId;
  }
  if (element.clickable) pruned.c = true;
  if (element.editable) pruned.e = true;
  if (element.scrollable) pruned.s = true;
  if (element.checked) pruned.ck = true;

  return pruned;
}

// ─────────────────────────────────────────────────────────────
// Step Summary (for history context)
// ─────────────────────────────────────────────────────────────

/** Formats a completed step into a brief summary for history */
function formatStepSummary(step: AgentStep): string {
  if (!step.action) return `[${step.status}] No action taken`;

  const action = step.action;
  switch (action.type) {
    case 'click':
      return `Clicked element "${action.target}" — ${step.status}`;
    case 'long_click':
      return `Long-clicked element "${action.target}" — ${step.status}`;
    case 'set_text':
      return `Set text "${action.value}" on element "${action.target}" — ${step.status}`;
    case 'scroll':
      return `Scrolled ${action.direction} on "${action.target}" — ${step.status}`;
    case 'tap_coordinates':
      return `Tapped at (${action.x}, ${action.y}) — ${step.status}`;
    case 'swipe':
      return `Swiped from (${action.startX},${action.startY}) to (${action.endX},${action.endY}) — ${step.status}`;
    case 'back':
      return `Pressed Back — ${step.status}`;
    case 'home':
      return `Pressed Home — ${step.status}`;
    case 'wait':
      return `Waited ${action.durationMs}ms — ${step.status}`;
    case 'done':
      return `Completed: ${action.result}`;
    case 'error':
      return `Error: ${action.message}`;
    default:
      return `[${step.status}]`;
  }
}

/**
 * Parses the LLM's response into an AgentAction.
 * Handles common LLM output issues (markdown wrapping, extra text, etc.)
 */
export function parseActionResponse(response: string): AgentAction {
  // Strip markdown code blocks if present
  let cleaned = response.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  // Try to find JSON object in the response
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    return {type: 'error', message: `LLM response is not valid JSON: ${response.substring(0, 100)}`};
  }

  const jsonStr = cleaned.substring(jsonStart, jsonEnd + 1);

  try {
    const parsed = JSON.parse(jsonStr) as AgentAction;

    // Validate required fields
    if (!parsed.type) {
      return {type: 'error', message: 'LLM response missing "type" field'};
    }

    return validateAction(parsed);
  } catch (e) {
    return {
      type: 'error',
      message: `Failed to parse LLM action: ${e instanceof Error ? e.message : 'unknown error'}`,
    };
  }
}

/**
 * Validates that an action has all fields required for its type.
 * Returns an {type:'error'} action with a helpful message when invalid, so the
 * agent loop degrades gracefully instead of executing a malformed action
 * (e.g. a click with no target, or coordinates that aren't numbers).
 */
function validateAction(action: AgentAction): AgentAction {
  const isNum = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v);

  switch (action.type) {
    case 'click':
    case 'long_click':
      if (!action.target) {
        return {type: 'error', message: `"${action.type}" action is missing a "target" element id`};
      }
      return action;

    case 'set_text':
      if (!action.target) {
        return {type: 'error', message: '"set_text" action is missing a "target" element id'};
      }
      if (typeof action.value !== 'string') {
        return {type: 'error', message: '"set_text" action is missing a string "value"'};
      }
      return action;

    case 'scroll':
      if (!action.target) {
        return {type: 'error', message: '"scroll" action is missing a "target" element id'};
      }
      if (action.direction !== 'forward' && action.direction !== 'backward') {
        return {...action, direction: 'forward'};
      }
      return action;

    case 'tap_coordinates':
      if (!isNum(action.x) || !isNum(action.y)) {
        return {type: 'error', message: '"tap_coordinates" requires numeric "x" and "y"'};
      }
      return action;

    case 'swipe':
      if (!isNum(action.startX) || !isNum(action.startY) || !isNum(action.endX) || !isNum(action.endY)) {
        return {type: 'error', message: '"swipe" requires numeric start/end coordinates'};
      }
      return action;

    case 'wait':
      if (!isNum(action.durationMs)) {
        return {...action, durationMs: 500};
      }
      return action;

    case 'done':
      if (typeof action.result !== 'string') {
        return {...action, result: 'Task completed'};
      }
      return action;

    case 'error':
      if (typeof action.message !== 'string' || !action.message) {
        return {type: 'error', message: 'Agent reported an unspecified error'};
      }
      return action;

    case 'back':
    case 'home':
      return action;

    default:
      return {type: 'error', message: `Unknown action type: "${(action as any).type}"`};
  }
}
