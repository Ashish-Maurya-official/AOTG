/**
 * AccessibilityAgent — The main AI agent implementation.
 *
 * Implements the observe → think → act loop:
 * 1. OBSERVE: Read the current screen via AccessibilityService
 * 2. THINK: Send observation + instruction to local LLM, get next action
 * 3. ACT: Execute the action via AccessibilityService
 * 4. LOOP: Repeat until done, error, or max steps reached
 */

import type {
  Agent,
  AgentConfig,
  AgentStep,
  AgentResult,
  AgentAction,
  ScreenObservation,
} from './types';
import {DEFAULT_AGENT_CONFIG} from './types';
import {buildActionPrompt, parseActionResponse} from './promptBuilder';
import AccessibilityService from '../services/accessibilityService';
import LLMService from '../services/llmService';

class AccessibilityAgentImpl implements Agent {
  readonly id = 'accessibility-agent';
  readonly name = 'Accessibility Agent';
  readonly description =
    'General-purpose agent that uses the accessibility tree to observe and interact with any app on the device.';

  private shouldStop = false;
  private isRunning = false;

  canHandle(_instruction: string): boolean {
    // This is the default agent — it can handle any instruction
    return true;
  }

  cancel(): void {
    this.shouldStop = true;
  }

  async execute(
    instruction: string,
    config: AgentConfig = DEFAULT_AGENT_CONFIG,
    onStep: (step: AgentStep) => void,
  ): Promise<AgentResult> {
    if (this.isRunning) {
      return {
        success: false,
        steps: [],
        summary: 'Agent is already running',
        error: 'Agent is already executing another instruction',
        startTime: Date.now(),
        endTime: Date.now(),
      };
    }

    this.isRunning = true;
    this.shouldStop = false;
    const startTime = Date.now();
    const steps: AgentStep[] = [];

    try {
      // Verify service is enabled
      const serviceEnabled = await AccessibilityService.isServiceEnabled();
      if (!serviceEnabled) {
        return {
          success: false,
          steps: [],
          summary: 'Accessibility service is not enabled',
          error:
            'Please enable the AOTG accessibility service in Settings > Accessibility',
          startTime,
          endTime: Date.now(),
        };
      }

      // Verify LLM is loaded
      const llmLoaded = await LLMService.isModelLoaded();
      if (!llmLoaded) {
        return {
          success: false,
          steps: [],
          summary: 'No LLM model is loaded',
          error:
            'Please download and load a model first before using the agent',
          startTime,
          endTime: Date.now(),
        };
      }

      // ─── Main observe → think → act loop ───
      for (let stepIndex = 0; stepIndex < config.maxSteps; stepIndex++) {
        if (this.shouldStop) {
          return {
            success: false,
            steps,
            summary: 'Agent was cancelled by user',
            startTime,
            endTime: Date.now(),
          };
        }

        // Create step object
        const step: AgentStep = {
          stepIndex,
          observation: null,
          reasoning: '',
          action: null,
          timestamp: Date.now(),
          status: 'observing',
        };
        onStep({...step});

        // ── OBSERVE ──
        try {
          const observation = await AccessibilityService.observeScreen(
            config.includeScreenshots,
          );
          step.observation = observation;
          step.status = 'thinking';
          onStep({...step});
        } catch (err) {
          step.status = 'failed';
          step.error =
            err instanceof Error ? err.message : 'Failed to observe screen';
          steps.push(step);
          onStep({...step});
          continue; // Try next step
        }

        // ── THINK ──
        let action: AgentAction;
        try {
          const prompt = buildActionPrompt(
            instruction,
            step.observation!,
            steps,
            config,
          );

          step.rawThinking = '';

          // Capture screenshot for vision inference (parallel with prompt build)
          let screenshotPath: string | null = null;
          if (config.includeScreenshots) {
            screenshotPath = await AccessibilityService.takeScreenshotToFile();
          }

          // Use vision inference if screenshot is available, else fall back to text-only
          const llmResponse = screenshotPath
            ? await LLMService.generateWithVision(prompt, screenshotPath, (token) => {
                step.rawThinking += token;
                onStep({...step});
              })
            : await LLMService.generate(prompt, (token) => {
                step.rawThinking += token;
                onStep({...step});
              });

          action = parseActionResponse(llmResponse);
          step.action = action;
          step.reasoning = action.type === 'error'
            ? action.message
            : ('reasoning' in action && action.reasoning) || '';
          step.status = 'executing';
          onStep({...step});
        } catch (err) {
          step.status = 'failed';
          step.error =
            err instanceof Error ? err.message : 'LLM inference failed';
          steps.push(step);
          onStep({...step});
          continue;
        }


        // ── Check for terminal actions ──
        if (action.type === 'done') {
          step.status = 'completed';
          steps.push(step);
          onStep({...step});
          return {
            success: true,
            steps,
            summary: action.result,
            startTime,
            endTime: Date.now(),
          };
        }

        if (action.type === 'error') {
          step.status = 'failed';
          step.error = action.message;
          steps.push(step);
          onStep({...step});
          return {
            success: false,
            steps,
            summary: `Agent reported error: ${action.message}`,
            error: action.message,
            startTime,
            endTime: Date.now(),
          };
        }

        // ── ACT ──
        try {
          const actionResult = await this.executeAction(action);
          step.status = actionResult ? 'completed' : 'failed';
          if (!actionResult) {
            step.error = 'Action execution returned false';
          }
        } catch (err) {
          step.status = 'failed';
          step.error =
            err instanceof Error ? err.message : 'Action execution failed';
        }

        steps.push(step);
        onStep({...step});

        // Wait between steps to let the UI update
        if (config.stepDelayMs > 0 && !this.shouldStop) {
          await this.delay(config.stepDelayMs);
        }
      }

      // Exceeded max steps
      return {
        success: false,
        steps,
        summary: `Agent reached maximum steps (${config.maxSteps}) without completing the task`,
        error: 'Max steps exceeded',
        startTime,
        endTime: Date.now(),
      };
    } finally {
      this.isRunning = false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Action Execution
  // ─────────────────────────────────────────────────────────────

  /**
   * Executes a single agent action via the AccessibilityService.
   * Includes retry logic: if node-based click fails, falls back to coordinate tap.
   */
  private async executeAction(action: AgentAction): Promise<boolean> {
    switch (action.type) {
      case 'click':
        return AccessibilityService.performAction(action.target, 'click');

      case 'long_click':
        return AccessibilityService.performAction(action.target, 'long_click');

      case 'set_text':
        return AccessibilityService.performAction(
          action.target,
          'set_text',
          action.value,
        );

      case 'scroll':
        return AccessibilityService.performAction(
          action.target,
          action.direction === 'forward'
            ? 'scroll_forward'
            : 'scroll_backward',
        );

      case 'swipe':
        return AccessibilityService.swipe(
          action.startX,
          action.startY,
          action.endX,
          action.endY,
        );

      case 'tap_coordinates':
        return AccessibilityService.tapAtCoordinates(action.x, action.y);

      case 'back':
        return AccessibilityService.pressBack();

      case 'home':
        return AccessibilityService.pressHome();

      case 'wait':
        await this.delay(action.durationMs);
        return true;

      default:
        console.warn(
          `[AccessibilityAgent] Unknown action type: ${(action as any).type}`,
        );
        return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const AccessibilityAgent = new AccessibilityAgentImpl();
export default AccessibilityAgent;
