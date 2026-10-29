import { dialog } from "electron"

import { AppState } from "../main"
import { safeHandle } from "./safeHandle"
import { ImportedDocument } from "../knowledge/types"
import { getAnswerSources, SettingsManager } from "../services/SettingsManager"

/** The two source switches the Sources page reads and writes, by the settings key each one owns. */
const ANSWER_SOURCE_KEYS = {
  meetings: 'answerUsesMeetings',
  materials: 'answerUsesMaterials',
} as const

export function registerKnowledgeHandlers(appState: AppState): void {
  safeHandle("answer-sources:get", async () => getAnswerSources());

  // A partial payload is enough: the page sends only the switch the user moved. Every key is checked before any write.
  safeHandle("answer-sources:set", async (_, sources: unknown) => {
    if (typeof sources !== 'object' || sources === null || Array.isArray(sources)) {
      return { success: false, error: 'Invalid answer sources' };
    }
    const entries = Object.entries(sources);
    for (const [key, value] of entries) {
      if (!(key in ANSWER_SOURCE_KEYS)) return { success: false, error: `Unknown setting: ${key}` };
      if (typeof value !== 'boolean') return { success: false, error: `${key} must be true or false` };
    }
    const manager = SettingsManager.getInstance();
    for (const [key, value] of entries) manager.set(ANSWER_SOURCE_KEYS[key as keyof typeof ANSWER_SOURCE_KEYS], value as boolean);
    return { success: true };
  });

  // The user's own facts, one per line: saved as a document that questions are matched against.
  safeHandle("profile:get-notes", async () => appState.getKnowledgeOrchestrator()?.getNotes() ?? '');

  // Whether the notes are searchable now: the Sources page shows it next to the notes.
  safeHandle("profile:get-status", async () => ({ notesIndex: appState.getKnowledgeOrchestrator()?.getStatus().notesIndex }));

  safeHandle("profile:set-notes", async (_, text: string) => {
    const orchestrator = appState.getKnowledgeOrchestrator();
    if (!orchestrator) return { success: false, error: 'Knowledge engine not initialized. Please ensure API keys are configured.' };
    if (typeof text !== 'string' || text.length > 40_000) return { success: false, error: 'The notes are too long.' };
    await orchestrator.setNotes(text);
    return { success: true };
  });

  // ==========================================
  // Imported documents
  // ==========================================

  const documents = () => {
    const orchestrator = appState.getKnowledgeOrchestrator();
    if (!orchestrator) throw new Error('Knowledge engine not initialized. Please ensure API keys are configured.');
    return orchestrator;
  };

  // A material id is an integer whose row the list reports. The orchestrator repeats the check against the stored type.
  const materialId = (id: unknown): number | null => {
    const orchestrator = appState.getKnowledgeOrchestrator();
    if (typeof id !== 'number' || !Number.isInteger(id) || !orchestrator?.listDocuments().some((doc: ImportedDocument) => doc.id === id)) return null;
    return id;
  };

  safeHandle("knowledge:list-documents", async () => {
    try {
      return { success: true, documents: documents().listDocuments() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // The dialog opens here so the renderer never sends a path. A cancelled dialog is a normal reply, not an error.
  safeHandle("knowledge:import-document", async () => {
    try {
      const orchestrator = documents();
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{
          name: 'Documents',
          extensions: process.platform === 'darwin' ? ['txt', 'md', 'docx'] : ['txt', 'md'],
        }],
      });
      if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
      return { success: true, document: await orchestrator.importDocument(result.filePaths[0]) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("knowledge:remove-document", async (_, id: unknown) => {
    try {
      const docId = materialId(id);
      if (docId === null) return { success: false, error: 'That document is not in Pika.' };
      documents().removeDocument(docId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("knowledge:reindex-document", async (_, id: unknown) => {
    try {
      const docId = materialId(id);
      if (docId === null) return { success: false, error: 'That document is not in Pika.' };
      documents().reindexDocument(docId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
