import { app, BrowserWindow } from "electron"
import { AppState } from "../main"
import { safeHandle } from "./safeHandle"
import { CredentialsManager } from "../services/CredentialsManager"
import { draftCard, getGate, refreshGate } from "../agent/instance"
import { latestGateMeeting, readGateDecisions } from "../agent/gateLog"

const MODES = ['log', 'on', 'off']

export function registerGateHandlers(appState: AppState): void {
  // Mode "on": a decision that passed becomes a card in the overlay.
  getGate().onDecision(async (decision) => {
    const card = await draftCard(decision)
    if (card) BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('agent-proactive', card))
  })

  safeHandle("agent-gate-get-settings", async () => {
    const cm = CredentialsManager.getInstance()
    return {
      mode: cm.getAgentGateMode(),
      model: cm.getAgentGateModel(),
      baseUrl: cm.getAgentGateBaseUrl(),
      hasApiKey: cm.getAgentGateApiKey() !== '',
      threshold: cm.getAgentGateThreshold(),
      cooldownSeconds: cm.getAgentGateCooldownSeconds(),
    }
  })

  // A missing apiKey leaves the stored key as it is; an empty string clears it.
  safeHandle("agent-gate-set-settings", async (_, settings: {
    mode?: 'log' | 'on' | 'off'
    model?: string
    baseUrl?: string
    apiKey?: string
    threshold?: number
    cooldownSeconds?: number
  }) => {
    if (typeof settings !== 'object' || settings === null) return { success: false, error: 'Invalid settings' }
    if (settings.mode !== undefined && !MODES.includes(settings.mode)) return { success: false, error: 'Invalid mode' }
    for (const key of ['model', 'baseUrl', 'apiKey'] as const) {
      const value = settings[key]
      if (value !== undefined && (typeof value !== 'string' || value.length > 2048)) return { success: false, error: `Invalid ${key}` }
    }
    if (settings.baseUrl) {
      try { new URL(settings.baseUrl) } catch { return { success: false, error: 'The base URL is not a valid URL' } }
    }
    const { threshold, cooldownSeconds } = settings
    if (threshold !== undefined && !(typeof threshold === 'number' && threshold >= 0 && threshold <= 1)) return { success: false, error: 'The threshold must be between 0 and 1' }
    if (cooldownSeconds !== undefined && !(typeof cooldownSeconds === 'number' && cooldownSeconds >= 0 && cooldownSeconds <= 86400)) return { success: false, error: 'Invalid cooldown' }
    CredentialsManager.getInstance().setAgentGateSettings(settings)
    await refreshGate()
    return { success: true }
  })

  safeHandle("agent-gate-status", async () => {
    await refreshGate()
    return getGate().status()
  })

  // The last decisions of the current meeting, or of the most recent one when none runs. Newest first.
  safeHandle("agent-gate-log", async () => {
    const dir = app.getPath('userData')
    const meetingId = appState.getCurrentMeetingId() ?? await latestGateMeeting(dir)
    return meetingId ? readGateDecisions(dir, meetingId, 50) : []
  })
}
