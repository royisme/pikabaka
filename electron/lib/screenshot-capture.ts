import { screen } from "electron"
import type { AppState } from "../main"

type ScreenshotWindowMode = 'launcher' | 'overlay';
type ScreenshotCaptureKind = 'full' | 'selective';

interface ScreenshotCaptureSession {
  captureKind: ScreenshotCaptureKind;
  wasMainWindowVisible: boolean;
  windowMode: ScreenshotWindowMode;
  wasSettingsVisible: boolean;
  wasModelSelectorVisible: boolean;
  overlayBounds: Electron.Rectangle | null;
  overlayDisplayId: number | null;
  restoreWithoutFocus: boolean;
}

let screenshotCaptureInProgress = false;

function createScreenshotCaptureSession(
  appState: AppState,
  captureKind: ScreenshotCaptureKind,
  restoreFocus: boolean
): ScreenshotCaptureSession {
  const settingsWindow = appState.settingsWindowHelper.getSettingsWindow();
  const modelSelectorWindow = appState.modelSelectorWindowHelper.getWindow();

  return {
    captureKind,
    wasMainWindowVisible: appState.windowHelper.isVisible(),
    windowMode: appState.windowHelper.getCurrentWindowMode(),
    wasSettingsVisible: !!settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible(),
    wasModelSelectorVisible: !!modelSelectorWindow && !modelSelectorWindow.isDestroyed() && modelSelectorWindow.isVisible(),
    overlayBounds: appState.windowHelper.getLastOverlayBounds(),
    overlayDisplayId: appState.windowHelper.getLastOverlayDisplayId(),
    restoreWithoutFocus: process.platform === 'darwin' || !restoreFocus
  };
}

function getDisplayById(displayId: number | null): Electron.Display | undefined {
  if (displayId === null) return undefined;
  return screen.getAllDisplays().find(display => display.id === displayId);
}

function getTargetDisplayForFullScreenshot(session: ScreenshotCaptureSession): Electron.Display {
  if (session.windowMode === 'overlay' && session.overlayBounds) {
    return screen.getDisplayMatching(session.overlayBounds);
  }

  const lastOverlayDisplay = getDisplayById(session.overlayDisplayId);
  if (lastOverlayDisplay) {
    return lastOverlayDisplay;
  }

  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function hideWindowsForScreenshot(appState: AppState, session: ScreenshotCaptureSession): void {
  if (session.wasModelSelectorVisible) {
    appState.modelSelectorWindowHelper.hideWindow();
  }

  if (session.wasSettingsVisible) {
    appState.settingsWindowHelper.closeWindow();
  }

  if (session.wasMainWindowVisible) {
    appState.hideMainWindow();
  }
}

function restoreWindowsAfterScreenshot(appState: AppState, session: ScreenshotCaptureSession): void {
  const activate = !session.restoreWithoutFocus;
  const shouldRestoreMainWindow = session.wasMainWindowVisible;

  if (shouldRestoreMainWindow) {
    if (session.windowMode === 'overlay') {
      appState.windowHelper.switchToOverlay(!activate);
    } else {
      appState.windowHelper.switchToLauncher(!activate);
    }
  }

  if (session.wasSettingsVisible) {
    const settingsWindow = appState.settingsWindowHelper.getSettingsWindow();
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      const { x, y } = settingsWindow.getBounds();
      appState.settingsWindowHelper.showWindow(x, y, { activate });
    }
  }

  if (session.wasModelSelectorVisible) {
    const modelSelectorWindow = appState.modelSelectorWindowHelper.getWindow();
    if (modelSelectorWindow && !modelSelectorWindow.isDestroyed()) {
      const { x, y } = modelSelectorWindow.getBounds();
      appState.modelSelectorWindowHelper.showWindow(x, y, { activate });
    }
  }
}

async function withScreenshotCaptureSession<T>(
  appState: AppState,
  captureKind: ScreenshotCaptureKind,
  restoreFocus: boolean,
  capture: (session: ScreenshotCaptureSession) => Promise<T>
): Promise<T> {
  if (!appState.getMainWindow()) {
    throw new Error("No main window available");
  }

  if (screenshotCaptureInProgress) {
    throw new Error("Screenshot capture already in progress");
  }

  const session = createScreenshotCaptureSession(appState, captureKind, restoreFocus);
  screenshotCaptureInProgress = true;

  try {
    hideWindowsForScreenshot(appState, session);
    await new Promise(resolve => setTimeout(resolve, 50));
    return await capture(session);
  } finally {
    try {
      restoreWindowsAfterScreenshot(appState, session);
    } finally {
      screenshotCaptureInProgress = false;
    }
  }
}

export async function takeScreenshot(appState: AppState, restoreFocus: boolean = true): Promise<string> {
  return withScreenshotCaptureSession(appState, 'full', restoreFocus, (session) =>
    appState.screenshotHelper.takeScreenshot(getTargetDisplayForFullScreenshot(session))
  )
}

export async function takeSelectiveScreenshot(appState: AppState, restoreFocus: boolean = true): Promise<string> {
  return withScreenshotCaptureSession(appState, 'selective', restoreFocus, async () => {
    let captureArea: Electron.Rectangle | undefined;

    if (process.platform === 'win32' || process.platform === 'darwin') {
      captureArea = await appState.cropperWindowHelper.showCropper() ?? undefined;

      if (!captureArea) {
        throw new Error("Selection cancelled");
      }
    }

    return appState.screenshotHelper.takeSelectiveScreenshot(captureArea)
  })
}
