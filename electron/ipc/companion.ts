import { AppState } from '../main';
import { safeHandle } from './safeHandle';

export function registerCompanionHandlers(appState: AppState): void {
  safeHandle('companion:get-status', async () => appState.getCompanionServer().getStatus());

  safeHandle('companion:start', async (_, preferredPort?: number) => {
    return appState.getCompanionServer().start(preferredPort || 0);
  });

  safeHandle('companion:stop', async () => appState.getCompanionServer().stop());

  safeHandle('companion:create-pairing-code', async () => {
    return appState.getCompanionServer().createPairingCode();
  });

  safeHandle('companion:revoke-device', async (_, deviceId: string) => {
    return appState.getCompanionServer().revokeDevice(deviceId);
  });

  safeHandle('companion:update-snapshot', async (_, snapshot: any) => {
    return appState.getCompanionServer().updateSnapshot(snapshot || {});
  });
}
