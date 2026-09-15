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
import LLMService, {estimateTokens} from '../services/llmService';

/** Smallest screen dump we are willing to send before dropping conversation history. */
const MIN_ELEMENTS_IN_PROMPT = 5;

const TAG = '[Agent]';

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
    console.log(`${TAG} ❌ Cancel requested`);
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
      console.warn(`${TAG} ⚠️ Agent is already running, rejecting new execute()`);
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

    console.log(`${TAG} ==============================`);
    console.log(`${TAG} 🚀 Starting agent execution`);
    console.log(`${TAG}   Instruction: "${instruction}"`);
    console.log(`${TAG}   Config: maxSteps=${config.maxSteps}, useVision=${config.useVision}, includeScreenshots=${config.includeScreenshots}`);
    console.log(`${TAG}   maxElementsInPrompt=${config.maxElementsInPrompt}, stepDelayMs=${config.stepDelayMs}, inferenceTimeoutMs=${config.inferenceTimeoutMs}`);
    console.log(`${TAG} ==============================`);

    try {
      // Verify service is enabled
      console.log(`${TAG} 🔍 Checking accessibility service status...`);
      const serviceEnabled = await AccessibilityService.isServiceEnabled();
      console.log(`${TAG}   Service enabled: ${serviceEnabled}`);
      if (!serviceEnabled) {
        console.error(`${TAG} ❌ Accessibility service is NOT enabled — aborting`);
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
      console.log(`${TAG} 🔍 Checking LLM model status...`);
      const llmLoaded = await LLMService.isModelLoaded();
      console.log(`${TAG}   LLM loaded: ${llmLoaded}`);
      if (!llmLoaded) {
        console.error(`${TAG} ❌ No LLM model loaded — aborting`);
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

      // ─── Start foreground service & minimize AOTG ───
      // The foreground service keeps the RN JS thread alive when AOTG
      // is not the active app. We must go to the home screen so the
      // agent can observe and interact with other apps.
      console.log(`${TAG} 📡 Starting foreground service...`);
      const fgStarted = await AccessibilityService.startAgentService();
      console.log(`${TAG}   Foreground service started: ${fgStarted}`);
      console.log(`${TAG} 🏠 Pressing Home to minimize AOTG...`);
      await AccessibilityService.pressHome();
      console.log(`${TAG}   Waiting 1s for home screen to settle...`);
      await this.delay(1000); // Let the home screen settle
      console.log(`${TAG}   ✅ Ready — entering observe→think→act loop`);

      // ─── Main observe → think → act loop ───
      for (let stepIndex = 0; stepIndex < config.maxSteps; stepIndex++) {
        console.log(`${TAG} ──────── Step ${stepIndex + 1}/${config.maxSteps} ────────`);

        if (this.shouldStop) {
          console.log(`${TAG} ⏹️ shouldStop flag set — exiting loop`);
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
          console.log(`${TAG} 👁️ OBSERVE — Fetching accessibility tree...`);
          const observeStart = Date.now();
          // Tree only — the screenshot (when the model supports vision) is
          // captured separately below to avoid grabbing the screen twice.
          const observation = await AccessibilityService.observeScreen(false);
          step.observation = observation;
          const observeMs = Date.now() - observeStart;
          console.log(`${TAG}   App: ${observation.app}`);
          console.log(`${TAG}   Elements: ${observation.elements.length}, totalNodes: ${observation.totalNodes}`);
          console.log(`${TAG}   Observe took: ${observeMs}ms`);
          if (observation.error) {
            console.warn(`${TAG}   ⚠️ Observation error: ${observation.error}`);
          }

          // A persistently empty/errored screen (e.g. no active window) should
          // not spin forever — bail out after several consecutive failures.
          if (observation.error && observation.elements.length === 0) {
            consecutiveObserveFailures++;
            console.warn(`${TAG}   Consecutive observe failures: ${consecutiveObserveFailures}/3`);
            if (consecutiveObserveFailures >= 3) {
              console.error(`${TAG} ❌ 3 consecutive observe failures — aborting`);
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
          const errMsg = err instanceof Error ? err.message : 'Failed to observe screen';
          console.error(`${TAG} ❌ OBSERVE threw: ${errMsg}`);
          console.error(`${TAG}   Consecutive observe failures: ${consecutiveObserveFailures}/3`);
          step.status = 'failed';
          step.error = errMsg;
          steps.push(step);
          onStep({...step});
          if (consecutiveObserveFailures >= 3) {
            console.error(`${TAG} ❌ 3 consecutive observe failures — aborting`);
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
            console.log(`${TAG} 📸 SCREENSHOT — Capturing screenshot to file...`);
            const ssStart = Date.now();
            screenshotPath = await AccessibilityService.takeScreenshotToFile();
            const ssMs = Date.now() - ssStart;
            console.log(`${TAG}   Screenshot result: ${screenshotPath ? screenshotPath : 'FAILED (null)'}`);
            console.log(`${TAG}   Screenshot took: ${ssMs}ms`);
          } else {
            console.log(`${TAG} 📸 SCREENSHOT — Skipped (useVision=${config.useVision}, includeScreenshots=${config.includeScreenshots})`);
          }

          const useVision = screenshotPath != null;

          // ── Context-window budgeting ──
          console.log(`${TAG} 🧠 THINK — Building prompt (useVision=${useVision})...`);
          const remaining = await LLMService.getRemainingContextTokens();
          const visionOverhead = useVision ? 512 : 0;
          let maxElements = config.maxElementsInPrompt;
          let prompt = buildActionPrompt(
            instruction,
            step.observation!,
            steps,
            {...config, maxElementsInPrompt: maxElements},
            useVision,
          );
          const estimatedTokens = estimateTokens(prompt);
          console.log(`${TAG}   Prompt tokens: ~${estimatedTokens}, remaining context: ${remaining}, vision overhead: ${visionOverhead}`);
          while (
            estimateTokens(prompt) + visionOverhead > remaining &&
            maxElements > MIN_ELEMENTS_IN_PROMPT
          ) {
            maxElements = Math.max(MIN_ELEMENTS_IN_PROMPT, Math.floor(maxElements / 2));
            prompt = buildActionPrompt(
              instruction,
              step.observation!,
              steps,
              {...config, maxElementsInPrompt: maxElements},
              useVision,
            );
          }
          if (estimateTokens(prompt) + visionOverhead > remaining) {
            console.warn(`${TAG}   ⚠️ Context window exhausted — resetting conversation before step ${stepIndex}`);
            await LLMService.resetConversation();
            maxElements = config.maxElementsInPrompt;
            prompt = buildActionPrompt(instruction, step.observation!, steps, config, useVision);
          } else if (maxElements !== config.maxElementsInPrompt) {
            console.log(`${TAG}   Trimmed screen dump to ${maxElements} elements to fit context`);
          }
          console.log(`${TAG}   Final prompt length: ${prompt.length} chars, ~${estimateTokens(prompt)} tokens`);

          const onToken = (token: string) => {
            step.rawThinking += token;
            onStep({...step});
          };

          // Vision inference when available, else text-only — with a hard
          // timeout so a stalled model can never hang the whole loop.
          console.log(`${TAG} 🤖 LLM INFERENCE — Starting ${useVision ? 'vision' : 'text-only'} generation (timeout: ${config.inferenceTimeoutMs}ms)...`);
          const inferStart = Date.now();
          const inference = useVision
            ? LLMService.generateWithVision(prompt, screenshotPath!, onToken)
            : LLMService.generate(prompt, onToken);

          const llmResponse = await this.withTimeout(
            inference,
            config.inferenceTimeoutMs,
          );
          const inferMs = Date.now() - inferStart;
          console.log(`${TAG}   LLM response received in ${inferMs}ms`);
          console.log(`${TAG}   Raw response (first 200 chars): ${llmResponse.substring(0, 200)}`);

          action = parseActionResponse(llmResponse);
          console.log(`${TAG}   Parsed action: type=${action.type}`);
          if ('target' in action) console.log(`${TAG}     target: ${(action as any).target}`);
          if ('value' in action) console.log(`${TAG}     value: ${(action as any).value}`);
          if ('reasoning' in action) console.log(`${TAG}     reasoning: ${(action as any).reasoning}`);
          if ('x' in action) console.log(`${TAG}     coords: (${(action as any).x}, ${(action as any).y})`);
          if (action.type === 'done') console.log(`${TAG}     result: ${(action as any).result}`);
          if (action.type === 'error') console.log(`${TAG}     error: ${(action as any).message}`);

          step.action = action;
          step.reasoning = action.type === 'error'
            ? action.message
            : ('reasoning' in action && action.reasoning) || '';
          step.status = 'executing';
          onStep({...step});
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'LLM inference failed';
          console.error(`${TAG} ❌ THINK threw: ${errMsg}`);
          step.status = 'failed';
          step.error = errMsg;
          steps.push(step);
          onStep({...step});
          if (this.shouldStop) {
            console.log(`${TAG} ⏹️ shouldStop flag set after think failure — exiting`);
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
          console.log(`${TAG} ✅ Agent completed task: "${action.result}"`);
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
          console.error(`${TAG} ❌ Agent reported error: "${action.message}"`);
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
          console.log(`${TAG} ⚡ ACT — Executing: ${action.type}`);
          const actStart = Date.now();
          const actionResult = await this.executeAction(action);
          const actMs = Date.now() - actStart;
          console.log(`${TAG}   Action result: ${actionResult} (took ${actMs}ms)`);
          step.status = actionResult ? 'completed' : 'failed';
          if (!actionResult) {
            console.warn(`${TAG}   ⚠️ Action returned false`);
            step.error = 'Action execution returned false';
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Action execution failed';
          console.error(`${TAG} ❌ ACT threw: ${errMsg}`);
          step.status = 'failed';
          step.error = errMsg;
        }

        steps.push(step);
        onStep({...step});
        console.log(`${TAG}   Step ${stepIndex + 1} finished: status=${step.status}`);

        // Wait between steps to let the UI update
        if (config.stepDelayMs > 0 && !this.shouldStop) {
          console.log(`${TAG}   Waiting ${config.stepDelayMs}ms before next step...`);
          await this.delay(config.stepDelayMs);
        }
      }

      // Exceeded max steps
      console.warn(`${TAG} ⚠️ Reached maximum steps (${config.maxSteps}) — stopping`);
      return {
        success: false,
        steps,
        summary: `Agent reached maximum steps (${config.maxSteps}) without completing the task`,
        error: 'Max steps exceeded',
        startTime,
        endTime: Date.now(),
      };
    } finally {
      // Always stop the foreground service when the agent is done
      const totalMs = Date.now() - startTime;
      console.log(`${TAG} 🏁 Agent execution finished (total: ${totalMs}ms, steps: ${steps.length})`);
      console.log(`${TAG} 📡 Stopping foreground service...`);
      await AccessibilityService.stopAgentService().catch(() => {});
      console.log(`${TAG}   Foreground service stopped, isRunning → false`);
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
        console.log(`${TAG}   → click target="${action.target}"`);
        return AccessibilityService.performAction(action.target, 'click');

      case 'long_click':
        console.log(`${TAG}   → long_click target="${action.target}"`);
        return AccessibilityService.performAction(action.target, 'long_click');

      case 'set_text':
        console.log(`${TAG}   → set_text target="${action.target}" value="${action.value}"`);
        return AccessibilityService.performAction(
          action.target,
          'set_text',
          action.value,
        );

      case 'scroll':
        console.log(`${TAG}   → scroll target="${action.target}" direction=${action.direction}`);
        return AccessibilityService.performAction(
          action.target,
          action.direction === 'forward'
            ? 'scroll_forward'
            : 'scroll_backward',
        );

      case 'swipe':
        console.log(`${TAG}   → swipe (${action.startX},${action.startY}) → (${action.endX},${action.endY})`);
        return AccessibilityService.swipe(
          action.startX,
          action.startY,
          action.endX,
          action.endY,
        );

      case 'tap_coordinates':
        console.log(`${TAG}   → tap_coordinates (${action.x}, ${action.y})`);
        return AccessibilityService.tapAtCoordinates(action.x, action.y);

      case 'back':
        console.log(`${TAG}   → pressBack`);
        return AccessibilityService.pressBack();

      case 'home':
        console.log(`${TAG}   → pressHome`);
        return AccessibilityService.pressHome();

      case 'wait':
        console.log(`${TAG}   → wait ${action.durationMs}ms`);
        await this.delay(action.durationMs);
        return true;

      default:
        console.warn(
          `${TAG}   → Unknown action type: ${(action as any).type}`,
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
