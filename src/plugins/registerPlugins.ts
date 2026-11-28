import { ToolRegistry } from '../agentCore/registry';

export async function createToolRegistry(): Promise<ToolRegistry> {
  const registry = new ToolRegistry();
  // A static require is discoverable by Metro and keeps removal to one line.
  registry.register(require('./web').default);
  return registry;
}
