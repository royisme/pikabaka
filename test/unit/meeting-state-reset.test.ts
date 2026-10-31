import t from 'tap';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import React from 'react';
import * as ReactQuery from '@tanstack/react-query';
import * as FramerMotion from 'framer-motion';
import { mockRequire } from '../../node_modules/@tapjs/mock/dist/esm/mock-require.js';
import type { IntelligenceManager as Intelligence } from '../../electron/IntelligenceManager';

/**
 * Ending a meeting and starting another one must leave nothing of the first in the overlay: the
 * overlay window is only hidden between meetings, so its React state outlives the meeting unless it
 * is thrown away. These checks run the real modules, with only the windowless React host stubbed.
 */

type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;
const at = (name: string) => path.resolve(name);
const electronFile = (name: string) => at(`electron/${name}.ts`);
const marker = () => null;
const passthrough = ({ children }: { children?: React.ReactNode }) => children;
// The mock loader compiles these modules to CommonJS and wraps a plain mock, so a stub for a default
// export has to look like a module: without __esModule the whole object becomes the component.
const asDefault = (component: () => null) => ({ __esModule: true, default: component });
const elements = (tree: React.ReactNode): Element[] =>
    React.isValidElement<Element['props']>(tree) ? [tree, ...React.Children.toArray(tree.props.children).flatMap(elements)] : [];

/**
 * One component drawn by hand: state survives a redraw, an effect runs when its deps change, every
 * `window.electronAPI` method is a recorded call, and unmounting runs the cleanups it left.
 */
