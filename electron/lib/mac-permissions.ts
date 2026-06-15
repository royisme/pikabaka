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

export interface MacCodeSignatureStatus {
  checked: boolean;
  isAdHoc: boolean;
  hasTeamIdentifier: boolean;
  teamIdentifier?: string;
  authority?: string;
  rejectedByGatekeeper?: boolean;
}

export interface PermissionStatusSummary {
  microphone: PermissionStatusReport;
  screen: PermissionStatusReport;
  codeSignature?: MacCodeSignatureStatus;
}

const GRANTED_MEDIA_STATUSES = new Set(['granted', 'authorized']);
const LIMITED_MEDIA_STATUSES = new Set(['limited']);

export function parseMacCodeSignatureStatus(output: string): MacCodeSignatureStatus {
  const authority = output.match(/^Authority=(.+)$/m)?.[1];
  const teamIdentifier = output.match(/^TeamIdentifier=(.+)$/m)?.[1];

  return {
    checked: true,
    isAdHoc: /^Signature=adhoc$/m.test(output),
    hasTeamIdentifier: Boolean(teamIdentifier && teamIdentifier !== 'not set'),
    ...(teamIdentifier && teamIdentifier !== 'not set' ? { teamIdentifier } : {}),
    ...(authority ? { authority } : {}),
  };
}

function getCurrentMacCodeSignatureStatus(): MacCodeSignatureStatus | undefined {
  if (process.platform !== 'darwin') return undefined;

  try {
    const { app } = require('electron') as typeof import('electron');
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
    const appPath = app.getPath('exe').replace(/\/Contents\/MacOS\/[^/]+$/, '');
    const codesign = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' });
    const output = `${codesign.stdout || ''}${codesign.stderr || ''}`;
    const status = parseMacCodeSignatureStatus(output);

    const spctl = spawnSync('/usr/sbin/spctl', ['-a', '-t', 'execute', appPath], { encoding: 'utf8' });
    const spctlOutput = `${spctl.stdout || ''}${spctl.stderr || ''}`;
    return {
      ...status,
      rejectedByGatekeeper: /rejected/i.test(spctlOutput),
    };
  } catch {
    return { checked: false, isAdHoc: false, hasTeamIdentifier: false };
  }
}

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
  const codeSignature = getCurrentMacCodeSignatureStatus();

  return {
    microphone: buildPermissionStatusReport(microphone, 'microphone'),
    screen: buildPermissionStatusReport(screen, 'screen'),
    ...(codeSignature ? { codeSignature } : {}),
  };
}

export function getScreenCapturePermissionMessage(rawStatus?: MacPermissionStatus): string {
  if (rawStatus && isMediaAccessGranted(rawStatus)) {
    return 'macOS reports Screen Recording is allowed, but screen capture is not available yet. Quit and reopen Pika so macOS applies the Screen Recording change. If it still fails, remove Pika from System Settings > Privacy & Security > Screen Recording, reopen Pika, and grant access again.';
  }

  return 'Screen capture permission denied. Please grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording, then quit and reopen Pika. If the toggle is already on but screenshots still fail, remove Pika from that list, reopen Pika, and grant access again.';
}
