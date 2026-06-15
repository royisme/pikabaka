export type MacPermissionStatus =
  | 'not-determined'
  | 'granted'
  | 'authorized'
  | 'denied'
  | 'restricted'
  | 'limited'
  | 'unknown'
  | string;

export type NormalizedMacPermissionStatus =
  | 'not-determined'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'limited'
  | 'unknown';

export interface PermissionStatusReport {
  status: NormalizedMacPermissionStatus;
  rawStatus: MacPermissionStatus;
  granted: boolean;
  limited: boolean;
  restartRequired: boolean;
  message?: string;
}

export interface PermissionStatusSummary {
  microphone: PermissionStatusReport;
  screen: PermissionStatusReport;
}

const GRANTED_MEDIA_STATUSES = new Set(['granted', 'authorized']);
const LIMITED_MEDIA_STATUSES = new Set(['limited']);

export function normalizeMediaAccessStatus(status: MacPermissionStatus): NormalizedMacPermissionStatus {
  if (GRANTED_MEDIA_STATUSES.has(status)) return 'granted';
  if (LIMITED_MEDIA_STATUSES.has(status)) return 'limited';
  if (status === 'not-determined' || status === 'denied' || status === 'restricted' || status === 'unknown') {
    return status;
  }
  return 'unknown';
}

export function isMediaAccessGranted(status: MacPermissionStatus): boolean {
  return GRANTED_MEDIA_STATUSES.has(status) || LIMITED_MEDIA_STATUSES.has(status);
}

export function buildPermissionStatusReport(
  rawStatus: MacPermissionStatus,
  type: 'microphone' | 'screen'
): PermissionStatusReport {
  const status = normalizeMediaAccessStatus(rawStatus);
  const limited = status === 'limited';
  const restartRequired = type === 'screen' && status === 'granted' && rawStatus !== 'granted';

  let message: string | undefined;
  if (type === 'screen' && rawStatus === 'authorized') {
    message = 'macOS reports Screen Recording is allowed. If capture still fails, quit and reopen Pika so macOS applies the change.';
  } else if (type === 'screen' && limited) {
    message = 'macOS reports limited Screen Recording access. If capture is incomplete, allow full access or restart Pika after changing this setting.';
  } else if (limited) {
    message = 'macOS reports limited access.';
  } else if (rawStatus !== status) {
    message = `macOS reported ${rawStatus}; treating it as ${status}.`;
  }

  return {
    status,
    rawStatus,
    granted: isMediaAccessGranted(rawStatus),
    limited,
    restartRequired,
    ...(message ? { message } : {})
  };
}

export function getMacPermissionStatusSummary(): PermissionStatusSummary {
  const { systemPreferences } = require("electron") as typeof import("electron");
  const microphone = systemPreferences.getMediaAccessStatus('microphone') as MacPermissionStatus;
  const screen = systemPreferences.getMediaAccessStatus('screen') as MacPermissionStatus;

  return {
    microphone: buildPermissionStatusReport(microphone, 'microphone'),
    screen: buildPermissionStatusReport(screen, 'screen'),
  };
}

export function getScreenCapturePermissionMessage(rawStatus?: MacPermissionStatus): string {
  if (rawStatus && isMediaAccessGranted(rawStatus)) {
    return 'macOS reports Screen Recording is allowed, but screen capture is not available yet. Quit and reopen Pika so macOS applies the Screen Recording change.';
  }

  return 'Screen capture permission denied. Please grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording, then quit and reopen Pika if capture still fails.';
}
