import { safeHandle } from "./safeHandle"
import { CredentialsManager } from "../services/CredentialsManager"
import { parseInterpretingPatch } from "../services/interpretingSettings"

export function registerInterpretingHandlers(): void {
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
}
