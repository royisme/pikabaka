import { BrowserWindow, dialog } from "electron"
import { safeHandle } from "./safeHandle"
import { CredentialsManager } from "../services/CredentialsManager"
import { getApprovalBroker } from "../agent/instance"
import { validateRoot } from "../agent/workspace"

export function registerApprovalHandlers(): void {
  const broker = getApprovalBroker()
  broker.onEvent((event) => {
    BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('agent-approval', event))
  })

  safeHandle("agent-approvals-list", async () => broker.list())

  safeHandle("agent-approval-respond", async (_, payload: { id: string; allowed: boolean }) => {
    if (typeof payload?.id !== 'string' || typeof payload.allowed !== 'boolean') return { success: false }
    return { success: broker.respond(payload.id, payload.allowed) }
  })

  safeHandle("agent-workspace-get", async () => {
    const root = CredentialsManager.getInstance().getAgentWorkspaceRoot()
    return { root, error: root ? await validateRoot(root) : undefined }
  })

  safeHandle("agent-workspace-pick", async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose the workspace folder' })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const problem = await validateRoot(result.filePaths[0])
    if (problem) return { canceled: false, error: problem }
    CredentialsManager.getInstance().setAgentWorkspaceRoot(result.filePaths[0])
    return { canceled: false, root: result.filePaths[0] }
  })

  safeHandle("agent-workspace-clear", async () => {
    CredentialsManager.getInstance().setAgentWorkspaceRoot('')
    return { success: true }
  })
}
