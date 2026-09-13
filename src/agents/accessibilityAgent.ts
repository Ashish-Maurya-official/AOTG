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
    // Also interrupt any in-flight LLM inference so a cancel pressed during the
    // "thinking" phase is responsive, instead of waiting for the full response.
    LLMService.stopGeneration().catch(() => {});
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
    let consecutiveObserveFailures = 0;
    let lastActionSignature: string | null = null;
    let repeatedActionCount = 0;

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
          // Tree only — the screenshot (when the model supports vision) is
          // captured separately below to avoid grabbing the screen twice.
          const observation = await AccessibilityService.observeScreen(false);
          step.observation = observation;

          // A persistently empty/errored screen (e.g. no active window) should
          // not spin forever — bail out after several consecutive failures.
          if (observation.error && observation.elements.length === 0) {
            consecutiveObserveFailures++;
            if (consecutiveObserveFailures >= 3) {
              step.status = 'failed';
              step.error = observation.error;
              steps.push(step);
              onStep({...step});
              return {
                success: false,
                steps,
                summary: `Unable to read the screen: ${observation.error}`,
                error: observation.error,
                startTime,
                endTime: Date.now(),
              };
            }
          } else {
            consecutiveObserveFailures = 0;
          }

          step.status = 'thinking';
          onStep({...step});
        } catch (err) {
          consecutiveObserveFailures++;
          step.status = 'failed';
          step.error =
            err instanceof Error ? err.message : 'Failed to observe screen';
          steps.push(step);
          onStep({...step});
          if (consecutiveObserveFailures >= 3) {
            return {
              success: false,
              steps,
              summary: 'Agent failed to observe the screen repeatedly',
              error: step.error,
              startTime,
              endTime: Date.now(),
            };
          }
          await this.delay(500);
          continue; // Try next step
        }

        // ── THINK ──
        let action: AgentAction;
        try {
          step.rawThinking = '';

          // Only capture a screenshot when the loaded model actually supports
          // vision. Sending an image to a text-only model throws on-device.
          let screenshotPath: string | null = null;
          if (config.useVision && config.includeScreenshots) {
            screenshotPath = await AccessibilityService.takeScreenshotToFile();
          }

          const useVision = screenshotPath != null;
          const prompt = buildActionPrompt(
            instruction,
            step.observation!,
            steps,
            config,
            useVision,
          );

          const onToken = (token: string) => {
            step.rawThinking += token;
            onStep({...step});
          };

          // Vision inference when available, else text-only — with a hard
          // timeout so a stalled model can never hang the whole loop.
          const inference = useVision
            ? LLMService.generateWithVision(prompt, screenshotPath!, onToken)
            : LLMService.generate(prompt, onToken);

          const llmResponse = await this.withTimeout(
            inference,
            config.inferenceTimeoutMs,
          );

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
          if (this.shouldStop) {
            return {
              success: false,
              steps,
              summary: 'Agent was cancelled by user',
              startTime,
              endTime: Date.now(),
            };
          }
          continue;
        }


        // If the user cancelled during inference, stop cleanly here rather
        // than trying to act on a partial/aborted response.
        if (this.shouldStop) {
          return {
            success: false,
            steps,
            summary: 'Agent was cancelled by user',
            startTime,
            endTime: Date.now(),
          };
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

        // ── Loop / stuck detection ──
        // If the agent proposes the exact same interacting action several times
        // in a row, it's almost certainly stuck (the screen isn't changing).
        const signature = actionSignature(action);
        if (signature && signature === lastActionSignature) {
          repeatedActionCount++;
        } else {
          repeatedActionCount = 0;
        }
        lastActionSignature = signature;

        if (signature && repeatedActionCount >= 3) {
          step.status = 'failed';
          step.error = 'Repeated the same action too many times without progress';
          steps.push(step);
          onStep({...step});
          return {
            success: false,
            steps,
            summary:
              'Agent stopped: it kept repeating the same action without the screen changing.',
            error: 'Agent appears stuck',
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
   * For clicks, the native service falls back to a coordinate tap at the
   * node's center when the semantic ACTION_CLICK is rejected.
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

  /**
   * Wraps a promise with a timeout. If it doesn't settle in time, the in-flight
   * LLM generation is stopped and the returned promise rejects. This guarantees
   * a single stalled inference can never hang the observe→think→act loop.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        LLMService.stopGeneration().catch(() => {});
        reject(new Error(`LLM inference timed out after ${ms}ms`));
      }, ms);

      promise.then(
        value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        err => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Builds a stable signature for an interacting action so repeated identical
 * actions can be detected. Terminal / passive actions (done, error, wait)
 * return null so they never trip the stuck detector.
 */
function actionSignature(action: AgentAction): string | null {
  switch (action.type) {
    case 'click':
    case 'long_click':
      return `${action.type}:${action.target}`;
    case 'set_text':
      return `set_text:${action.target}:${action.value}`;
    case 'scroll':
      return `scroll:${action.target}:${action.direction}`;
    case 'tap_coordinates':
      return `tap:${action.x},${action.y}`;
    case 'swipe':
      return `swipe:${action.startX},${action.startY},${action.endX},${action.endY}`;
    case 'back':
      return 'back';
    case 'home':
      return 'home';
    default:
      return null;
  }
}

export const AccessibilityAgent = new AccessibilityAgentImpl();
export default AccessibilityAgent;
