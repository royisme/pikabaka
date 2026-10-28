import { ipcMain } from "electron"

export const safeHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await listener(event, ...args);
    } catch (error) {
      // Preserve other channels' rejection contracts; only credential persistence uses this failure reply.
      if (error instanceof Error && error.name === 'CredentialStorageError') {
        return { success: false, error: error.message };
      }
      throw error;
    }
  });
};
