// Product shots: mounts the app's real PikaInterface over a drawn backdrop and replays a sample scene.
// Sample content, invented for illustration.
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../src/components/ui/toast';
import PikaInterface from '../../src/components/PikaInterface';
import '../../src/index.css';
import './shots.css';
import { scenes, type Scene, type SceneId, type Step } from './fixture';
import { installElectronStub } from './stub';

declare global {
  interface Window {
    __shotReady?: boolean;
  }
}

const params = new URLSearchParams(window.location.search);
const sceneId: SceneId = params.get('scene') === 'client' ? 'client' : 'class';
const theme = params.get('theme') === 'light' ? 'light' : 'dark';
const scene = scenes[sceneId];

document.documentElement.setAttribute('data-theme', theme);
document.documentElement.setAttribute('data-platform', 'darwin');
// The split between transcript and chat is the user's own setting: here it gives the chat room for the card and an answer.
localStorage.setItem('pika_splitter_position', '20');
const { emit } = installElectronStub(scene);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function press(find: () => HTMLElement | undefined | null, what: string) {
  const element = find();
  if (!element) throw new Error(`Shot replay: ${what} not found`);
  element.click();
}

const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`);

/** Runs one step through the event or the control the app already has. */
async function run(step: Step, lines: Map<string, string>) {
  switch (step.kind) {
    case 'transcript':
      if (step.transcript.segmentId && step.transcript.final) lines.set(step.transcript.segmentId, step.transcript.text);
      emit('onNativeAudioTranscript', step.transcript);
      break;
    case 'card':
      emit('onAgentProactive', step.card);
      break;
    case 'askLine': {
      const text = lines.get(step.segmentId) ?? '';
      press(() => Array.from(document.querySelectorAll<HTMLElement>('[data-ask-line]')).find((b) => b.closest('.group')?.textContent?.includes(text)), 'the ask-line button');
      break;
    }
    case 'notRight':
      press(() => Array.from(document.querySelectorAll<HTMLElement>('aside button')).find((b) => b.textContent === 'Not right'), 'the Not right button');
      break;
    case 'submit': {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Ask a question"]');
      if (!input) throw new Error('Shot replay: the chat input not found');
      setInputValue(input, input.value + step.append);
      await wait(100);
      press(() => byLabel('Send'), 'the send button');
      break;
    }
    case 'agent':
      await wait(300);
      for (const event of step.events) {
        emit('onAgentEvent', event);
        await wait(80);
      }
      break;
  }
}

async function replay(current: Scene) {
  await wait(500);
  const lines = new Map<string, string>();
  for (const step of current.steps) {
    await run(step, lines);
    await wait(120);
  }
  await wait(800);
  window.__shotReady = true;
}

function Backdrop({ title }: { title: string }) {
  const tiles = ['AL', 'BM', 'CR', 'DS'];
  return (
    <div className="shot-desktop">
      <div className="shot-call" aria-hidden="true">
        <div className="shot-call-bar">
          <span className="shot-dot" />
          <span className="shot-dot" />
          <span className="shot-dot" />
          <span className="shot-call-title">{title}</span>
        </div>
        <div className="shot-tiles">
          {tiles.map((initials) => (
            <div key={initials} className="shot-tile">
              <span className="shot-avatar">{initials}</span>
            </div>
          ))}
        </div>
        <div className="shot-call-controls">
          <span /><span /><span className="shot-end" />
        </div>
      </div>
    </div>
  );
}

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Backdrop title={scene.callTitle} />
    <div className="shot-overlay">
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <PikaInterface />
        </ToastProvider>
      </QueryClientProvider>
    </div>
  </React.StrictMode>
);

void replay(scene);
