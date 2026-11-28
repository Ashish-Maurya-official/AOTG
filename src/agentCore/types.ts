import type { ComponentType } from 'react';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ParameterSchema {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: Array<string | number | boolean>;
  items?: ParameterSchema;
  maxItems?: number;
  properties?: Record<string, ParameterSchema>;
  required?: string[];
  additionalProperties?: false;
}

export interface ToolParameters extends ParameterSchema {
  type: 'object';
  properties: Record<string, ParameterSchema>;
  required: string[];
  additionalProperties: false;
}

export interface EvidenceSource {
  id: string;
  title: string;
  url: string;
  fetchedAt: string;
}

export interface ToolResult {
  status: 'ok' | 'partial' | 'unavailable' | 'no_evidence';
  content: string;
  sources?: EvidenceSource[];
}

export interface ToolContext {
  requestId: string;
  generationId: string;
  signal: AbortSignal;
  maxResultBytes: number;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute(input: Record<string, JsonValue>, context: ToolContext): Promise<ToolResult>;
}

export interface AgentPlugin {
  id: string;
  tools: AgentTool[];
  Settings?: ComponentType;
}

export interface ToolActivity {
  requestId: string;
  generationId: string;
  toolName: string;
  mode: 'chat' | 'live';
  state: 'idle' | 'running' | 'complete' | 'partial' | 'failed' | 'cancelled';
  sources: EvidenceSource[];
}
