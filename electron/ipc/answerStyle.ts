import { safeHandle } from "./safeHandle"
import { CredentialsManager } from "../services/CredentialsManager"

// How answers sound: a manner of speaking the user writes in Settings (free text, empty = the default).
export function registerAnswerStyleHandlers(): void {
  safeHandle("get-answer-style", async () => CredentialsManager.getInstance().getAnswerStyle())

  safeHandle("set-answer-style", async (_, style: string) => {
    if (typeof style !== 'string' || style.length > 1000) return { success: false, error: 'Invalid style' }
    CredentialsManager.getInstance().setAnswerStyle(style)
    return { success: true }
  })
}
