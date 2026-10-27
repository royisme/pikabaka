import { app, globalShortcut, Menu, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';

export interface KeybindConfig {
    id: string;
    label: string;
    accelerator: string; // Electron Accelerator string
    isGlobal: boolean;   // Registered with globalShortcut
    defaultAccelerator: string;
}

export interface KeybindStatus extends KeybindConfig {
    registered: boolean;
}

export interface KeybindResult {
    success: boolean;
    error?: string;
}

// Ctrl+Alt is AltGr on many Windows keyboard layouts, so avoid it on Windows.
const TOGGLE_TRANSLATION_DEFAULT = process.platform === 'win32' ? 'Control+Shift+F9' : 'CommandOrControl+Alt+T';

export const DEFAULT_KEYBINDS: KeybindConfig[] = [
    { id: 'general:toggle-visibility', label: 'Toggle Visibility', accelerator: 'CommandOrControl+B', isGlobal: true, defaultAccelerator: 'CommandOrControl+B' },
    { id: 'general:toggle-mouse-passthrough', label: 'Toggle Mouse Passthrough', accelerator: 'CommandOrControl+Shift+B', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+B' },
    { id: 'chat:whatToAnswer', label: 'What to Say', accelerator: 'CommandOrControl+1', isGlobal: true, defaultAccelerator: 'CommandOrControl+1' },
    { id: 'general:selective-screenshot', label: 'Capture Selected Area', accelerator: 'CommandOrControl+Shift+H', isGlobal: true, defaultAccelerator: 'CommandOrControl+Shift+H' },
    { id: 'translation:toggle', label: 'Toggle Translation', accelerator: TOGGLE_TRANSLATION_DEFAULT, isGlobal: true, defaultAccelerator: TOGGLE_TRANSLATION_DEFAULT },
    { id: 'general:reset-cancel', label: 'Stop Generation', accelerator: 'CommandOrControl+R', isGlobal: true, defaultAccelerator: 'CommandOrControl+R' },
    { id: 'translation:toggle-original', label: 'Toggle Original Text', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'window:move-up', label: 'Move Window Up', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'window:move-down', label: 'Move Window Down', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'window:move-left', label: 'Move Window Left', accelerator: '', isGlobal: true, defaultAccelerator: '' },
    { id: 'window:move-right', label: 'Move Window Right', accelerator: '', isGlobal: true, defaultAccelerator: '' },
];

export class KeybindManager {
    private static instance: KeybindManager;
    private keybinds: Map<string, KeybindConfig> = new Map();
    private filePath: string;
    private windowHelper: any; // Type avoided for circular dep, passed in init
    private onUpdateCallbacks: (() => void)[] = [];
    private onShortcutTriggeredCallbacks: ((actionId: string) => void)[] = [];
    private activeMode: 'launcher' | 'overlay' = 'launcher';

    public setMode(mode: 'launcher' | 'overlay') {
        if (this.activeMode === mode) return;
        this.activeMode = mode;
        console.log(`[KeybindManager] Mode changed to: ${mode}. Refreshing global shortcuts.`);
        this.registerGlobalShortcuts();
        this.broadcastUpdate();
    }

    private shouldRegister(actionId: string): boolean {
        return this.activeMode === 'overlay' || actionId === 'general:toggle-visibility';
    }

    private normalizeAccelerator(acc: string): string {
        if (!acc) return '';
        // Electron accelerators are case-insensitive and order-independent for modifiers.
        // We split, lowercase, and sort to ensure consistent string matching.
        // E.g., 'Shift+CommandOrControl+Up' === 'CommandOrControl+Shift+Up'
        const aliases: Record<string, string> = {
            commandorcontrol: process.platform === 'darwin' ? 'command' : 'control',
            cmdorctrl: process.platform === 'darwin' ? 'command' : 'control',
            cmd: 'command', meta: 'command', ctrl: 'control', option: 'alt',
            arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right'
        };
        const parts = acc.split('+').map(p => {
            const part = p.trim().toLowerCase();
            return aliases[part] || part;
        });
        parts.sort();
        return parts.join('+');
    }

    private constructor() {
        this.filePath = path.join(app.getPath('userData'), 'keybinds.json');
        this.load();
    }

    public onUpdate(callback: () => void) {
        this.onUpdateCallbacks.push(callback);
    }

    public onShortcutTriggered(callback: (actionId: string) => void) {
        this.onShortcutTriggeredCallbacks.push(callback);
    }

    public static getInstance(): KeybindManager {
        if (!KeybindManager.instance) {
            KeybindManager.instance = new KeybindManager();
        }
        return KeybindManager.instance;
    }

    public setWindowHelper(windowHelper: any) {
        this.windowHelper = windowHelper;
    }

    private load() {
        // 1. Load Defaults
        DEFAULT_KEYBINDS.forEach(kb => this.keybinds.set(kb.id, { ...kb }));

        // 2. Load Overrides
        try {
            if (fs.existsSync(this.filePath)) {
                const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));

                // Validate and merge
                let hadConflicts = false;
                for (const fileKb of data) {
                    if (this.keybinds.has(fileKb.id)) {
                        const current = this.keybinds.get(fileKb.id)!;

                        // Deduplicate: If another keybind is already using this accelerator, skip or clear it
                        if (fileKb.accelerator && fileKb.accelerator.trim() !== '') {
                            let conflictId: string | null = null;
                            const normalizedNew = this.normalizeAccelerator(fileKb.accelerator);
                            this.keybinds.forEach((kb, existingId) => {
                                if (existingId !== fileKb.id && this.normalizeAccelerator(kb.accelerator) === normalizedNew) {
                                    conflictId = existingId;
                                }
                            });
                            
                            if (conflictId) {
                                // EC-03 fix: mark that we resolved a conflict so we can persist below
                                const conflictKb = this.keybinds.get(conflictId)!;
                                conflictKb.accelerator = '';
                                this.keybinds.set(conflictId, conflictKb);
                                hadConflicts = true;
                            }
                        }

                        current.accelerator = fileKb.accelerator;
                        this.keybinds.set(fileKb.id, current);
                    }
                }

                // EC-03 fix: persist resolved conflicts so they are not re-detected on next launch
                if (hadConflicts) {
                    this.save();
                }
            }
        } catch (error) {
            console.error('[KeybindManager] Failed to load keybinds:', error);
        }
    }

    private save() {
        try {
            const data = Array.from(this.keybinds.values()).map(kb => ({
                id: kb.id,
                accelerator: kb.accelerator
            }));
            const tmpPath = this.filePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
            fs.renameSync(tmpPath, this.filePath);
        } catch (error) {
            console.error('[KeybindManager] Failed to save keybinds:', error);
        }
    }

    public getKeybind(id: string): string | undefined {
        return this.keybinds.get(id)?.accelerator;
    }

    public getAllKeybinds(): KeybindStatus[] {
        return Array.from(this.keybinds.values(), kb => ({
            ...kb,
            // False only when this mode should have registered the chord and the OS refused it.
            registered: !kb.isGlobal || !kb.accelerator || !this.shouldRegister(kb.id) || globalShortcut.isRegistered(kb.accelerator)
        }));
    }

    public setKeybind(id: string, accelerator: string): KeybindResult {
        const currentKb = this.keybinds.get(id);
        if (!currentKb) return { success: false, error: 'Unknown shortcut' };
        accelerator = accelerator.trim();
        const oldAccelerator = currentKb.accelerator;
        const normalizedNew = this.normalizeAccelerator(accelerator);
        const conflict = Array.from(this.keybinds.values()).find(kb =>
            kb.id !== id && accelerator && this.normalizeAccelerator(kb.accelerator) === normalizedNew
        );
        if (conflict) return { success: false, error: `Already used by ${conflict.label}` };

        const sameAccelerator = this.normalizeAccelerator(oldAccelerator) === normalizedNew;
        // Probe before releasing the old chord, so a refusal leaves it working.
        if (currentKb.isGlobal && accelerator && this.shouldRegister(id)) {
            const alreadyRegistered = sameAccelerator && globalShortcut.isRegistered(oldAccelerator);
            if (!alreadyRegistered && !this.registerShortcut(currentKb, accelerator)) {
                return { success: false, error: 'Could not register this key combination. Another app may already be using it.' };
            }
        }
        if (currentKb.isGlobal && oldAccelerator && !sameAccelerator) {
            globalShortcut.unregister(oldAccelerator);
        }
        currentKb.accelerator = accelerator;
        this.save();
        this.updateMenu();
        this.broadcastUpdate();
        return { success: true };
    }

    public resetKeybinds() {
        this.keybinds.clear();
        DEFAULT_KEYBINDS.forEach(kb => this.keybinds.set(kb.id, { ...kb }));
        this.save();
        this.registerGlobalShortcuts();
        this.broadcastUpdate();
    }

    public registerGlobalShortcuts() {
        globalShortcut.unregisterAll();

        this.keybinds.forEach(kb => {
            if (kb.isGlobal && kb.accelerator && kb.accelerator.trim() !== '') {
                if (!this.shouldRegister(kb.id)) return;

                this.registerShortcut(kb, kb.accelerator.trim());
            }
        });

        this.updateMenu();
    }

    private registerShortcut(kb: KeybindConfig, accelerator: string): boolean {
        try {
            return globalShortcut.register(accelerator, () => {
                this.onShortcutTriggeredCallbacks.forEach(cb => cb(kb.id));
            });
        } catch (error) {
            console.error(`[KeybindManager] Could not register shortcut ${kb.id}:`, error);
            return false;
        }
    }

    public updateMenu() {
        // On Windows/Linux, set a minimal menu (for shortcuts like DevTools)
        // but hide the menu bar from the UI
        if (process.platform !== 'darwin') {
            const template: any[] = [
                {
                    label: 'View',
                    submenu: [
                        { role: 'reload' },
                        { role: 'forceReload' },
                        { role: 'toggleDevTools' },
                        { type: 'separator' },
                        { role: 'resetZoom' },
                        { role: 'zoomIn' },
                        { role: 'zoomOut' },
                        { type: 'separator' },
                        { role: 'togglefullscreen' }
                    ]
                }
            ];
            const menu = Menu.buildFromTemplate(template);
            Menu.setApplicationMenu(menu);
            return;
        }

        const toggleKb = this.keybinds.get('general:toggle-visibility');
        const toggleAccelerator = toggleKb ? toggleKb.accelerator : 'CommandOrControl+B';

        const template: any[] = [
            {
                label: app.name,
                submenu: [
                    { role: 'about' },
                    { type: 'separator' },
                    { role: 'services' },
                    { type: 'separator' },
                    { role: 'hide', accelerator: 'CommandOrControl+Option+H' },
                    { role: 'hideOthers', accelerator: 'CommandOrControl+Option+Shift+H' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' }
                ]
            },
            {
                role: 'editMenu'
            },
            {
                label: 'View',
                submenu: [
                    {
                        label: 'Toggle Visibility',
                        accelerator: toggleAccelerator || undefined,
                        click: () => {
                            // Require AppState dynamically to avoid circular dependencies
                            const { AppState } = require('../main');
                            AppState.getInstance().toggleMainWindow();
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Move Window Up',
                        accelerator: this.getKeybind('window:move-up') || undefined,
                        click: () => this.windowHelper?.moveWindowUp()
                    },
                    {
                        label: 'Move Window Down',
                        accelerator: this.getKeybind('window:move-down') || undefined,
                        click: () => this.windowHelper?.moveWindowDown()
                    },
                    {
                        label: 'Move Window Left',
                        accelerator: this.getKeybind('window:move-left') || undefined,
                        click: () => this.windowHelper?.moveWindowLeft()
                    },
                    {
                        label: 'Move Window Right',
                        accelerator: this.getKeybind('window:move-right') || undefined,
                        click: () => this.windowHelper?.moveWindowRight()
                    },
                    { type: 'separator' },
                    { role: 'reload' },
                    { role: 'forceReload' },
                    { role: 'toggleDevTools' },
                    { type: 'separator' },
                    { role: 'resetZoom' },
                    { role: 'zoomIn' },
                    { role: 'zoomOut' },
                    { type: 'separator' },
                    { role: 'togglefullscreen' }
                ]
            },
            {
                role: 'windowMenu'
            },
            {
                role: 'help',
                submenu: [
                    {
                        label: 'Learn More',
                        click: async () => {
                            const { shell } = require('electron');
                            await shell.openExternal('https://electronjs.org');
                        }
                    }
                ]
            }
        ];

        const menu = Menu.buildFromTemplate(template);
        Menu.setApplicationMenu(menu);
        console.log('[KeybindManager] Application menu updated');
    }

    private broadcastUpdate() {
        // Notify main process listeners
        this.onUpdateCallbacks.forEach(cb => cb());

        const windows = BrowserWindow.getAllWindows();
        const allKeybinds = this.getAllKeybinds();
        windows.forEach(win => {
            if (!win.isDestroyed()) {
                win.webContents.send('keybinds:update', allKeybinds);
            }
        });
    }

    public setupIpcHandlers() {
        ipcMain.handle('keybinds:get-all', () => {
            return this.getAllKeybinds();
        });

        ipcMain.handle('keybinds:set', (_, id: string, accelerator: string) => {
            console.log(`[KeybindManager] Set ${id} -> ${accelerator}`);
            if (typeof id !== 'string' || typeof accelerator !== 'string') {
                return { success: false, error: 'Invalid shortcut' };
            }
            return this.setKeybind(id, accelerator);
        });

        ipcMain.handle('keybinds:reset', () => {
            console.log('[KeybindManager] Reset defaults');
            this.resetKeybinds();
            return this.getAllKeybinds();
        });
    }
}
