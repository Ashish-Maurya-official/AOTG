/**
 * AgentOrchestrator — Agent registry and routing system.
 *
 * This is the main extension point for adding new agents.
 * Each agent registers itself, and the orchestrator routes
 * user instructions to the most appropriate agent.
 *
 * Usage:
 *   import { agentOrchestrator } from './agentOrchestrator';
 *   agentOrchestrator.registerAgent(myNewAgent);
 *   const result = await agentOrchestrator.execute("Open Amazon", onStep);
 */

import type {
  Agent,
  AgentConfig,
  AgentStep,
  AgentResult,
} from './types';
import {DEFAULT_AGENT_CONFIG} from './types';
import {AccessibilityAgent} from './accessibilityAgent';

class AgentOrchestratorImpl {
  private agents: Map<string, Agent> = new Map();
  private currentAgent: Agent | null = null;

  constructor() {
    // Register the built-in accessibility agent
    this.registerAgent(AccessibilityAgent);
  }

  // ─────────────────────────────────────────────────────────────
  // Agent Registry
  // ─────────────────────────────────────────────────────────────

  /**
   * Registers a new agent with the orchestrator.
   * If an agent with the same ID already exists, it will be replaced.
   */
  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    console.log(
      `[AgentOrchestrator] Registered agent: ${agent.id} (${agent.name})`,
    );
  }

  /**
   * Unregisters an agent by ID.
   */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    console.log(`[AgentOrchestrator] Unregistered agent: ${agentId}`);
  }

  /**
   * Returns all registered agents.
   */
  getAvailableAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Gets a specific agent by ID.
   */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  // ─────────────────────────────────────────────────────────────
  // Instruction Routing
  // ─────────────────────────────────────────────────────────────

  /**
   * Finds the best agent for the given instruction.
   * Iterates through registered agents and returns the first
   * one that reports it can handle the instruction.
   *
   * The accessibility agent is the catch-all default.
   */
  routeInstruction(instruction: string): Agent | null {
    // Check specialized agents first (non-accessibility ones)
    for (const agent of this.agents.values()) {
      if (agent.id !== 'accessibility-agent' && agent.canHandle(instruction)) {
        return agent;
      }
    }

    // Fall back to the default accessibility agent
    const defaultAgent = this.agents.get('accessibility-agent');
    if (defaultAgent?.canHandle(instruction)) {
      return defaultAgent;
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────
  // Execution
  // ─────────────────────────────────────────────────────────────

  /**
   * Routes and executes an instruction with the best available agent.
   */
  async execute(
    instruction: string,
    onStep: (step: AgentStep) => void,
    config: AgentConfig = DEFAULT_AGENT_CONFIG,
    agentId?: string,
  ): Promise<AgentResult> {
    // Use specified agent or auto-route
    let agent: Agent | null = null;
    if (agentId) {
      agent = this.agents.get(agentId) || null;
    }
    if (!agent) {
      agent = this.routeInstruction(instruction);
    }

    if (!agent) {
      return {
        success: false,
        steps: [],
        summary: 'No agent available to handle this instruction',
        error: 'No suitable agent found',
        startTime: Date.now(),
        endTime: Date.now(),
      };
    }

    this.currentAgent = agent;
    console.log(
      `[AgentOrchestrator] Routing to agent: ${agent.id} (${agent.name})`,
    );

    try {
      const result = await agent.execute(instruction, config, onStep);
      return result;
    } finally {
      this.currentAgent = null;
    }
  }

  /**
   * Cancels the currently running agent execution.
   */
  cancel(): void {
    if (this.currentAgent) {
      console.log(
        `[AgentOrchestrator] Cancelling agent: ${this.currentAgent.id}`,
      );
      this.currentAgent.cancel();
    }
  }

  /**
   * Returns true if an agent is currently executing.
   */
  isRunning(): boolean {
    return this.currentAgent !== null;
  }

  /**
   * Returns the currently running agent, if any.
   */
  getCurrentAgent(): Agent | null {
    return this.currentAgent;
  }
}

export const agentOrchestrator = new AgentOrchestratorImpl();
export default agentOrchestrator;
