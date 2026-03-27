import { loadNativeModule } from './nativeModuleLoader';

// NativeModule may be null if the Rust binary isn't built yet (new clone without `npm run build:native`).
// All methods below handle this gracefully by returning empty arrays.
const NativeModule: any = loadNativeModule();
const { getInputDevices, getOutputDevices } = NativeModule || {};

export interface AudioDevice {
    id: string;
    name: string;
}

export class AudioDevices {
    public static getInputDevices(): AudioDevice[] {
        if (!getInputDevices) {
            console.warn('[AudioDevices] Native functionality not available');
            return [];
        }
        try {
            return getInputDevices();
        } catch (e) {
            console.error('[AudioDevices] Failed to get input devices:', e);
            return [];
        }
    }

    public static getOutputDevices(): AudioDevice[] {
        if (!getOutputDevices) {
            console.warn('[AudioDevices] Native functionality not available');
            return [];
        }
        try {
            return getOutputDevices();
        } catch (e) {
            console.error('[AudioDevices] Failed to get output devices:', e);
            return [];
        }
    }
}
