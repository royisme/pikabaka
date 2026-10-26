import { ipcMain } from "electron"

export const safeHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
};
