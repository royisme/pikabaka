/**
 * verboseLog.ts
 * Module-level singleton flag for verbose/debug logging.
 * Import isVerboseLogging() anywhere in the electron main process to gate
 * diagnostic logs. The flag is toggled via AppState.setVerboseLogging() which
 * persists it through SettingsManager.
 */

let _verbose = false;

export const isVerboseLogging = (): boolean => _verbose;
export const setVerboseLoggingFlag = (enabled: boolean): void => {
  _verbose = enabled;
};
