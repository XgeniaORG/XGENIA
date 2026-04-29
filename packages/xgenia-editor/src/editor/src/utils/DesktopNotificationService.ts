/**
 * DesktopNotificationService - Handles desktop notifications when app is not focused
 * 
 * Uses the Browser Notification API which works well in Electron apps.
 * Shows notifications when the AI finishes coding tasks while the app is in the background.
 */

import { ipcRenderer } from 'electron';
import * as remote from '@electron/remote';

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  requireInteraction?: boolean;
}

class DesktopNotificationService {
  private static instance: DesktopNotificationService | null = null;
  private isAppFocused: boolean = true;
  private permissionGranted: boolean = false;
  private permissionDenied: boolean = false;

  private constructor() {
    this.setupFocusTracking();
    this.requestPermission();
  }

  public static getInstance(): DesktopNotificationService {
    if (!DesktopNotificationService.instance) {
      DesktopNotificationService.instance = new DesktopNotificationService();
    }
    return DesktopNotificationService.instance;
  }

  /**
   * Setup listeners for app focus/blur events from Electron main process
   */
  private setupFocusTracking(): void {
    if (typeof window === 'undefined' || !window.process?.type) {
      // Not in Electron environment
      return;
    }

    ipcRenderer.on('app-focused', () => {
      this.isAppFocused = true;
    });

    ipcRenderer.on('app-blurred', () => {
      this.isAppFocused = false;
    });

    // Also listen to window focus/blur as fallback
    window.addEventListener('focus', () => {
      this.isAppFocused = true;
    });

    window.addEventListener('blur', () => {
      this.isAppFocused = false;
    });
  }

  /**
   * Request notification permission from the user
   */
  private async requestPermission(): Promise<void> {
    if (typeof Notification === 'undefined') {
      console.warn('[DesktopNotificationService] Notification API not available');
      return;
    }

    if (Notification.permission === 'granted') {
      this.permissionGranted = true;
      return;
    }

    if (Notification.permission === 'denied') {
      this.permissionDenied = true;
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      this.permissionGranted = permission === 'granted';
      this.permissionDenied = permission === 'denied';
    } catch (error: any) {
      console.error('[DesktopNotificationService] Error requesting permission:', error);
    }
  }

  /**
   * Check if notifications are available and permitted
   */
  public canNotify(): boolean {
    if (typeof Notification === 'undefined') {
      return false;
    }

    if (this.permissionDenied) {
      return false;
    }

    return Notification.permission === 'granted' || this.permissionGranted;
  }

  /**
   * Show a desktop notification if the app is not focused
   */
  public notifyIfAppNotFocused(options: NotificationOptions): boolean {
    // Only show notification if app is not focused
    if (this.isAppFocused) {
      return false;
    }

    return this.notify(options);
  }

  /**
   * Show a desktop notification regardless of focus state
   */
  public notify(options: NotificationOptions): boolean {
    if (!this.canNotify()) {
      console.log('[DesktopNotificationService] Cannot notify - permission not granted');
      return false;
    }

    try {
      const notification = new Notification(options.title, {
        body: options.body,
        icon: options.icon || undefined,
        tag: options.tag || 'xgenia-notification',
        requireInteraction: options.requireInteraction || false,
        silent: false
      });

      // Handle notification click - focus the app window
      notification.onclick = () => {
        if (window.process?.type) {
          // Focus the Electron window
          try {
            const currentWindow = remote.getCurrentWindow();
            if (currentWindow) {
              currentWindow.focus();
              currentWindow.show();
            }
          } catch (error: any) {
            console.error('[DesktopNotificationService] Error focusing window:', error);
          }
        }
        notification.close();
      };

      // Auto-close after 5 seconds if not requiring interaction
      if (!options.requireInteraction) {
        setTimeout(() => {
          notification.close();
        }, 5000);
      }

      return true;
    } catch (error: any) {
      console.error('[DesktopNotificationService] Error showing notification:', error);
      return false;
    }
  }

  /**
   * Notify that AI has finished coding
   */
  public notifyAITaskComplete(message?: string): boolean {
    return this.notifyIfAppNotFocused({
      title: 'XGENIA - Task Complete',
      body: message || 'AI has finished coding. Click to return to the app.',
      tag: 'ai-task-complete',
      requireInteraction: false
    });
  }

  /**
   * Notify that AI encountered an error
   */
  public notifyAIError(errorMessage?: string): boolean {
    return this.notifyIfAppNotFocused({
      title: 'XGENIA - Error',
      body: errorMessage || 'An error occurred while processing your request.',
      tag: 'ai-error',
      requireInteraction: true
    });
  }

  /**
   * Get current app focus state
   */
  public getIsAppFocused(): boolean {
    return this.isAppFocused;
  }

  /**
   * Get notification permission status
   */
  public getPermissionStatus(): NotificationPermission {
    if (typeof Notification === 'undefined') {
      return 'denied';
    }
    return Notification.permission;
  }
}

export const desktopNotificationService = DesktopNotificationService.getInstance();

