import AsyncStorage from '@react-native-async-storage/async-storage';
import type {AgentTask} from '../agents/types';

const STORAGE_KEY = '@aotg/agent_tasks';
const MAX_TASKS = 50;
let writeQueue: Promise<void> = Promise.resolve();

export function isActiveTask(task: AgentTask): boolean {
  return ['starting', 'running', 'paused', 'cancelling'].includes(task.status);
}

export async function loadAgentTasks(): Promise<AgentTask[]> {
  await writeQueue;
  return readTasks();
}

async function readTasks(): Promise<AgentTask[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const tasks: unknown = JSON.parse(raw);
  if (!Array.isArray(tasks) || tasks.some(task =>
    !task || typeof task.id !== 'string' || typeof task.instruction !== 'string' ||
    typeof task.createdAt !== 'number' || !Array.isArray(task.steps) ||
    !task.config || typeof task.status !== 'string',
  )) {
    throw new Error('Saved agent tasks could not be read');
  }
  return tasks as AgentTask[];
}

/** Serialize checkpoints and reject failed writes instead of promising false recovery. */
export function saveAgentTask(task: AgentTask): Promise<void> {
  // Redux may freeze dispatched objects. Persist an independent snapshot and avoid
  // retaining screenshots or the model's streamed reasoning in task history.
  const snapshot: AgentTask = JSON.parse(JSON.stringify({
    ...task,
    steps: task.steps.map(step => ({...step, observation: null, rawThinking: undefined})),
    result: task.result && {
      ...task.result,
      steps: task.result.steps.map(step => ({...step, observation: null, rawThinking: undefined})),
    },
  }));
  const write = writeQueue.then(async () => {
    const tasks = await readTasks();
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(
      [snapshot, ...tasks.filter(saved => saved.id !== snapshot.id)]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_TASKS),
    ));
  });
  writeQueue = write.catch(() => {});
  return write;
}
