import { app, Menu, Tray, nativeImage } from "electron"
import fs from "fs"
import path from "path"
import { KeybindManager } from "../services/KeybindManager"
import type { AppState } from "../main"

export function createTray(appState: AppState): void {
  showTray(appState);
}

export function showTray(appState: AppState): void {
  const state = appState as any;

  if (state.tray) return;

  const resourcesPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const candidates = [
    path.join(resourcesPath, 'assets', 'icon.png'),
    path.join(app.getAppPath(), 'assets', 'icon.png'),
    path.join(app.getAppPath(), 'src', 'components', 'icon.png'),
  ];

  let iconToUse = candidates[0];
  try {
    const found = candidates.find((p) => fs.existsSync(p));
    if (found) {
      iconToUse = found;
      console.log('[Tray] Using app icon:', iconToUse);
    } else {
      console.warn('[Tray] No icon.png found in candidates, trying first path:', iconToUse);
    }
  } catch (e) {
    console.error('[Tray] Error resolving icon:', e);
  }

  const trayIcon = nativeImage.createFromPath(iconToUse).resize({ width: 18, height: 18 });
  trayIcon.setTemplateImage(false);

  state.tray = new Tray(trayIcon)
  state.tray.setToolTip('Pika') // This tooltip might also need update if we change global shortcut, but global shortcut is removed.
  updateTrayMenu(appState);

  // Double-click to show window
  state.tray.on('double-click', () => {
    appState.centerAndShowWindow()
  })
}

export function updateTrayMenu(appState: AppState) {
  const state = appState as any;

  if (!state.tray) return;

  const keybindManager = KeybindManager.getInstance();
  const screenshotAccel = keybindManager.getKeybind('general:take-screenshot') || 'CommandOrControl+H';

  console.log('[Main] updateTrayMenu called. Screenshot Accelerator:', screenshotAccel);

  // Update tooltip for verification
  state.tray.setToolTip('Pika');

  // Helper to format accelerator for display (e.g. CommandOrControl+H -> Cmd+H)
  const formatAccel = (accel: string) => {
    return accel
      .replace('CommandOrControl', 'Cmd')
      .replace('Command', 'Cmd')
      .replace('Control', 'Ctrl')
      .replace('OrControl', '') // Cleanup just in case
      .replace(/\+/g, '+');
  };

  const displayScreenshot = formatAccel(screenshotAccel);
  // We can also get the toggle visibility shortcut if desired
  const toggleKb = keybindManager.getKeybind('general:toggle-visibility');
  const toggleAccel = toggleKb || 'CommandOrControl+B';
  const displayToggle = formatAccel(toggleAccel);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Pika',
      click: () => {
        appState.centerAndShowWindow()
      }
    },
    {
      label: `Toggle Window (${displayToggle})`,
      click: () => {
        appState.toggleMainWindow()
      }
    },
    {
      type: 'separator'
    },
    {
      label: `Take Screenshot (${displayScreenshot})`,
      accelerator: screenshotAccel,
      click: async () => {
        try {
          const screenshotPath = await appState.takeScreenshot()
          const preview = await appState.getImagePreview(screenshotPath)
          const mainWindow = appState.getMainWindow()
          if (mainWindow) {
            mainWindow.webContents.send("screenshot-taken", {
              path: screenshotPath,
              preview
            })
          }
        } catch (error) {
          console.error("Error taking screenshot from tray:", error)
        }
      }
    },
    {
      type: 'separator'
    },
    {
      label: 'Quit',
      accelerator: 'Command+Q',
      click: () => {
        app.quit()
      }
    }
  ])

  state.tray.setContextMenu(contextMenu)
}

export function hideTray(appState: AppState): void {
  const state = appState as any;

  if (state.tray) {
    state.tray.destroy();
    state.tray = null;
  }
}
