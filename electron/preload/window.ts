import { ipcRenderer } from "electron"

export function windowChannels() {
  return {
    moveWindowLeft: () => ipcRenderer.invoke("move-window-left"),
    moveWindowRight: () => ipcRenderer.invoke("move-window-right"),
    moveWindowUp: () => ipcRenderer.invoke("move-window-up"),
    moveWindowDown: () => ipcRenderer.invoke("move-window-down"),
    windowMinimize: () => ipcRenderer.invoke("window-minimize"),
    windowMaximize: () => ipcRenderer.invoke("window-maximize"),
    windowClose: () => ipcRenderer.invoke("window-close"),
    windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),

    analyzeImageFile: (path: string) => ipcRenderer.invoke("analyze-image-file", path),
    quitApp: () => ipcRenderer.invoke("quit-app"),
    toggleWindow: () => ipcRenderer.invoke("toggle-window"),
    showWindow: (inactive?: boolean) => ipcRenderer.invoke("show-window", inactive),
    hideWindow: () => ipcRenderer.invoke("hide-window"),
    showOverlay: () => ipcRenderer.invoke("show-overlay"),
    hideOverlay: () => ipcRenderer.invoke("hide-overlay"),
    getMeetingActive: () => ipcRenderer.invoke("get-meeting-active"),
    onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => {
      const subscription = (_: any, data: { isActive: boolean }) => callback(data);
      ipcRenderer.on('meeting-state-changed', subscription);
      return () => { ipcRenderer.removeListener('meeting-state-changed', subscription); };
    },
    onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => {
      const subscription = (_: any, isMaximized: boolean) => callback(isMaximized);
      ipcRenderer.on('window-maximized-changed', subscription);
      return () => { ipcRenderer.removeListener('window-maximized-changed', subscription); };
    },
    onEnsureExpanded: (callback: () => void) => {
      const subscription = () => callback();
      ipcRenderer.on('ensure-expanded', subscription);
      return () => { ipcRenderer.removeListener('ensure-expanded', subscription); };
    },
    toggleAdvancedSettings: () => ipcRenderer.invoke("toggle-advanced-settings"),
    openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
    setUndetectable: (state: boolean) => ipcRenderer.invoke("set-undetectable", state),
    getUndetectable: () => ipcRenderer.invoke("get-undetectable"),
    setOverlayMousePassthrough: (enabled: boolean) => ipcRenderer.invoke("set-overlay-mouse-passthrough", enabled),
    toggleOverlayMousePassthrough: () => ipcRenderer.invoke("toggle-overlay-mouse-passthrough"),
    getOverlayMousePassthrough: () => ipcRenderer.invoke("get-overlay-mouse-passthrough"),
    onSettingsVisibilityChange: (callback: (isVisible: boolean) => void) => {
      const subscription = (_: any, isVisible: boolean) => callback(isVisible)
      ipcRenderer.on("settings-visibility-changed", subscription)
      return () => {
        ipcRenderer.removeListener("settings-visibility-changed", subscription)
      }
    },
    onToggleExpand: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on("toggle-expand", subscription)
      return () => {
        ipcRenderer.removeListener("toggle-expand", subscription)
      }
    },
    onUndetectableChanged: (callback: (state: boolean) => void) => {
      const subscription = (_: any, state: boolean) => callback(state)
      ipcRenderer.on('undetectable-changed', subscription)
      return () => {
        ipcRenderer.removeListener('undetectable-changed', subscription)
      }
    },
    onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => {
      const subscription = (_: any, enabled: boolean) => callback(enabled)
      ipcRenderer.on('overlay-mouse-passthrough-changed', subscription)
      return () => {
        ipcRenderer.removeListener('overlay-mouse-passthrough-changed', subscription)
      }
    },
    setOverlayOpacity: (opacity: number) => ipcRenderer.invoke('set-overlay-opacity', opacity),
    onOverlayOpacityChanged: (callback: (opacity: number) => void) => {
      const subscription = (_: any, opacity: number) => callback(opacity)
      ipcRenderer.on('overlay-opacity-changed', subscription)
      return () => {
        ipcRenderer.removeListener('overlay-opacity-changed', subscription)
      }
    },
    toggleSettingsWindow: (coords?: { x: number; y: number }) => ipcRenderer.invoke('toggle-settings-window', coords),
  }
}
