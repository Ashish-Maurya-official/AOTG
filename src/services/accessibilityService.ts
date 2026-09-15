/**
 * AccessibilityService — TypeScript wrapper for the NativeAccessibility Turbo Module.
 *
 * Provides a typed, error-handled interface to the native accessibility
 * capabilities. Mirrors the llmService.ts pattern.
 */

import {NativeEventEmitter, Platform} from 'react-native';
import NativeAccessibility from '../native/turbo_modules/Accessibility/NativeAccessibility';
import type {ScreenObservation, ScreenChangedEvent} from '../agents/types';

class AccessibilityServiceImpl {
  private eventEmitter: NativeEventEmitter | null = null;

  constructor() {
    if (Platform.OS === 'android') {
      try {
        this.eventEmitter = new NativeEventEmitter(NativeAccessibility);
      } catch (err) {
        console.warn(
          '[AccessibilityService] Could not initialize NativeEventEmitter:',
          err,
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Service Status
  // ─────────────────────────────────────────────────────────────

  /**
   * Checks if the AOTG AccessibilityService is enabled in system settings.
   */
  async isServiceEnabled(): Promise<boolean> {
    try {
      return await NativeAccessibility.isServiceEnabled();
    } catch (err) {
      console.error('[AccessibilityService] isServiceEnabled error:', err);
      return false;
    }
  }

  /**
   * Opens the Android Accessibility Settings page.
   */
  openAccessibilitySettings(): void {
    try {
      NativeAccessibility.openAccessibilitySettings();
    } catch (err) {
      console.error(
        '[AccessibilityService] openAccessibilitySettings error:',
        err,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Screen Observation
  // ─────────────────────────────────────────────────────────────

  /**
   * Observes the current screen — gets UI tree and optionally a screenshot.
   * This is the primary method used by agents for the "observe" step.
   */
  async observeScreen(
    includeScreenshot: boolean = false,
  ): Promise<ScreenObservation> {
    try {
      const treeJson = await NativeAccessibility.getUITree();
      const tree = JSON.parse(treeJson) as ScreenObservation;

      if (includeScreenshot) {
        try {
          const screenshot = await NativeAccessibility.takeScreenshot();
          tree.screenshotBase64 = screenshot;
        } catch (screenshotErr) {
          console.warn(
            '[AccessibilityService] Screenshot failed (may need API 30+):',
            screenshotErr,
          );
        }
      }

      return tree;
    } catch (err) {
      console.error('[AccessibilityService] observeScreen error:', err);
      return {
        app: 'unknown',
        timestamp: Date.now(),
        elements: [],
        totalNodes: 0,
        error: err instanceof Error ? err.message : 'Failed to observe screen',
      };
    }
  }

  /**
   * Gets the raw UI tree JSON string.
   */
  async getUITree(): Promise<string> {
    return NativeAccessibility.getUITree();
  }

  // ─────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────

  /**
   * Performs an action on a specific accessibility node.
   */
  async performAction(
    nodeId: string,
    action: string,
    value: string = '',
  ): Promise<boolean> {
    try {
      return await NativeAccessibility.performAction(nodeId, action, value);
    } catch (err) {
      console.error(
        `[AccessibilityService] performAction(${nodeId}, ${action}) error:`,
        err,
      );
      return false;
    }
  }

  /**
   * Taps at screen coordinates (gesture-based fallback).
   */
  async tapAtCoordinates(x: number, y: number): Promise<boolean> {
    try {
      return await NativeAccessibility.tapAtCoordinates(x, y);
    } catch (err) {
      console.error(
        `[AccessibilityService] tapAtCoordinates(${x}, ${y}) error:`,
        err,
      );
      return false;
    }
  }

  /**
   * Performs a swipe gesture.
   */
  async swipe(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    durationMs: number = 300,
  ): Promise<boolean> {
    try {
      return await NativeAccessibility.swipe(
        startX,
        startY,
        endX,
        endY,
        durationMs,
      );
    } catch (err) {
      console.error('[AccessibilityService] swipe error:', err);
      return false;
    }
  }

  /**
   * Takes a screenshot and returns base64 encoded JPEG.
   */
  async takeScreenshot(): Promise<string | null> {
    try {
      return await NativeAccessibility.takeScreenshot();
    } catch (err) {
      console.error('[AccessibilityService] takeScreenshot error:', err);
      return null;
    }
  }

  /**
   * Captures a screenshot, saves it to the app cache directory as a JPEG,
   * and returns the absolute file path.
   *
   * This is the preferred method for vision inference — avoids large base64
   * strings on the JS bridge. Returns null if the capture fails.
   */
  async takeScreenshotToFile(): Promise<string | null> {
    try {
      return await NativeAccessibility.takeScreenshotToFile();
    } catch (err) {
      console.warn('[AccessibilityService] takeScreenshotToFile error:', err);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Global Actions
  // ─────────────────────────────────────────────────────────────

  async pressBack(): Promise<boolean> {
    try {
      return await NativeAccessibility.pressBack();
    } catch (err) {
      console.error('[AccessibilityService] pressBack error:', err);
      return false;
    }
  }

  async pressHome(): Promise<boolean> {
    try {
      return await NativeAccessibility.pressHome();
    } catch (err) {
      console.error('[AccessibilityService] pressHome error:', err);
      return false;
    }
  }

  async pressRecents(): Promise<boolean> {
    try {
      return await NativeAccessibility.pressRecents();
    } catch (err) {
      console.error('[AccessibilityService] pressRecents error:', err);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // App Info
  // ─────────────────────────────────────────────────────────────

  async getCurrentApp(): Promise<string> {
    try {
      return await NativeAccessibility.getCurrentApp();
    } catch (err) {
      console.error('[AccessibilityService] getCurrentApp error:', err);
      return 'unknown';
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Agent Foreground Service
  // ─────────────────────────────────────────────────────────────

  /**
   * Starts a foreground service to keep the RN process alive while the
   * agent operates in the background (observing and interacting with
   * other apps).
   */
  async startAgentService(): Promise<boolean> {
    try {
      return await NativeAccessibility.startAgentService();
    } catch (err) {
      console.error('[AccessibilityService] startAgentService error:', err);
      return false;
    }
  }

  /**
   * Stops the agent foreground service. Should be called when the agent
   * execution completes, fails, or is cancelled.
   */
  async stopAgentService(): Promise<boolean> {
    try {
      return await NativeAccessibility.stopAgentService();
    } catch (err) {
      console.error('[AccessibilityService] stopAgentService error:', err);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Event Subscriptions
  // ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to screen change events.
   * Fires when the foreground app's window state changes.
   */
  onScreenChanged(
    callback: (event: ScreenChangedEvent) => void,
  ): {remove: () => void} | null {
    if (!this.eventEmitter) return null;
    return this.eventEmitter.addListener('onScreenChanged', callback);
  }

  /**
   * Subscribe to service connection events.
   */
  onServiceConnected(callback: () => void): {remove: () => void} | null {
    if (!this.eventEmitter) return null;
    return this.eventEmitter.addListener('onServiceConnected', callback);
  }

  /**
   * Subscribe to service disconnection events.
   */
  onServiceDisconnected(callback: () => void): {remove: () => void} | null {
    if (!this.eventEmitter) return null;
    return this.eventEmitter.addListener('onServiceDisconnected', callback);
  }
}

export const AccessibilityService = new AccessibilityServiceImpl();
export default AccessibilityService;

