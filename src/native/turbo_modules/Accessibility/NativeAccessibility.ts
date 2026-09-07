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

  // Event emitter support
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Accessibility');
