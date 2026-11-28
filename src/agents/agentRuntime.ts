import AccessibilityService from '../services/accessibilityService';
import LLMService from '../services/llmService';
import {isActiveTask, loadAgentTasks, saveAgentTask} from '../services/agentTaskStorageService';
import {store} from '../store/store';
import {restoreTask, setTaskStatus, updateStep} from '../store/slices/agentSlice';
import agentOrchestrator from './agentOrchestrator';
import {DEFAULT_AGENT_CONFIG} from './types';
import type {AgentConfig, AgentResult, AgentServiceState, AgentStep, AgentTask} from './types';

/** The screen submits tasks; only the registered headless task executes them. */
export class AgentRuntime {
  private activeTaskId: string | null = null;
  private runningTaskId: string | null = null;
  private restorePromise: Promise<void> | null = null;
  private cancelledTasks = new Set<string>();
  private sequence = 0;

  restore(): Promise<void> {
    if (!this.restorePromise) {
      this.restorePromise = this.restoreSavedTasks().catch(error => {
        this.restorePromise = null;
        throw error;
      });
    }
    return this.restorePromise;
  }

  private async restoreSavedTasks(): Promise<void> {
    const native = await AccessibilityService.getAgentServiceState();
    const tasks = await loadAgentTasks();
    for (const task of tasks) {
      if (isActiveTask(task) && task.id !== native.taskId && task.id !== this.activeTaskId) {
        task.status = 'interrupted';
        task.updatedAt = Date.now();
        task.result = {
          success: false,
          steps: task.steps,
          summary: 'Task was interrupted. Review the target app before starting another task.',
          startTime: task.createdAt,
          endTime: task.updatedAt,
        };
        await saveAgentTask(task);
      }
    }
    const latest = tasks.find(task => task.id === native.taskId) || tasks[0];
    if (latest && !this.activeTaskId && !this.runningTaskId) {
      store.dispatch(restoreTask(latest));
    }
  }

  async start(instruction: string, modelId: string, config: AgentConfig = DEFAULT_AGENT_CONFIG): Promise<string> {
    if (this.activeTaskId || this.runningTaskId) throw new Error('An agent task is already running');
    if (!instruction.trim()) throw new Error('Enter an instruction first');
    const id = `${Date.now()}-${++this.sequence}-${Math.random().toString(36).slice(2, 10)}`;
    this.activeTaskId = id; // Reserve before the first await, including while storage loads.
    let task: AgentTask | null = null;
    let claimed = false;
    try {
      await this.restore();
      const native = await AccessibilityService.getAgentServiceState();
      if (native.taskId) throw new Error('An agent task is already running');
      const agent = agentOrchestrator.routeInstruction(instruction);
      if (!agent) throw new Error('No agent can handle this instruction');
      task = {
        id, instruction: instruction.trim(), agentId: agent.id, modelId,
        config: {...config, taskId: id}, status: 'starting',
        createdAt: Date.now(), updatedAt: Date.now(), steps: [], result: null,
      };
      store.dispatch(restoreTask({...task}));
      await saveAgentTask(task);
      claimed = await LLMService.claimAgentSession(id);
      if (!claimed) throw new Error('Could not reserve the local model');
      if (this.cancelledTasks.has(id)) throw new Error('Task cancelled before startup');
      if (!await AccessibilityService.startAgentService(id, config.taskTimeoutMs)) {
        throw new Error('The background agent service could not start');
      }
      if (this.cancelledTasks.has(id)) await AccessibilityService.cancelAgentTask(id);
      return id;
    } catch (error) {
      if (task) {
        const result: AgentResult = {
          success: false, cancelled: this.cancelledTasks.has(id), steps: [],
          summary: error instanceof Error ? error.message : 'Agent startup failed',
          startTime: task.createdAt, endTime: Date.now(),
        };
        await this.finish(task, result).catch(storageError => {
          console.error('[AgentRuntime] Could not persist startup failure:', storageError);
        });
      }
      if (claimed) await LLMService.releaseAgentSession(id).catch(() => {});
      await AccessibilityService.stopAgentService(id).catch(() => {});
      if (this.activeTaskId === id) this.activeTaskId = null;
      this.cancelledTasks.delete(id);
      throw error;
    }
  }

  async cancel(taskId: string): Promise<void> {
    this.cancelledTasks.add(taskId);
    store.dispatch(setTaskStatus({taskId, status: 'cancelling'}));
    await AccessibilityService.cancelAgentTask(taskId);
    if (this.runningTaskId === taskId) agentOrchestrator.cancel();
  }

