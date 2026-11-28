import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export interface Spec extends TurboModule {
  // Service status
  isServiceEnabled(): Promise<boolean>;
  openAccessibilitySettings(): void;

  // UI tree extraction
  getUITree(): Promise<string>;

  // Node-based actions
  performAction(
    nodeId: string,
    action: string,
    value: string,
  ): Promise<boolean>;

  // Gesture-based actions (fallback)
  tapAtCoordinates(x: number, y: number): Promise<boolean>;
  swipe(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    durationMs: number,
  ): Promise<boolean>;

  // Global actions
  pressBack(): Promise<boolean>;
  pressHome(): Promise<boolean>;
  pressRecents(): Promise<boolean>;

  // Screenshot
  takeScreenshot(): Promise<string>;
  /** Saves screenshot as JPEG to cache dir and returns the absolute file path */
  takeScreenshotToFile(): Promise<string>;

  // App info
  getCurrentApp(): Promise<string>;

  // Agent foreground service control
  /** Starts a foreground service to keep the RN process alive while the agent runs */
  startAgentService(taskId: string, timeoutMs: number): Promise<boolean>;
  /** Stops the agent foreground service */
  stopAgentService(taskId: string): Promise<boolean>;
  cancelAgentTask(taskId: string): Promise<boolean>;
  getAgentServiceState(): Promise<string>;
  /** Validates the observed screen and task ownership before any UI side effect. */
  executeAgentAction(taskId: string, observation: string, action: string): Promise<boolean>;

  // Event emitter support
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Accessibility');

