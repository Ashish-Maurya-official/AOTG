import { packToolResult, ToolRegistry } from '../registry';
import type { AgentPlugin, JsonValue, ToolContext } from '../types';

const execute = jest.fn(async (_input: Record<string, JsonValue>, _context: ToolContext) => ({ status: 'ok' as const, content: 'Evidence' }));
const plugin: AgentPlugin = { id: 'test', tools: [{ name: 'test_read', description: 'Read',
  parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL', maxLength: 30 } }, required: ['url'], additionalProperties: false }, execute,
}] };
const context = (): ToolContext => ({ requestId: 'request', generationId: 'turn', signal: new AbortController().signal, maxResultBytes: 1000 });

beforeEach(() => execute.mockClear());

it('validates model arguments before invoking a tool', async () => {
  const registry = new ToolRegistry();
  registry.register(plugin);
  for (const input of [null, [], {}, { url: 1 }, { url: 'x'.repeat(31) }, { url: 'url', extra: 'bad' }, JSON.parse('{"url":"url","__proto__":"bad"}'), { url: 'url', toString: 'bad' }]) {
    await expect(registry.execute('test_read', input, context())).rejects.toThrow();
  }
  expect(execute).not.toHaveBeenCalled();
  await registry.execute('test_read', { url: '  https://example.com  ' }, context());
  expect(execute.mock.calls[0][0]).toEqual({ url: 'https://example.com' });
});

it('returns capability unavailable after removal without invoking any other agent', async () => {
  const registry = new ToolRegistry();
  expect(registry.descriptions()).toEqual([]);
  await expect(registry.execute('web_read', { url: 'https://example.com' }, context())).resolves.toMatchObject({ status: 'unavailable' });
});

it('rejects duplicate registrations atomically and caps tool output', async () => {
  const registry = new ToolRegistry();
  registry.register(plugin);
  expect(() => registry.register(plugin)).toThrow('Duplicate');
  expect(() => registry.register({ ...plugin, id: 'other' })).toThrow('duplicate');
  expect(registry.getPlugins()).toHaveLength(1);
  const packed = packToolResult({ status: 'ok', content: 'दिल्ली मौसम 😀 '.repeat(200) }, 256);
  expect(require('buffer').Buffer.byteLength(JSON.stringify(packed), 'utf8')).toBeLessThanOrEqual(256);
  expect(packed.status).toBe('partial');
});

it('rejects cancellation before executing or accepting a delayed result', async () => {
  const controller = new AbortController();
  const registry = new ToolRegistry();
  registry.register({ id: 'slow', tools: [{ ...plugin.tools[0], execute: async () => {
    controller.abort();
    return { status: 'ok', content: 'Late answer' };
  } }] });
  await expect(registry.execute('test_read', { url: 'url' }, { ...context(), signal: controller.signal })).rejects.toThrow('cancelled');
});

it('supports future function arguments without editing the registry', async () => {
  const registry = new ToolRegistry();
  registry.register({ id: 'calculator', tools: [{ name: 'calculate', description: 'Calculate', parameters: {
    type: 'object', properties: { count: { type: 'integer', minimum: 0, maximum: 5 },
      round: { type: 'boolean' }, values: { type: 'array', maxItems: 3, items: { type: 'number' } } },
    required: ['count', 'round', 'values'], additionalProperties: false,
  }, execute }] });
  await registry.execute('calculate', { count: 0, round: false, values: [1, 2.5] }, context());
  expect(execute).toHaveBeenCalledWith({ count: 0, round: false, values: [1, 2.5] }, expect.anything());
  for (const count of [-1, 6, 1.5, NaN, '2']) {
    await expect(registry.execute('calculate', { count, round: true, values: [] }, context())).rejects.toThrow();
  }
});