  async run(taskId: string): Promise<void> {
    if (this.runningTaskId) return; // Duplicate service deliveries must never start another loop.
    this.runningTaskId = taskId;
    this.activeTaskId = taskId;
    let task: AgentTask | undefined;
    let control: {remove: () => void} | null = null;
    let checkpointError: unknown;
    try {
      task = (await loadAgentTasks()).find(saved => saved.id === taskId);
      if (!task || !isActiveTask(task)) return;
      const state = await AccessibilityService.getAgentServiceState();
      if (state.taskId !== taskId) throw new Error('The agent service is no longer running');
      if (this.cancelledTasks.has(taskId) || state.cancelled) {
        const timedOut = state.reason === 'timeout';
        await this.finish(task, {
          success: false, cancelled: !timedOut, steps: task.steps,
          summary: timedOut ? 'Agent task timed out' : 'Agent was cancelled',
          error: timedOut ? 'Task timeout' : undefined,
          startTime: task.createdAt, endTime: Date.now(),
        });
        return;
      }
      task = {...task, status: state.paused ? 'paused' : 'running', updatedAt: Date.now()};
      await saveAgentTask(task);
      store.dispatch(restoreTask({...task, steps: [...task.steps]}));

      const onControl = (event: AgentServiceState) => {
        if (event.taskId !== taskId || !task) return;
        if (event.cancelled) {
          if (event.reason === 'cancelled') this.cancelledTasks.add(taskId);
          agentOrchestrator.cancel();
        }
        task = {...task, status: event.cancelled ? 'cancelling' : event.paused ? 'paused' : 'running', updatedAt: Date.now()};
        store.dispatch(setTaskStatus({taskId, status: task.status}));
        saveAgentTask(task).catch(error => {
          checkpointError = error;
          agentOrchestrator.cancel();
        });
      };
      control = AccessibilityService.onAgentControl(onControl);

      const onStep = (step: AgentStep): void | Promise<void> => {
        if (!task || this.runningTaskId !== taskId) return;
        if (checkpointError) throw checkpointError;
        // Copy before Redux freezes a payload still used by the running agent.
        const snapshot = {...step};
        const existing = task.steps.findIndex(saved => saved.stepIndex === step.stepIndex);
        task = {...task, updatedAt: Date.now(), steps: existing < 0
          ? [...task.steps, snapshot]
          : task.steps.map(saved => saved.stepIndex === step.stepIndex ? snapshot : saved)};
        store.dispatch(updateStep({taskId, step: snapshot}));
        // Streaming tokens are UI-only. The executing checkpoint is awaited before a side effect.
        if (step.status !== 'thinking') return saveAgentTask(task);
      };

      let result = await agentOrchestrator.execute(task.instruction, onStep, task.config, task.agentId);
      const endState = await AccessibilityService.getAgentServiceState();
      if (checkpointError) throw checkpointError;
      if (endState.taskId === taskId && endState.reason === 'timeout') {
        result = {...result, success: false, cancelled: false, summary: 'Agent task timed out', error: 'Task timeout'};
      } else if (this.cancelledTasks.has(taskId)) {
        result = {...result, success: false, cancelled: true, summary: 'Agent was cancelled'};
      }
      control?.remove();
      control = null;
      await this.finish(task, result);
    } catch (error) {
      control?.remove();
      control = null;
      if (task) {
        await this.finish(task, {
          success: false, cancelled: this.cancelledTasks.has(taskId), steps: task.steps,
          summary: error instanceof Error ? error.message : 'Agent execution failed',
          error: error instanceof Error ? error.message : 'Agent execution failed',
          startTime: task.createdAt, endTime: Date.now(),
        }).catch(storageError => console.error('[AgentRuntime] Could not save task result:', storageError));
      }
    } finally {
      control?.remove();
      await LLMService.releaseAgentSession(taskId).catch(error => console.error('[AgentRuntime] Model cleanup:', error));
      await AccessibilityService.stopAgentService(taskId).catch(error => console.error('[AgentRuntime] Service cleanup:', error));
      this.cancelledTasks.delete(taskId);
      if (this.activeTaskId === taskId) this.activeTaskId = null;
      if (this.runningTaskId === taskId) this.runningTaskId = null;
    }
  }

  private async finish(task: AgentTask, result: AgentResult): Promise<void> {
    const completed: AgentTask = {...task, result, steps: result.steps, updatedAt: Date.now(),
      status: result.cancelled ? 'cancelled' : result.success ? 'completed' : 'failed'};
    store.dispatch(restoreTask(completed));
    await saveAgentTask(completed);
  }
}

export const agentRuntime = new AgentRuntime();
