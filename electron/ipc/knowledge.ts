import { dialog } from "electron"

import { AppState } from "../main"
import { safeHandle } from "./safeHandle"
import { DocType } from "../knowledge/types"
import { CredentialsManager } from "../services/CredentialsManager"
import { getAnswerSources, SettingsManager } from "../services/SettingsManager"

/** The three source switches the Sources page reads and writes, by the settings key each one owns. */
const ANSWER_SOURCE_KEYS = {
  meetings: 'answerUsesMeetings',
  materials: 'answerUsesMaterials',
  profile: 'answerUsesProfile',
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

  // ==========================================
  // Profile Engine IPC Handlers
  // ==========================================

  safeHandle("profile:upload-resume", async (_, filePath: string) => {
    try {
      console.log(`[IPC] profile:upload-resume called with: ${filePath}`);
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized. Please ensure API keys are configured.' };
      }

      const result = await orchestrator.ingestDocument(filePath, DocType.RESUME);
      return result;
    } catch (error: any) {
      console.error('[IPC] profile:upload-resume error:', error);
      return { success: false, error: error.message };
    }
  });

  // The user's own facts, one per line: saved as a document that questions are matched against.
  safeHandle("profile:get-notes", async () => appState.getKnowledgeOrchestrator()?.getNotes() ?? '');

  safeHandle("profile:set-notes", async (_, text: string) => {
    const orchestrator = appState.getKnowledgeOrchestrator();
    if (!orchestrator) return { success: false, error: 'Knowledge engine not initialized. Please ensure API keys are configured.' };
    if (typeof text !== 'string' || text.length > 40_000) return { success: false, error: 'The notes are too long.' };
    await orchestrator.setNotes(text);
    return { success: true };
  });

  safeHandle("profile:get-status", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { hasProfile: false, profileMode: false };
      }
      // Map new KnowledgeStatus back to legacy UI shape temporarily
      const status = orchestrator.getStatus();
      return {
        hasProfile: status.hasResume,
        profileMode: status.activeMode,
        name: status.resumeSummary?.name,
        role: status.resumeSummary?.role,
        totalExperienceYears: status.resumeSummary?.totalExperienceYears,
        notesIndex: status.notesIndex,
      };
    } catch (error: any) {
      return { hasProfile: false, profileMode: false };
    }
  });

  safeHandle("profile:set-mode", async (_, enabled: boolean) => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      orchestrator.setKnowledgeMode(enabled);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:delete", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }

      orchestrator.deleteDocumentsByType(DocType.RESUME);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:get-profile", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return null;
      return orchestrator.getProfileData();
    } catch (error: any) {
      return null;
    }
  });

  safeHandle("profile:select-file", async () => {
    try {
      const result: any = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Resume Files', extensions: ['md', 'txt', 'pdf', 'docx'] }
        ]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { cancelled: true };
      }

      return { success: true, filePath: result.filePaths[0] };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // JD & Research IPC Handlers
  // ==========================================

  safeHandle("profile:upload-jd", async (_, filePath: string) => {
    try {
      console.log(`[IPC] profile:upload-jd called with: ${filePath}`);
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized. Please ensure API keys are configured.' };
      }

      const result = await orchestrator.ingestDocument(filePath, DocType.JD);
      return result;
    } catch (error: any) {
      console.error('[IPC] profile:upload-jd error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:delete-jd", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }

      orchestrator.deleteDocumentsByType(DocType.JD);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:research-company", async (_, companyName: string) => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const engine = orchestrator.getCompanyResearchEngine();

      const tavilyApiKey = CredentialsManager.getInstance().getTavilyApiKey();
      engine.setApiKey?.(tavilyApiKey || null);

      // Build full JD context so the dossier is tailored to the exact role
      const profileData = orchestrator.getProfileData();
      const activeJD = profileData?.activeJD;
      const jdCtx = activeJD ? {
        title: activeJD.title,
        location: activeJD.location,
        level: activeJD.level,
        technologies: activeJD.technologies,
        requirements: activeJD.requirements,
        keywords: activeJD.keywords,
        compensation_hint: activeJD.compensation_hint,
        min_years_experience: activeJD.min_years_experience,
      } : {};
      const dossier = await engine.researchCompany(companyName, jdCtx, Object.keys(jdCtx).length === 0);
      return { success: true, dossier };
    } catch (error: any) {
      console.error('[IPC] profile:research-company error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:generate-negotiation", async (_, force: boolean = false) => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const status = orchestrator.getStatus();
      if (!status.hasResume) {
        return { success: false, error: 'No resume loaded' };
      }

      // Use cache unless force-regenerating
      let script = force ? null : orchestrator.getNegotiationScript();
      if (!script) {
        script = await orchestrator.generateNegotiationScriptOnDemand();
      }
      if (!script) {
        return { success: false, error: 'Could not generate negotiation script. Ensure a resume and job description are uploaded.' };
      }
      return { success: true, script };
    } catch (error: any) {
      console.error('[IPC] profile:generate-negotiation error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:get-negotiation-state", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false, error: 'Engine not ready' };
      const tracker = orchestrator.getNegotiationTracker();
      return {
        success: true,
        state: tracker.getState(),
        isActive: tracker.isActive(),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("profile:reset-negotiation", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return { success: false };
      orchestrator.resetNegotiationSession();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle("set-tavily-api-key", async (_, apiKey: string) => {
    try {
      if (apiKey && !apiKey.startsWith('tvly-')) {
        return { success: false, error: 'Invalid Tavily API key. Keys must start with "tvly-".' };
      }
      CredentialsManager.getInstance().setTavilyApiKey(apiKey);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Multi-JD Management Handlers
  // ==========================================

  safeHandle("knowledge:get-all-jds", async () => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) return [];
      return orchestrator.getAllJDs();
    } catch (error: any) {
      console.error('[IPC] knowledge:get-all-jds error:', error);
      return [];
    }
  });

  safeHandle("knowledge:set-active-jd", async (_, docId: number) => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      orchestrator.setActiveJD(docId);
      return { success: true };
    } catch (error: any) {
      console.error('[IPC] knowledge:set-active-jd error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("knowledge:delete-jd", async (_, docId: number) => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      orchestrator.deleteJD(docId);
      return { success: true };
    } catch (error: any) {
      console.error('[IPC] knowledge:delete-jd error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("knowledge:upload-jd", async (_, filePath: string) => {
    try {
      console.log(`[IPC] knowledge:upload-jd called with: ${filePath}`);
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized. Please ensure API keys are configured.' };
      }
      const result = await orchestrator.ingestDocument(filePath, DocType.JD);
      return result;
    } catch (error: any) {
      console.error('[IPC] knowledge:upload-jd error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("knowledge:update-profile", async (_, updates: any) => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      // Sanitize: only allow known profile fields
      const allowedKeys = ['identity', 'skills', 'experience', 'projects', 'education', 'totalExperienceYears'];
      const sanitized = Object.fromEntries(
        Object.entries(updates || {}).filter(([k]) => allowedKeys.includes(k))
      );
      return orchestrator.updateProfileData(sanitized);
    } catch (error: any) {
      console.error('[IPC] knowledge:update-profile error:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle("knowledge:generate-prep", async (_, jdId?: number) => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      if (!orchestrator) {
        return { success: false, error: 'Knowledge engine not initialized' };
      }
      const prepData = await orchestrator.generateInterviewPrep(jdId);
      if (!prepData) {
        return { success: false, error: 'Could not generate prep. Ensure resume and JD are uploaded.' };
      }
      return { success: true, data: prepData };
    } catch (error: any) {
      console.error('[IPC] knowledge:generate-prep error:', error);
      return { success: false, error: error.message };
    }
  });
}
