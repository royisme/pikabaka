import { safeHandle } from "./safeHandle"
import { CredentialsManager } from "../services/CredentialsManager"
import { parseInterpretingPatch } from "../services/interpretingSettings"
import type { AppState } from "../main"
import type { PlayedAck } from "../interpreting/InterpretingSession"

export function registerInterpretingHandlers(appState: AppState): void {
  safeHandle("interpreting:get-settings", async () => CredentialsManager.getInstance().getInterpretingSettings())

  // A bad field rejects the whole call with its reason; nothing is stored.
  safeHandle("interpreting:set-settings", async (_, settings: unknown) => {
    CredentialsManager.getInstance().setInterpretingSettings(parseInterpretingPatch(settings))
    return { success: true }
  })

  safeHandle("set-fish-audio-api-key", async (_, apiKey: unknown) => {
    if (typeof apiKey !== 'string') throw new Error('The Fish Audio key must be a string.')
    CredentialsManager.getInstance().setFishAudioApiKey(apiKey.trim())
    return { success: true }
  })

  safeHandle("interpreting:get-state", async () => appState.interpreting.getState())

  // The shortcut and the overlay button do the same thing. A refusal is a state with its reason, not a throw.
  safeHandle("interpreting:toggle-talk", async () => appState.interpreting.toggleTalk())

  // The overlay reports that a clip played or why it did not.
  safeHandle("interpreting:played", async (_, ack: PlayedAck) => {
    appState.interpreting.played({ id: String(ack?.id), ok: ack?.ok === true, error: typeof ack?.error === 'string' ? ack.error : undefined })
    return { success: true }
  })

  // The audio goes to the window that asked, so the settings window plays its own test.
  safeHandle("interpreting:test-voice", async (event) => {
    await appState.interpreting.testVoice((message) => event.sender.send('interpreting-audio', message))
    return { success: true }
  })
}
