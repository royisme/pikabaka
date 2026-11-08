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
// The split between transcript and chat is the user's own setting: here it gives the transcript the rows and the chat the card and a reply.
localStorage.setItem('pika_splitter_position', '38');
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
async function run(step: Step) {
  switch (step.kind) {
    case 'transcript':
      emit('onNativeAudioTranscript', step.transcript);
      break;
    case 'card':
      emit('onAgentProactive', step.card);
      break;
    case 'reply':
      press(() => byLabel('Reply'), 'the Reply button');
      break;
    case 'stream':
      await wait(800);
      emit('onGeminiStreamToken', step.text);
      await wait(80);
      emit('onGeminiStreamDone', undefined);
      break;
  }
}

async function replay(current: Scene) {
  await wait(500);
  for (const step of current.steps) {
    await run(step);
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