function host(name: string, search: string, stubs: Record<string, unknown> = {}) {
    const calls = new Map<string, unknown[][]>();
    const methods = new Map<string, (...args: unknown[]) => () => void>();
    const electronAPI = new Proxy({}, {
        get: (_target, method: string) => {
            let call = methods.get(method);
            if (!call) {
                call = (...args: unknown[]) => { calls.set(method, [...(calls.get(method) ?? []), args]); return () => {}; };
                methods.set(method, call);
            }
            return call;
        },
    });
    const style = { setProperty: () => {} };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI, location: { search }, screenX: 0, screenY: 0 } });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
        documentElement: { style, getAttribute: () => null, setAttribute: () => {}, classList: { add: () => {}, remove: () => {}, contains: () => false } },
        body: { style }, getElementById: () => null,
    } });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });

    const state: unknown[] = [];
    const effects: Array<{ deps?: unknown[]; run: () => void | (() => void); cleanup?: () => void }> = [];
    let stateIndex = 0;
    let effectIndex = 0;
    const sameDeps = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((dep, index) => Object.is(dep, b[index]));
    const useEffect = (fn: () => void | (() => void), deps?: unknown[]) => {
        const slot = effectIndex++;
        if (effects[slot] && sameDeps(effects[slot].deps, deps)) return;
        const cleanup = fn();
        effects[slot] = { deps, run: fn, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
    };
    const react = {
        ...React,
        useState: (initial: unknown) => {
            const slot = stateIndex++;
            if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
            return [state[slot], (next: unknown) => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
        },
        useEffect,
        useLayoutEffect: useEffect,
        useRef: (value: unknown) => ({ current: value }),
        useMemo: (fn: () => unknown) => fn(),
        useCallback: (fn: unknown) => fn,
    };
    // `import React` and the named hooks must be one object: a default import reaching the real hooks
    // would run them with no dispatcher ("Cannot read properties of null").
    const { default: component } = mockRequire(at(name), {
        ...stubs,
        react: { __esModule: true, default: react, ...react },
        '@tanstack/react-query': { ...ReactQuery, useQueryClient: () => ({ invalidateQueries: () => {}, setQueryData: () => {} }), useQuery: () => ({ data: undefined }), useMutation: () => ({ mutate: () => {} }) },
        'framer-motion': FramerMotion,
    }) as { default: (props: never) => React.ReactNode };

    // The window router is a component without hooks (App -> MainApp); draw through it so the
    // assertions see the real window's tree instead of a single wrapper element.
    const expand = (node: React.ReactNode): React.ReactNode => {
        let current = node;
        for (let depth = 0; depth < 3; depth++) {
            if (!React.isValidElement<Element['props']>(current) || typeof current.type !== 'function') return current;
            current = (current.type as (props: Element['props']) => React.ReactNode)(current.props);
        }
        return current;
    };

    return {
        draw: () => { stateIndex = 0; effectIndex = 0; return expand(component({} as never)); },
        calls: (method: string) => calls.get(method) ?? [],
        replayMountEffects: () => effects.forEach((effect) => {
            effect.cleanup?.();
            const cleanup = effect.run();
            effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
        }),
        unmount: () => effects.forEach((effect) => effect.cleanup?.()),
    };
}

t.test('the ending meeting cancels its in-flight answers before saving the record', async (t) => {
    const { IntelligenceManager } = mockRequire(electronFile('IntelligenceManager'), {
        electron: {},
        [electronFile('db/DatabaseManager')]: { DatabaseManager: { getInstance: () => ({}) } },
        [electronFile('core/LLMHelper')]: { LLMHelper: class {} },
        [electronFile('core/IntelligenceEngine')]: { IntelligenceEngine: EventEmitter },
        [electronFile('agent/workspace')]: { renameMeetingFolder: async () => {} },
    }) as { IntelligenceManager: typeof Intelligence };
    const intelligence = new IntelligenceManager({} as never, () => null);
    const calls: string[] = [];
    Reflect.set(intelligence, 'engine', { cancelGeneration: () => { calls.push('cancel'); } });
    Reflect.set(intelligence, 'persistence', { stopMeeting: async () => { calls.push('persist'); return 'meeting-1'; } });
    t.equal(await intelligence.stopMeeting(1_700_000_000_000), 'meeting-1', 'the saved meeting id is passed through');
    t.same(calls, ['cancel', 'persist'], 'an answer still streaming is cancelled, then the record is saved');
});

const appStubs = {
    [at('src/components/PikaInterface.tsx')]: asDefault(marker),
    [at('src/components/SettingsPopup.tsx')]: asDefault(marker),
    [at('src/components/Launcher.tsx')]: asDefault(marker),
    [at('src/components/ModelSelectorWindow.tsx')]: asDefault(marker),
    [at('src/components/SettingsOverlay.tsx')]: asDefault(marker),
    [at('src/components/StartupSequence.tsx')]: asDefault(marker),
    [at('src/components/ErrorBoundary.tsx')]: { ErrorBoundary: passthrough },
    [at('src/components/ui/toast.tsx')]: { ToastProvider: passthrough, ToastViewport: passthrough },
};

t.test('a session reset remounts the overlay, and nothing else does', (t) => {
    const screen = host('src/App.tsx', '?window=overlay', appStubs);
    const overlay = () => elements(screen.draw()).find((element) => element.type === marker)!;
    const startMeeting = () => screen.calls('onSessionReset').forEach(([callback]) => (callback as () => void)());

    const key = overlay().key;
    t.ok(key !== null && key !== undefined, 'the interface is keyed, so React can replace it');
    t.equal(screen.calls('onSessionReset').length, 1, 'the overlay listens once for the session reset');

    startMeeting();
    const secondKey = overlay().key;
    t.notSame(secondKey, key, 'starting a meeting draws a different interface: the last meeting is gone');
    startMeeting();
    t.notSame(overlay().key, secondKey, 'every meeting, not only the first, gets its own interface');

    const afterStart = overlay().key;
    screen.draw();
    t.same(overlay().key, afterStart, 'a redraw keeps the same interface');

    for (const search of ['?window=launcher', '?window=settings']) {
        const other = host('src/App.tsx', search, appStubs);
        other.draw();
        t.notOk(other.calls('onSessionReset').length, `${search} holds no meeting state, so it never resets`);
    }
    t.end();
});

const stopped: string[] = [];
const interfaceStubs = {
    [at('src/components/meeting/ChatColumn.tsx')]: asDefault(marker),
    [at('src/components/meeting/SplitterShell.tsx')]: asDefault(marker),
    [at('src/components/meeting/TranscriptColumn.tsx')]: asDefault(marker),
    [at('src/components/meeting/OverlayTopBar.tsx')]: asDefault(marker),
    [at('src/components/agent/ProactiveCard.tsx')]: asDefault(marker),
    [at('src/components/agent/ApprovalDock.tsx')]: asDefault(marker),
    [at('src/hooks/useShortcuts.ts')]: { useShortcuts: () => ({ shortcuts: {}, isShortcutPressed: () => false }) },
    [at('src/hooks/useResolvedTheme.ts')]: { useResolvedTheme: () => 'dark' },
    [at('src/hooks/useMainEvent.ts')]: { useMainEvent: () => {} },
    [at('src/hooks/useWindowEvent.ts')]: { useWindowEvent: () => {} },
    [at('src/hooks/useLocalStorageValue.ts')]: { useLocalStorageValue: () => [null, () => {}] },
    [at('src/hooks/useMeetingChat.ts')]: { useMeetingChat: () => ({
        stop: () => { stopped.push('stop'); }, setSystemMessages: () => {}, setInputValue: () => {}, setAttachedContext: () => {},
        setIsProcessing: () => {}, messages: [], attachedContext: [], actionButtonMode: 'recap', inputValue: '', isProcessing: false,
        canRetry: false, stopGeneration: () => {}, retryLast: () => {}, handleWhatToSay: () => {}, handleClarify: () => {},
        handleFollowUpQuestions: () => {}, handleRecap: () => {}, handleBrainstorm: () => {}, handleManualSubmit: () => {},
    }) },
    [at('src/hooks/useMeetingTranscript.ts')]: { useMeetingTranscript: () => ({
        transcriptSegments: [], isThemSpeaking: false, currentThemPartial: '', livePartial: null, showTranscript: true, transcriptDisplayMode: 'original',
        translationEnabled: false, translationConfigured: false, theirLanguage: 'english-us', myLanguage: 'english-us',
        targetLanguage: 'chinese', languageOptions: [], saveTranslationSettings: () => {}, changeSpokenLanguage: () => {},
    }) },
    [at('src/hooks/useMeetingAudio.ts')]: { useMeetingAudio: () => ({ audioStatusInput: {}, setManualTranscript: () => {}, setVoiceInput: () => {} }) },
    [at('src/lib/overlayAppearance.ts')]: { getDefaultOverlayOpacity: () => 0.85, getOverlayAppearance: () => ({}) },
    [at('src/lib/answerScroll.ts')]: { isNearBottom: () => true, nextScrollAction: () => 'none' },
    [at('src/lib/transcriptDisplay.ts')]: { toggleOriginal: (mode: string) => mode },
    [at('src/lib/audioStatus.ts')]: { audioStatus: () => ({ key: 'live' }) },
    [at('src/lib/answerLead.ts')]: { latestOtherPartyText: () => '' },
};

t.test('leaving the interface stops the answer that is still streaming', (t) => {
    const screen = host('src/components/PikaInterface.tsx', '?window=overlay', interfaceStubs);
    screen.draw();
    t.notOk(screen.calls('showWindow').length, 'mounting does not show a window: a remount must not touch the one the user has');
    t.same(stopped, [], 'a running answer is left alone while the meeting goes on');
    screen.unmount();
    t.same(stopped, ['stop'], 'the interface stops the stream it opened when it goes away');
    t.end();
});

t.test('StrictMode replay does not show a window during a meeting remount', (t) => {
    const screen = host('src/components/PikaInterface.tsx', '?window=overlay', interfaceStubs);
    screen.draw();
    screen.replayMountEffects();
    t.notOk(screen.calls('showWindow').length, 'replaying mount effects still leaves window switching to main');
    screen.unmount();
    t.end();
});
