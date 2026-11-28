import type {Agent, AgentAction, AgentConfig, AgentResult, AgentStep} from './types';
import {DEFAULT_AGENT_CONFIG} from './types';
import {buildActionPrompt, parseActionResponse} from './promptBuilder';
import AccessibilityService from '../services/accessibilityService';
import LLMService, {estimateTokens} from '../services/llmService';

class AgentCancelledError extends Error {}

class AccessibilityAgentImpl implements Agent {
  readonly id = 'accessibility-agent';
  readonly name = 'Accessibility Agent';
  readonly description = 'Observes and interacts with the visible Android app using the local model.';
  private shouldStop = false;
  private runningTaskId: string | null = null;

  canHandle(_instruction: string): boolean {
    return true;
  }

  cancel(): void {
    this.shouldStop = true;
    if (this.runningTaskId) LLMService.stopGeneration(this.runningTaskId).catch(() => {});
  }

  async execute(
    instruction: string,
    config: AgentConfig = DEFAULT_AGENT_CONFIG,
    onStep: (step: AgentStep) => void | Promise<void>,
  ): Promise<AgentResult> {
    if (this.runningTaskId) throw new Error('Agent is already running');
    if (!config.taskId) throw new Error('Start the agent through the background task runtime');
    if (!Number.isInteger(config.maxSteps) || config.maxSteps < 1 || config.maxSteps > 100 ||
        !Number.isFinite(config.taskTimeoutMs) || config.taskTimeoutMs <= 0 ||
        !Number.isFinite(config.inferenceTimeoutMs) || config.inferenceTimeoutMs <= 0) {
      throw new Error('Invalid agent execution limits');
    }
    const taskId = config.taskId;
    this.runningTaskId = taskId;
    this.shouldStop = false;
    const startTime = Date.now();
    const deadline = startTime + Math.min(config.taskTimeoutMs, 10 * 60 * 1000);
    const steps: AgentStep[] = [];
    let failures = 0;
    let previousAttempt = '';
    let repeats = 0;

    try {
      await this.waitUntilReady(taskId, deadline);
      if (!await AccessibilityService.isServiceEnabled()) throw new Error('Enable the AOTG accessibility service first');
      if (!await LLMService.isModelLoaded()) throw new Error('Load a local model first');

      // The service has already entered the foreground and started Headless JS.
      const initialScreen = await AccessibilityService.observeScreen(false);
      if (!await AccessibilityService.executeAgentAction(taskId, initialScreen, {type: 'home'})) {
        throw new Error('Could not leave AOTG; the screen changed before the task started');
      }
      await this.delay(1000, taskId, deadline);

      for (let stepIndex = 0; stepIndex < config.maxSteps; stepIndex++) {
        await this.waitUntilReady(taskId, deadline);
        const step: AgentStep = {
          stepIndex, observation: null, reasoning: '', action: null,
          timestamp: Date.now(), status: 'observing',
        };
        await onStep({...step});
        const epoch = (await AccessibilityService.getAgentServiceState()).screenEpoch;
        let action: AgentAction;
        let acceptTokens = true;
        let progressError: unknown;

        try {
          step.observation = await AccessibilityService.observeScreen(false);
          if (step.observation.error || !step.observation.elements.length) {
            throw new Error(step.observation.error || 'No accessible elements on the current screen');
          }
          step.status = 'thinking';
          step.rawThinking = '';
          await onStep({...step});

          const screenshot = config.useVision && config.includeScreenshots
            ? await AccessibilityService.takeScreenshotToFile() : null;
          const visionOverhead = screenshot ? 512 : 0;
          let available = await LLMService.getRemainingContextTokens();
          let maxElements = Math.max(5, Math.min(100, config.maxElementsInPrompt));
          let prompt = buildActionPrompt(instruction, step.observation, steps, {...config, maxElementsInPrompt: maxElements}, !!screenshot);
          if (estimateTokens(prompt) + visionOverhead > available) {
            if (!await LLMService.resetConversation(taskId)) throw new Error('Could not reset the agent conversation');
            available = await LLMService.getRemainingContextTokens();
          }
          while (estimateTokens(prompt) + visionOverhead > available && maxElements > 5) {
            maxElements = Math.max(5, Math.floor(maxElements / 2));
            prompt = buildActionPrompt(instruction, step.observation, steps, {...config, maxElementsInPrompt: maxElements}, !!screenshot);
          }
          if (estimateTokens(prompt) + visionOverhead > available) throw new Error('The instruction and screen exceed the model context');
          await this.waitUntilReady(taskId, deadline);
          if ((await AccessibilityService.getAgentServiceState()).screenEpoch !== epoch) {
            throw new Error('Device state changed; observing again');
          }

          const onToken = (token: string) => {
            if (!acceptTokens || this.shouldStop) return;
            step.rawThinking = (step.rawThinking || '') + token;
            const snapshot = {...step};
            Promise.resolve().then(() => onStep(snapshot)).catch(error => {
              progressError = error;
              this.cancel();
            });
          };
          const inference = screenshot
            ? LLMService.generateWithVision(prompt, screenshot, onToken, taskId)
            : LLMService.generate(prompt, onToken, taskId);
          const response = await this.withTimeout(inference, Math.min(config.inferenceTimeoutMs, deadline - Date.now()), taskId);
          acceptTokens = false;
          if (progressError) throw progressError;
          await this.waitUntilReady(taskId, deadline);
          if ((await AccessibilityService.getAgentServiceState()).screenEpoch !== epoch) {
            throw new Error('Device state changed during inference; observing again');
          }
          action = parseActionResponse(response);
        } catch (error) {
          acceptTokens = false;
          if (progressError) throw progressError;
          await this.waitUntilReady(taskId, deadline);
          step.status = 'failed';
          step.error = error instanceof Error ? error.message : 'Agent inference failed';
          steps.push(step);
          await onStep({...step});
          if (++failures >= 3) throw new Error(step.error);
          continue;
        }

        step.action = action;
        step.reasoning = 'reasoning' in action ? action.reasoning || '' : '';
        if (action.type === 'error') throw new Error(action.message);
        if (action.type === 'done') {
          step.status = 'completed';
          steps.push(step);
          await onStep({...step});
          return {success: true, steps, summary: action.result, startTime, endTime: Date.now()};
        }

        // Repeated scrolls are legitimate when they reveal new content. Count only
        // identical actions on identical observations, excluding timestamps.
        const attempt = JSON.stringify([{...action, reasoning: undefined}, step.observation?.app, step.observation?.elements]);
        repeats = attempt === previousAttempt ? repeats + 1 : 0;
        previousAttempt = attempt;
        if (action.type !== 'wait' && repeats >= 3) throw new Error('Agent stopped after repeated actions without progress');

        step.status = 'executing';
        await onStep({...step}); // Durable checkpoint must succeed BEFORE touching another app.
        await this.waitUntilReady(taskId, deadline);
        try {
          const executed = action.type === 'wait'
            ? await this.delay(action.durationMs, taskId, deadline).then(() => true)
            : await AccessibilityService.executeAgentAction(taskId, step.observation!, action);
          step.status = executed ? 'completed' : 'failed';
          if (!executed) step.error = 'Screen or target changed; observing again';
          failures = executed ? 0 : failures + 1;
        } catch (error) {
          await this.waitUntilReady(taskId, deadline);
          step.status = 'failed';
          step.error = error instanceof Error ? error.message : 'Action failed';
          failures++;
        }
        steps.push(step);
        await onStep({...step});
        if (failures >= 3) throw new Error(step.error || 'Repeated action failures');
        await this.delay(Math.max(0, Math.min(config.stepDelayMs, 5000)), taskId, deadline);
      }
      throw new Error(`Agent reached the maximum of ${config.maxSteps} steps`);
    } catch (error) {
      const cancelled = error instanceof AgentCancelledError;
      return {
        success: false, cancelled, steps,
        summary: cancelled ? 'Agent was cancelled' : error instanceof Error ? error.message : 'Agent failed',
        error: cancelled ? undefined : error instanceof Error ? error.message : 'Agent failed',
        startTime, endTime: Date.now(),
      };
    } finally {
      this.runningTaskId = null;
    }
  }

  private async waitUntilReady(taskId: string, deadline: number): Promise<void> {
    while (true) {
      if (Date.now() >= deadline) throw new Error('Agent task timed out');
      const state = await AccessibilityService.getAgentServiceState();
      if (state.reason === 'timeout' && state.taskId === taskId) throw new Error('Agent task timed out');
      if (this.shouldStop || state.taskId !== taskId || state.cancelled) throw new AgentCancelledError('Agent was cancelled');
      if (!state.paused) return;
      await new Promise<void>(resolve => setTimeout(resolve, 250));
    }
  }

  private async delay(ms: number, taskId: string, deadline: number): Promise<void> {
    const end = Date.now() + Math.max(0, Math.min(ms, 5000));
    do {
      await this.waitUntilReady(taskId, deadline);
      if (Date.now() >= end) return;
      await new Promise<void>(resolve => setTimeout(resolve, Math.min(250, end - Date.now())));
    } while (Date.now() < end);
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, taskId: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        LLMService.stopGeneration(taskId).catch(() => {});
        reject(new Error('Agent inference timed out'));
      }, Math.max(1, ms));
      promise.then(value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }
}

export const AccessibilityAgent = new AccessibilityAgentImpl();
export default AccessibilityAgent;
