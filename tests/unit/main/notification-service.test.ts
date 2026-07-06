// @vitest-environment node
//
// UX-29: the app had ZERO native OS notifications before this. These tests
// prove notification-service.ts's small surface behaves correctly:
//   - each notify* method fires a real `new Notification(...)` with sensible
//     title/body when notifications are enabled AND the platform supports
//     them, and clicking it focuses/shows the main window;
//   - the Settings opt-out (configManager.getNotificationsEnabled()) fully
//     suppresses every method — no Notification is ever constructed;
//   - Notification.isSupported() === false (e.g. a headless/CI environment)
//     also fully suppresses every method, and — critically — never throws,
//     since these are ambient polish and must never break the sync/upload
//     flow that triggers them.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
  const notificationInstances: Array<{
    title: string;
    body: string;
    show: ReturnType<typeof vi.fn>;
    clickHandler: (() => void) | null;
  }> = [];

  // Mutable flag so a single test can make the NEXT construction throw
  // (simulating a real platform-level notification failure) without needing
  // to swap out the class binding notification-service.ts already imported.
  const state = { throwOnConstruct: false };

  class MockNotification {
    static isSupported = vi.fn(() => true);
    show = vi.fn();
    private clickHandler: (() => void) | null = null;

    constructor(public options: { title: string; body: string }) {
      if (state.throwOnConstruct) {
        throw new Error('platform notification daemon unavailable');
      }
      notificationInstances.push({
        title: options.title,
        body: options.body,
        show: this.show,
        clickHandler: null,
      });
    }

    on(event: string, handler: () => void) {
      if (event === 'click') {
        this.clickHandler = handler;
        // Record the handler on the last pushed instance so tests can invoke it.
        notificationInstances[notificationInstances.length - 1].clickHandler = handler;
      }
    }
  }

  const windowInstance = {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };

  const getAllWindows = vi.fn(() => [windowInstance]);

  return { notificationInstances, MockNotification, windowInstance, getAllWindows, state };
});

vi.mock('electron', () => ({
  Notification: h.MockNotification,
  BrowserWindow: { getAllWindows: h.getAllWindows },
}));

const cfg = vi.hoisted(() => ({
  getNotificationsEnabled: vi.fn(() => true),
}));

vi.mock('../../../src/main/config-manager', () => ({
  configManager: cfg,
}));

import { notificationService } from '../../../src/main/notification-service';

describe('NotificationService (UX-29)', () => {
  beforeEach(() => {
    h.notificationInstances.length = 0;
    h.MockNotification.isSupported.mockReset().mockReturnValue(true);
    h.windowInstance.isDestroyed.mockReset().mockReturnValue(false);
    h.windowInstance.isMinimized.mockReset().mockReturnValue(false);
    h.windowInstance.restore.mockReset();
    h.windowInstance.show.mockReset();
    h.windowInstance.focus.mockReset();
    h.getAllWindows.mockReset().mockReturnValue([h.windowInstance]);
    cfg.getNotificationsEnabled.mockReset().mockReturnValue(true);
    h.state.throwOnConstruct = false;
  });

  describe('fires when enabled and supported', () => {
    it('notifySyncComplete shows a completion notification with the file count', () => {
      notificationService.notifySyncComplete(12);

      expect(h.notificationInstances).toHaveLength(1);
      expect(h.notificationInstances[0].body).toContain('12');
      expect(h.notificationInstances[0].body.toLowerCase()).toContain('sync complete');
      expect(h.notificationInstances[0].show).toHaveBeenCalledTimes(1);
    });

    it('notifySyncComplete with zero files reads as "up to date", not a fabricated count', () => {
      notificationService.notifySyncComplete(0);

      expect(h.notificationInstances[0].body).not.toContain('0 file');
      expect(h.notificationInstances[0].body.toLowerCase()).toContain('up to date');
    });

    it('notifyUploadComplete shows the uploaded file name (honest copy — no secrets)', () => {
      notificationService.notifyUploadComplete('report.pdf');

      expect(h.notificationInstances).toHaveLength(1);
      expect(h.notificationInstances[0].body).toBe('report.pdf');
    });

    it('notifySyncError shows the error message', () => {
      notificationService.notifySyncError('Gateway unreachable');

      expect(h.notificationInstances).toHaveLength(1);
      expect(h.notificationInstances[0].body).toBe('Gateway unreachable');
      expect(h.notificationInstances[0].title.toLowerCase()).toContain('error');
    });

    it('notifyApprovalNeeded pluralizes correctly', () => {
      notificationService.notifyApprovalNeeded(1);
      expect(h.notificationInstances[0].body).toContain('1 file is waiting');

      notificationService.notifyApprovalNeeded(3);
      expect(h.notificationInstances[1].body).toContain('3 files are waiting');
    });

    it('clicking the notification focuses/shows the main window', () => {
      notificationService.notifyUploadComplete('report.pdf');

      const clickHandler = h.notificationInstances[0].clickHandler;
      expect(clickHandler).toBeTypeOf('function');
      clickHandler!();

      expect(h.windowInstance.show).toHaveBeenCalledTimes(1);
      expect(h.windowInstance.focus).toHaveBeenCalledTimes(1);
    });

    it('clicking restores a minimized window before showing/focusing it', () => {
      h.windowInstance.isMinimized.mockReturnValue(true);
      notificationService.notifySyncError('boom');

      h.notificationInstances[0].clickHandler!();

      expect(h.windowInstance.restore).toHaveBeenCalledTimes(1);
      expect(h.windowInstance.show).toHaveBeenCalledTimes(1);
    });

    it('click handler is a no-op when there is no live window (never throws)', () => {
      h.getAllWindows.mockReturnValue([]);
      notificationService.notifySyncError('boom');

      expect(() => h.notificationInstances[0].clickHandler!()).not.toThrow();
    });
  });

  describe('suppressed when notifications are disabled (Settings opt-out)', () => {
    it('does not construct a Notification for any method when disabled', () => {
      cfg.getNotificationsEnabled.mockReturnValue(false);

      notificationService.notifySyncComplete(5);
      notificationService.notifyUploadComplete('file.txt');
      notificationService.notifySyncError('oops');
      notificationService.notifyApprovalNeeded(2);

      expect(h.notificationInstances).toHaveLength(0);
    });
  });

  describe('suppressed when the platform does not support notifications', () => {
    it('Notification.isSupported() === false -> no Notification is constructed, and it never throws', () => {
      h.MockNotification.isSupported.mockReturnValue(false);

      expect(() => {
        notificationService.notifySyncComplete(5);
        notificationService.notifyUploadComplete('file.txt');
        notificationService.notifySyncError('oops');
        notificationService.notifyApprovalNeeded(2);
      }).not.toThrow();

      expect(h.notificationInstances).toHaveLength(0);
      // The unsupported check must short-circuit BEFORE the config lookup.
      expect(cfg.getNotificationsEnabled).not.toHaveBeenCalled();
    });
  });

  describe('never throws even if the underlying Electron call fails', () => {
    it('a throwing Notification constructor does not propagate', () => {
      h.MockNotification.isSupported.mockReturnValue(true);
      // Make the next construction throw, mirroring a real platform-level
      // notification failure (e.g. the DBus/notification daemon is down).
      h.state.throwOnConstruct = true;

      expect(() => notificationService.notifySyncError('boom')).not.toThrow();
      expect(h.notificationInstances).toHaveLength(0);
    });
  });
});
