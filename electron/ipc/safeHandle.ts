import { ipcMain, BrowserWindow } from "electron"

export const safeHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
};

export const broadcastOpenAICompatibleProvidersChanged = () => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('openai-compatible-providers-changed');
    }
  }
};
