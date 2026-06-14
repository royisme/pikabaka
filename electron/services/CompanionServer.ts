import http, { IncomingMessage, ServerResponse } from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { AddressInfo } from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';

export interface CompanionTranscriptSegment {
  segmentId?: string;
  speakerLabel?: string;
  speaker?: string;
  text: string;
  sourceText?: string;
  translatedText?: string;
  final?: boolean;
  timestamp?: number;
}

export interface CompanionChatMessage {
  id: string;
  role: string;
  text: string;
  isStreaming?: boolean;
  streamStatus?: string;
  intent?: string;
}

export interface CompanionSnapshot {
  updatedAt: number;
  transcriptSegments: CompanionTranscriptSegment[];
  currentInterviewerPartial?: string;
  messages: CompanionChatMessage[];
  currentModel?: string;
  provider?: string;
  providerName?: string;
  audioHealth?: any;
  meetingActive?: boolean;
}

export interface CompanionCommand {
  id: string;
  type: 'ask' | 'clarify' | 'recap' | 'brainstorm' | 'what_to_answer' | 'attach-file' | 'ping';
  payload?: any;
  receivedAt: number;
  deviceId?: string;
}

export interface CompanionDevice {
  id: string;
  name: string;
  pairedAt: number;
  lastSeenAt: number;
  userAgent?: string;
  remoteAddress?: string;
}

export interface CompanionPairing {
  token: string;
  url: string;
  qrDataUrl: string;
  expiresAt: number;
}

export interface CompanionStatus {
  running: boolean;
  port: number | null;
  urls: string[];
  activeConnections: number;
  pairedDevices: CompanionDevice[];
  pairing?: CompanionPairing | null;
}

interface CompanionServerOptions {
  userDataDir: string;
  onCommand?: (command: CompanionCommand) => void;
  onStatusChanged?: (status: CompanionStatus) => void;
}

type JsonObject = Record<string, any>;

const MAX_JSON_BYTES = 10 * 1024 * 1024;
const PAIRING_TTL_MS = 5 * 60 * 1000;

