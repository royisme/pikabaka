import { useCallback } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { acceleratorToKeys, keysToAccelerator } from '../utils/keyboardUtils';
import { isMac, isWindows } from '../utils/platformUtils';
import { useMainEvent } from './useMainEvent';

export const SHORTCUT_IDS = {
    toggleVisibility: 'general:toggle-visibility',
    toggleMousePassthrough: 'general:toggle-mouse-passthrough',
    whatToAnswer: 'chat:whatToAnswer',
    selectiveScreenshot: 'general:selective-screenshot',
    toggleTranslation: 'translation:toggle',
    resetCancel: 'general:reset-cancel',
    toggleOriginal: 'translation:toggle-original',
    moveWindowUp: 'window:move-up',
    moveWindowDown: 'window:move-down',
    moveWindowLeft: 'window:move-left',
    moveWindowRight: 'window:move-right',
} as const;

export type ShortcutConfig = Record<keyof typeof SHORTCUT_IDS, string[]>;
type BackendKeybind = Awaited<ReturnType<Window['electronAPI']['getKeybinds']>>[number];

function buildDefaultShortcuts(): ShortcutConfig {
    const mod = isMac ? '⌘' : 'Ctrl';
    const shift = isMac ? '⇧' : 'Shift';
    return {
        toggleVisibility: [mod, 'B'],
        toggleMousePassthrough: [mod, shift, 'B'],
        whatToAnswer: [mod, '1'],
        selectiveScreenshot: [mod, shift, 'H'],
        toggleTranslation: isWindows ? ['Ctrl', shift, 'F9'] : [mod, isMac ? '⌥' : 'Alt', 'T'],
        resetCancel: [mod, 'R'],
        toggleOriginal: [],
        moveWindowUp: [],
        moveWindowDown: [],
        moveWindowLeft: [],
        moveWindowRight: [],
    };
}

export const DEFAULT_SHORTCUTS = buildDefaultShortcuts();

export const useShortcuts = () => {
    const queryClient = useQueryClient();
    const { data: keybinds = [] } = useQuery<BackendKeybind[]>(
        ['keybinds'],
        () => window.electronAPI.getKeybinds()
    );
    const shortcuts = buildDefaultShortcuts();
    for (const actionId of Object.keys(SHORTCUT_IDS) as (keyof ShortcutConfig)[]) {
        const keybind = keybinds.find(kb => kb.id === SHORTCUT_IDS[actionId]);
        if (!keybind) continue;
        shortcuts[actionId] = acceleratorToKeys(keybind.accelerator);
    }

    useMainEvent(
        window.electronAPI?.onKeybindsUpdate,
        useCallback((updated: BackendKeybind[]) => {
            queryClient.setQueryData(['keybinds'], updated);
        }, [queryClient])
    );

    const updateShortcut = useCallback(async (actionId: keyof ShortcutConfig, keys: string[]) => {
        const result = await window.electronAPI.setKeybind(SHORTCUT_IDS[actionId], keysToAccelerator(keys));
        if (result.success) await queryClient.invalidateQueries(['keybinds']);
        return result;
    }, [queryClient]);

    const resetShortcuts = useCallback(async () => {
        const defaults = await window.electronAPI.resetKeybinds();
        queryClient.setQueryData(['keybinds'], defaults);
    }, [queryClient]);

    // Helper to check if a keyboard event matches a configured shortcut
    const isShortcutPressed = useCallback((event: KeyboardEvent | React.KeyboardEvent, actionId: keyof ShortcutConfig): boolean => {
        const keys = shortcuts[actionId];
        if (!keys || keys.length === 0) return false;

        // Check modifiers — platform-aware:
        // On Mac: ⌘ = metaKey. On Win/Linux: Ctrl maps to ctrlKey.
        // 'CommandOrControl' (⌘/Ctrl) matches metaKey on Mac, ctrlKey on Win/Linux.
        const isCommandOrControl = (k: string) =>
            ['⌘', 'Command', 'Meta', 'CommandOrControl'].includes(k);
        const isCtrl = (k: string) =>
            ['⌃', 'Control', 'Ctrl'].includes(k);

        const hasCommandOrControl = keys.some(isCommandOrControl);
        const hasCtrlOnly = !hasCommandOrControl && keys.some(isCtrl);
        const hasAlt = keys.some(k => ['⌥', 'Alt', 'Option'].includes(k));
        const hasShift = keys.some(k => ['⇧', 'Shift'].includes(k));

        if (isMac) {
            // On Mac: ⌘ = metaKey, ⌃ = ctrlKey
            if (event.metaKey !== hasCommandOrControl) return false;
            if (event.ctrlKey !== hasCtrlOnly) return false;
        } else {
            // On Win/Linux: both ⌘ and Ctrl map to ctrlKey
            const needsCtrl = hasCommandOrControl || hasCtrlOnly;
            if (event.ctrlKey !== needsCtrl) return false;
            if (event.metaKey) return false; // metaKey should never be pressed on Windows
        }
        if (event.altKey !== hasAlt) return false;
        if (event.shiftKey !== hasShift) return false;

        // Find the main non-modifier key
        const mainKey = keys.find(k =>
            !['⌘', 'Command', 'Meta', '⇧', 'Shift', '⌥', 'Alt', 'Option', '⌃', 'Control', 'Ctrl'].includes(k)
        );

        if (!mainKey) return false; // Modifiers only

        // Normalize checks
        const eventKey = event.key.toLowerCase();
        let configKey = mainKey.toLowerCase();

        if (configKey === '↑') configKey = 'arrowup';
        if (configKey === '↓') configKey = 'arrowdown';
        if (configKey === '←') configKey = 'arrowleft';
        if (configKey === '→') configKey = 'arrowright';

        // Handle Space specifically
        if (configKey === 'space') {
            return event.code === 'Space';
        }

        // Handle Arrow keys
        // Electron accelerator uses 'ArrowUp' (mapped from 'Up'), event.key is 'ArrowUp'
        // So direct comparison usually works

        return eventKey === configKey;
    }, [shortcuts]);

    return {
        shortcuts,
        updateShortcut,
        resetShortcuts,
        isShortcutPressed
    };
};
