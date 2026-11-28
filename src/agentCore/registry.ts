import type { AgentPlugin, AgentTool, JsonValue, ParameterSchema, ToolContext, ToolResult } from './types';

function validate(value: unknown, schema: ParameterSchema, depth = 0): JsonValue {
  if (depth > 8) throw new Error('Tool arguments are too deeply nested');
  if (schema.enum && !schema.enum.some(item => item === value)) throw new Error('Invalid tool argument value');
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string' || value.length > (schema.maxLength ?? 1000)) break;
      return value.trim();
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value)) ||
        value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) break;
      return value;
    case 'boolean':
      if (typeof value === 'boolean') return value;
      break;
    case 'array':
      if (!Array.isArray(value) || !schema.items || value.length > Math.min(50, schema.maxItems ?? 20)) break;
      return value.map(item => validate(item, schema.items!, depth + 1));
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) break;
      const fields = schema.properties || {};
      const result: Record<string, JsonValue> = Object.create(null);
      for (const [key, item] of Object.entries(value)) {
        if (!Object.prototype.hasOwnProperty.call(fields, key)) throw new Error('Unexpected tool argument');
        result[key] = validate(item, fields[key], depth + 1);
      }
      if (schema.required?.some(key => result[key] === undefined || result[key] === '')) throw new Error('Missing tool argument');
      return result;
    }
  }
  throw new Error('Invalid tool arguments');
}

function utf8Length(text: string): number {
  return Array.from(text).reduce((size, character) => {
    const code = character.codePointAt(0)!;
    return size + (code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4);
  }, 0);
}

export function packToolResult(result: ToolResult, maxBytes: number): ToolResult {
  const packed: ToolResult = { status: result.status, content: '', sources: result.sources?.slice(0, 5) };
  if (utf8Length(JSON.stringify(packed)) > maxBytes) return { status: 'unavailable', content: 'Insufficient context for source metadata.' };
  const points = Array.from(result.content.slice(0, 16000));
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    packed.content = points.slice(0, middle).join('');
    if (utf8Length(JSON.stringify(packed)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  packed.content = points.slice(0, low).join('');
  // 'partial' is longer than 'ok'; reserve it before packing a shortened response.
  if (packed.content.length < result.content.length && result.status === 'ok') {
    return packToolResult({ ...packed, status: 'partial' }, maxBytes);
  }
  return packed;
}

export class ToolRegistry {
  private plugins = new Map<string, AgentPlugin>();
  private tools = new Map<string, AgentTool>();

  register(plugin: AgentPlugin): void {
    if (this.plugins.has(plugin.id)) throw new Error(`Duplicate plugin: ${plugin.id}`);
    const names = new Set<string>();
    plugin.tools.forEach(tool => {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name) || this.tools.has(tool.name) || names.has(tool.name)) {
        throw new Error(`Invalid or duplicate tool: ${tool.name}`);
      }
      names.add(tool.name);
    });
    this.plugins.set(plugin.id, plugin);
    plugin.tools.forEach(tool => this.tools.set(tool.name, tool));
  }

  getPlugins(): AgentPlugin[] {
    return [...this.plugins.values()];
  }

  descriptions() {
    return [...this.tools.values()].map(({ name, description, parameters }) => ({ name, description, parameters }));
  }

  async execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult> {
    if (context.signal.aborted) throw new Error('Task cancelled');
    const tool = this.tools.get(name);
    if (!tool) return { status: 'unavailable', content: 'This capability is not installed.' };
    const args = validate(input, tool.parameters) as Record<string, JsonValue>;
    const result = await tool.execute(args, context);
    if (context.signal.aborted) throw new Error('Task cancelled');
    return packToolResult(result, context.maxResultBytes);
  }
}