export class CompanionServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private port: number | null = null;
  private pairing: CompanionPairing | null = null;
  private devices = new Map<string, CompanionDevice>();
  private sockets = new Map<WebSocket, string>();
  private snapshot: CompanionSnapshot = {
    updatedAt: Date.now(),
    transcriptSegments: [],
    messages: [],
  };

  constructor(private options: CompanionServerOptions) {}

  public async start(preferredPort = 0): Promise<CompanionStatus> {
    if (this.server) return this.getStatus();

    this.server = http.createServer((req, res) => {
      this.handleHttp(req, res).catch((error) => {
        console.error('[CompanionServer] HTTP error:', error);
        this.sendJson(res, 500, { error: 'Internal server error' });
      });
    });

    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
      this.handleSocket(socket, req, String((req as any).companionDeviceId || 'unknown'));
    });

    this.server.on('upgrade', (req, socket, head) => {
      const parsed = new URL(req.url || '/', this.getLocalBaseUrl());
      if (parsed.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      const auth = this.authenticate(parsed.searchParams.get('token') || undefined, req);
      if (!auth.ok || !auth.deviceId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      (req as any).companionDeviceId = auth.deviceId;
      this.wss?.handleUpgrade(req, socket, head, (ws) => {
        this.wss?.emit('connection', ws, req);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(preferredPort, '0.0.0.0', () => resolve());
    });

    const address = this.server.address() as AddressInfo;
    this.port = address.port;
    this.emitStatus();
    return this.getStatus();
  }

  public async stop(): Promise<CompanionStatus> {
    const sockets = [...this.sockets.keys()];
    sockets.forEach((socket) => socket.close(1001, 'Companion stopped'));
    this.sockets.clear();
    this.wss?.close();
    this.wss = null;

    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
    this.server = null;
    this.port = null;
    this.pairing = null;
    this.emitStatus();
    return this.getStatus();
  }

  public async createPairingCode(): Promise<CompanionStatus> {
    if (!this.server) await this.start();
    const token = this.generateToken();
    const url = `${this.getBestLanBaseUrl()}/pair?token=${encodeURIComponent(token)}`;
    this.pairing = {
      token,
      url,
      qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 320 }),
      expiresAt: Date.now() + PAIRING_TTL_MS,
    };
    this.emitStatus();
    return this.getStatus();
  }

  public getStatus(): CompanionStatus {
    this.dropExpiredPairing();
    return {
      running: !!this.server,
      port: this.port,
      urls: this.getUrls(),
      activeConnections: this.sockets.size,
      pairedDevices: [...this.devices.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt),
      pairing: this.pairing ? { ...this.pairing } : null,
    };
  }

  public updateSnapshot(partial: Partial<CompanionSnapshot>): CompanionSnapshot {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
      transcriptSegments: partial.transcriptSegments ?? this.snapshot.transcriptSegments,
      messages: partial.messages ?? this.snapshot.messages,
      updatedAt: Date.now(),
    };
    this.broadcast('snapshot', this.snapshot);
    return this.snapshot;
  }

  public revokeDevice(deviceId: string): CompanionStatus {
    this.devices.delete(deviceId);
    for (const [socket, id] of this.sockets.entries()) {
      if (id === deviceId) {
        socket.close(4001, 'Device revoked');
        this.sockets.delete(socket);
      }
    }
    this.emitStatus();
    return this.getStatus();
  }

  public broadcast(type: string, payload: any): void {
    const message = JSON.stringify({ type, payload, sentAt: Date.now() });
    for (const socket of this.sockets.keys()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = new URL(req.url || '/', this.getLocalBaseUrl());

    if (req.method === 'GET' && parsed.pathname === '/health') {
      this.sendJson(res, 200, { ok: true, status: this.getStatus() });
      return;
    }

    if (req.method === 'GET' && (parsed.pathname === '/' || parsed.pathname === '/pair' || parsed.pathname === '/companion')) {
      const token = parsed.searchParams.get('token') || '';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(this.renderCompanionHtml(token));
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/api/snapshot') {
      const auth = this.authenticate(parsed.searchParams.get('token') || undefined, req);
      if (!auth.ok) return this.sendJson(res, 401, { error: auth.error });
      this.sendJson(res, 200, { snapshot: this.snapshot, status: this.getStatus() });
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/api/command') {
      const auth = this.authenticate(parsed.searchParams.get('token') || undefined, req);
      if (!auth.ok || !auth.deviceId) return this.sendJson(res, 401, { error: auth.error });
      const body = await this.readJson(req);
      const command = this.buildCommand(body.type, body.payload, auth.deviceId);
      this.options.onCommand?.(command);
      this.broadcast('command-ack', command);
      this.sendJson(res, 200, { ok: true, command });
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/api/upload') {
      const auth = this.authenticate(parsed.searchParams.get('token') || undefined, req);
      if (!auth.ok || !auth.deviceId) return this.sendJson(res, 401, { error: auth.error });
      const body = await this.readJson(req);
      const uploaded = this.saveUpload(body);
      const command = this.buildCommand('attach-file', uploaded, auth.deviceId);
      this.options.onCommand?.(command);
      this.broadcast('command-ack', command);
      this.sendJson(res, 200, { ok: true, uploaded, command });
      return;
    }

    this.sendJson(res, 404, { error: 'Not found' });
  }

  private handleSocket(socket: WebSocket, req: IncomingMessage, deviceId: string): void {
    this.sockets.set(socket, deviceId);
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastSeenAt = Date.now();
      device.userAgent = req.headers['user-agent'];
      device.remoteAddress = req.socket.remoteAddress;
    }
    socket.send(JSON.stringify({ type: 'hello', payload: { deviceId, status: this.getStatus(), snapshot: this.snapshot }, sentAt: Date.now() }));
    this.emitStatus();

    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(String(raw));
        if (message?.type === 'command') {
          const command = this.buildCommand(message.commandType || message.payload?.type || 'ask', message.payload, deviceId);
          this.options.onCommand?.(command);
          this.broadcast('command-ack', command);
        }
      } catch (error) {
        socket.send(JSON.stringify({ type: 'error', payload: { error: String(error) }, sentAt: Date.now() }));
      }
    });

    socket.on('close', () => {
      this.sockets.delete(socket);
      const current = this.devices.get(deviceId);
      if (current) current.lastSeenAt = Date.now();
      this.emitStatus();
    });
  }

  private authenticate(token: string | undefined, req: IncomingMessage): { ok: boolean; deviceId?: string; error?: string } {
    this.dropExpiredPairing();
    if (!token) return { ok: false, error: 'Missing pairing token' };
    const existing = [...this.devices.values()].find((device) => device.id === token);
    if (existing) {
      existing.lastSeenAt = Date.now();
      return { ok: true, deviceId: existing.id };
    }
    if (!this.pairing || token !== this.pairing.token || this.pairing.expiresAt < Date.now()) {
      return { ok: false, error: 'Pairing token expired or invalid' };
    }
    const id = token;
    this.devices.set(id, {
      id,
      name: this.guessDeviceName(req),
      pairedAt: Date.now(),
      lastSeenAt: Date.now(),
      userAgent: req.headers['user-agent'],
      remoteAddress: req.socket.remoteAddress,
    });
    this.pairing = null;
    this.emitStatus();
    return { ok: true, deviceId: id };
  }

  private buildCommand(type: any, payload: any, deviceId: string): CompanionCommand {
    const allowed = new Set(['ask', 'clarify', 'recap', 'brainstorm', 'what_to_answer', 'attach-file', 'ping']);
    const normalizedType = allowed.has(String(type)) ? String(type) as CompanionCommand['type'] : 'ask';
    return {
      id: crypto.randomUUID(),
      type: normalizedType,
      payload: payload || {},
      receivedAt: Date.now(),
      deviceId,
    };
  }

  private saveUpload(body: JsonObject): JsonObject {
    const name = this.safeFilename(body.name || `companion-${Date.now()}`);
    const mime = String(body.mime || 'application/octet-stream');
    const raw = String(body.dataBase64 || body.data || '');
    const data = raw.includes(',') ? raw.split(',').pop() || '' : raw;
    const buffer = Buffer.from(data, 'base64');
    if (!buffer.length) throw new Error('Upload is empty');
    if (buffer.length > MAX_JSON_BYTES) throw new Error('Upload is too large');
    const dir = path.join(this.options.userDataDir, 'companion-uploads');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${Date.now()}-${name}`);
    fs.writeFileSync(filePath, buffer);
    return {
      path: filePath,
      name,
      mime,
      size: buffer.length,
      preview: mime.startsWith('image/') ? `data:${mime};base64,${buffer.toString('base64')}` : undefined,
    };
  }

  private async readJson(req: IncomingMessage): Promise<JsonObject> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > MAX_JSON_BYTES) throw new Error('Request too large');
      chunks.push(buffer);
    }
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  }

  private sendJson(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  private getUrls(): string[] {
    if (!this.port) return [];
    return [`http://127.0.0.1:${this.port}`, ...this.getLanHosts().map((host) => `http://${host}:${this.port}`)];
  }

  private getBestLanBaseUrl(): string {
    return this.getUrls().find((url) => !url.includes('127.0.0.1')) || this.getLocalBaseUrl();
  }

  private getLocalBaseUrl(): string {
    return `http://127.0.0.1:${this.port || 0}`;
  }

  private getLanHosts(): string[] {
    const hosts = new Set<string>();
    for (const infos of Object.values(os.networkInterfaces())) {
      for (const info of infos || []) {
        if (info.family === 'IPv4' && !info.internal) hosts.add(info.address);
      }
    }
    return [...hosts];
  }

  private generateToken(): string {
    return crypto.randomBytes(24).toString('base64url');
  }

  private safeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'upload.bin';
  }

  private guessDeviceName(req: IncomingMessage): string {
    const ua = String(req.headers['user-agent'] || 'Phone companion');
    if (/iphone/i.test(ua)) return 'iPhone';
    if (/android/i.test(ua)) return 'Android phone';
    if (/ipad/i.test(ua)) return 'iPad';
    return 'Companion device';
  }

  private dropExpiredPairing(): void {
    if (this.pairing && this.pairing.expiresAt < Date.now()) this.pairing = null;
  }

  private emitStatus(): void {
    this.options.onStatusChanged?.(this.getStatus());
  }

  private renderCompanionHtml(token: string): string {
    const escapedToken = JSON.stringify(token || '');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Pika Phone Companion</title>
<style>
:root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; background:#08090b; color:#f7f7f8; }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; background: radial-gradient(circle at top, #20263a 0, #0b0d12 42%, #050609 100%); }
.app { max-width: 760px; margin:0 auto; padding:18px 14px 32px; }
.header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
.brand { display:flex; align-items:center; gap:10px; font-weight:700; letter-spacing:-.02em; }
.dot { width:10px; height:10px; border-radius:50%; background:#f59e0b; box-shadow:0 0 18px #f59e0b; }
.dot.ok { background:#34d399; box-shadow:0 0 18px #34d399; }
.status { color:#aab1c4; font-size:12px; }
.card { border:1px solid rgba(255,255,255,.1); border-radius:18px; background:rgba(14,18,28,.76); backdrop-filter: blur(18px); padding:14px; margin:10px 0; box-shadow:0 18px 60px rgba(0,0,0,.22); }
.grid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:10px; }
button, textarea, input { font:inherit; }
button { border:1px solid rgba(255,255,255,.1); background:rgba(255,255,255,.08); color:#f7f7f8; border-radius:14px; padding:12px 10px; font-weight:650; }
button.primary { background:linear-gradient(135deg,#7c3aed,#2563eb); border-color:transparent; }
button:active { transform: translateY(1px); }
textarea { width:100%; min-height:90px; resize:vertical; border-radius:14px; border:1px solid rgba(255,255,255,.12); background:rgba(0,0,0,.3); color:#fff; padding:12px; outline:none; }
.small { font-size:12px; color:#aab1c4; }
.list { display:flex; flex-direction:column; gap:8px; max-height:34vh; overflow:auto; }
.item { padding:10px; border-radius:14px; background:rgba(255,255,255,.055); }
.speaker { font-size:11px; color:#8fb3ff; font-weight:700; text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px; }
.msg.user .speaker { color:#86efac; }
.empty { color:#7f879a; text-align:center; padding:18px 4px; }
.file { display:block; margin-top:8px; }
</style>
</head>
<body>
<div class="app">
  <div class="header"><div class="brand"><span id="dot" class="dot"></span><span>Pika Companion</span></div><div id="status" class="status">Connecting…</div></div>
  <div class="card">
    <div class="small">Model</div>
    <div id="model">—</div>
    <div class="small" id="audio">Waiting for desktop state…</div>
  </div>
  <div class="card">
    <textarea id="ask" placeholder="Ask Pika from your phone…"></textarea>
    <div class="grid" style="margin-top:10px">
      <button class="primary" data-command="ask">Ask</button>
      <button data-command="what_to_answer">What to say</button>
      <button data-command="clarify">Clarify</button>
      <button data-command="recap">Recap</button>
      <button data-command="brainstorm">Brainstorm</button>
      <button id="attachBtn">Send file/photo</button>
    </div>
    <input id="file" class="file" type="file" accept="image/*,.pdf,.txt,.md" hidden />
    <div id="sendStatus" class="small" style="margin-top:8px"></div>
  </div>
  <div class="card"><div class="small">Live transcript</div><div id="transcript" class="list"><div class="empty">No transcript yet.</div></div></div>
  <div class="card"><div class="small">AI answers</div><div id="messages" class="list"><div class="empty">No answers yet.</div></div></div>
</div>
<script>
const token = ${escapedToken} || new URLSearchParams(location.search).get('token') || '';
const statusEl = document.getElementById('status');
const dot = document.getElementById('dot');
const sendStatus = document.getElementById('sendStatus');
let ws;
function escapeHtml(s){ return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function connect(){
  if (!token) { statusEl.textContent='Missing pairing token'; return; }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws?token=' + encodeURIComponent(token));
  ws.onopen = () => { statusEl.textContent='Connected'; dot.classList.add('ok'); };
  ws.onclose = () => { statusEl.textContent='Disconnected — retrying'; dot.classList.remove('ok'); setTimeout(connect, 1500); };
  ws.onerror = () => { statusEl.textContent='Connection error'; };
  ws.onmessage = (event) => { const msg = JSON.parse(event.data); if (msg.payload?.snapshot) render(msg.payload.snapshot); if (msg.type === 'snapshot') render(msg.payload); if (msg.type === 'command-ack') sendStatus.textContent='Sent: ' + msg.payload.type; };
}
function render(snapshot){
  document.getElementById('model').textContent = [snapshot.providerName || snapshot.provider, snapshot.currentModel].filter(Boolean).join(' · ') || '—';
  document.getElementById('audio').textContent = snapshot.audioHealth?.lastError ? 'Audio: ' + snapshot.audioHealth.lastError : (snapshot.meetingActive ? 'Meeting active' : 'Meeting idle');
  const transcript = (snapshot.transcriptSegments || []).slice(-24).map(s => '<div class="item"><div class="speaker">'+escapeHtml(s.speakerLabel || s.speaker || 'Speaker')+'</div>'+escapeHtml(s.translatedText || s.text || s.sourceText || '')+'</div>').join('');
  document.getElementById('transcript').innerHTML = transcript || '<div class="empty">No transcript yet.</div>';
  const messages = (snapshot.messages || []).filter(m => m.role !== 'user').slice(-12).map(m => '<div class="item msg '+escapeHtml(m.role)+'"><div class="speaker">'+escapeHtml(m.intent || m.role || 'Pika')+'</div>'+escapeHtml(m.text || m.streamStatus || '')+'</div>').join('');
  document.getElementById('messages').innerHTML = messages || '<div class="empty">No answers yet.</div>';
}
async function post(path, body){
  const res = await fetch(path + '?token=' + encodeURIComponent(token), { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
document.querySelectorAll('[data-command]').forEach(btn => btn.addEventListener('click', async () => {
  const type = btn.dataset.command; const text = document.getElementById('ask').value.trim();
  sendStatus.textContent='Sending…';
  try { await post('/api/command', { type, payload: { text } }); if (type === 'ask') document.getElementById('ask').value=''; sendStatus.textContent='Sent'; } catch(e) { sendStatus.textContent='Error: ' + e.message; }
}));
document.getElementById('attachBtn').addEventListener('click', () => document.getElementById('file').click());
document.getElementById('file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return; sendStatus.textContent='Uploading…';
  const reader = new FileReader();
  reader.onload = async () => { try { await post('/api/upload', { name:file.name, mime:file.type || 'application/octet-stream', data:String(reader.result) }); sendStatus.textContent='Uploaded'; } catch(e) { sendStatus.textContent='Upload error: ' + e.message; } };
  reader.readAsDataURL(file);
});
connect();
</script>
</body>
</html>`;
  }
}

export default CompanionServer;
