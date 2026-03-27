import path from 'path';

import { KnowledgeDatabaseManager } from './KnowledgeDatabaseManager';
import { DocumentParser } from './DocumentParser';
import { ProfileExtractor } from './ProfileExtractor';
import { JDAnalyzer } from './JDAnalyzer';
import { KnowledgeVectorStore } from './KnowledgeVectorStore';
import { DepthScorer } from './DepthScorer';
import {
  DocType,
  ProfileData,
  JDData,
  KnowledgeStatus,
  KnowledgeResult,
  GenerateContentFn,
  EmbedFn,
  EmbedQueryFn,
  CompanyDossier,
  NegotiationScript,
  NegotiationState,
} from './types';
import { buildContextEnhancementPrompt, buildIntroResponsePrompt } from './prompts';

export class KnowledgeOrchestrator {
  private db: KnowledgeDatabaseManager;
  private parser: DocumentParser;
  private profileExtractor: ProfileExtractor | null = null;
  private jdAnalyzer: JDAnalyzer | null = null;
  private vectorStore: KnowledgeVectorStore;
  private depthScorer: DepthScorer;

  private generateContentFn: GenerateContentFn | null = null;
  private embedFn: EmbedFn | null = null;
  private embedQueryFn: EmbedQueryFn | null = null;
  private knowledgeMode: boolean = false;

  private cachedProfileData: ProfileData | null = null;
  private cachedNegotiationScript: NegotiationScript | null = null;

  private companyResearchEngine: {
    researchCompany: (company: string, jdCtx: any, useCache: boolean) => Promise<CompanyDossier>;
    setSearchProvider: (provider: any) => void;
  } | null = null;
  private negotiationTracker: {
    getState: () => NegotiationState;
    isActive: () => boolean;
    reset: () => void;
    setScript: (script: NegotiationScript) => void;
    feedUtterance: (text: string) => void;
    getCoachingResponse: (text: string) => any;
  } | null = null;

  constructor(knowledgeDb: KnowledgeDatabaseManager) {
    this.db = knowledgeDb;
    this.parser = new DocumentParser();
    this.vectorStore = new KnowledgeVectorStore(knowledgeDb.getDb());
    this.depthScorer = new DepthScorer();

    this.restoreState();
  }

  setGenerateContentFn(fn: GenerateContentFn): void {
    this.generateContentFn = fn;
    this.profileExtractor = new ProfileExtractor(fn);
    this.jdAnalyzer = new JDAnalyzer(fn);
  }

  setEmbedFn(fn: EmbedFn): void {
    this.embedFn = fn;
  }

  setEmbedQueryFn(fn: EmbedQueryFn): void {
    this.embedQueryFn = fn;
  }

  async ingestDocument(filePath: string, docType: DocType): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.generateContentFn || !this.profileExtractor || !this.jdAnalyzer) {
        return { success: false, error: 'LLM not configured. Please set up an API key first.' };
      }

      console.log(`[KnowledgeOrchestrator] Parsing ${docType}: ${filePath}`);
      const { text } = await this.parser.parse(filePath);
      if (!text.trim()) {
        return { success: false, error: 'Document appears to be empty.' };
      }

      let parsedData: ProfileData | JDData;
      if (docType === DocType.RESUME) {
        parsedData = await this.profileExtractor.extract(text);
      } else {
        parsedData = await this.jdAnalyzer.analyze(text);
      }

      this.vectorStore.clearEmbeddings(docType);

      const fileName = path.basename(filePath);
      const docId = this.db.upsertDocument(docType, fileName, text, parsedData);
      const chunks = this.chunkDocument(text, docType);
      const chunkIds = this.db.saveChunks(docId, chunks);

      if (this.embedFn && chunkIds.length > 0) {
        void this.embedChunksBackground(
          chunkIds.map((id, index) => ({ id, text: chunks[index].text }))
        );
      }

      this.cachedProfileData = null;

      if (docType === DocType.RESUME) {
        this.knowledgeMode = true;
        this.cachedNegotiationScript = null;
        this.db.clearNegotiationState();
      }

      console.log(`[KnowledgeOrchestrator] Ingested ${docType}: ${chunks.length} chunks`);
      return { success: true };
    } catch (error: any) {
      console.error('[KnowledgeOrchestrator] ingestDocument error:', error);
      return { success: false, error: error?.message ?? 'Failed to ingest document.' };
    }
  }

  getStatus(): KnowledgeStatus {
    const resumeDoc = this.db.getDocumentByType(DocType.RESUME);
    if (!resumeDoc) {
      return { hasResume: false, activeMode: false };
    }

    let resumeSummary: KnowledgeStatus['resumeSummary'];
    try {
      const parsed = JSON.parse(resumeDoc.parsed_data);
      resumeSummary = {
        name: parsed.identity?.name || 'Unknown',
        role: parsed.experience?.[0]?.role || 'Professional',
        totalExperienceYears: parsed.totalExperienceYears || 0,
      };
    } catch {
      resumeSummary = { name: 'Unknown', role: 'Professional', totalExperienceYears: 0 };
    }

    return {
      hasResume: true,
      activeMode: this.knowledgeMode,
      resumeSummary,
    };
  }

  setKnowledgeMode(enabled: boolean): void {
    this.knowledgeMode = enabled;
  }

  isKnowledgeMode(): boolean {
    return this.knowledgeMode && this.db.getDocumentByType(DocType.RESUME) !== null;
  }

  deleteDocumentsByType(docType: DocType): void {
    this.vectorStore.clearEmbeddings(docType);
    this.db.deleteDocumentsByType(docType);
    this.cachedProfileData = null;

    if (docType === DocType.RESUME) {
      this.knowledgeMode = false;
      this.cachedNegotiationScript = null;
      this.db.clearNegotiationState();
    }
  }

  getProfileData(): ProfileData | null {
    if (this.cachedProfileData) {
      return this.cachedProfileData;
    }

    const resumeDoc = this.db.getDocumentByType(DocType.RESUME);
    if (!resumeDoc) {
      return null;
    }

    try {
      const profile = JSON.parse(resumeDoc.parsed_data) as ProfileData;

      profile.experience = Array.isArray(profile.experience) ? profile.experience : [];
      profile.projects = Array.isArray(profile.projects) ? profile.projects : [];
      profile.skills = Array.isArray(profile.skills) ? profile.skills : [];
      profile.education = Array.isArray(profile.education) ? profile.education : [];
      profile.identity = profile.identity ?? { name: 'Unknown' };

      profile.experienceCount = profile.experience.length;
      profile.projectCount = profile.projects.length;
      profile.nodeCount = profile.skills.length + profile.experience.length + profile.projects.length;
      profile.rawText = resumeDoc.raw_text;

      const jdDoc = this.db.getDocumentByType(DocType.JD);
      if (jdDoc) {
        profile.hasActiveJD = true;
        profile.activeJD = JSON.parse(jdDoc.parsed_data) as JDData;
      } else {
        profile.hasActiveJD = false;
        delete profile.activeJD;
      }

      if (this.cachedNegotiationScript) {
        profile.negotiationScript = this.cachedNegotiationScript;
      }

      if (profile.activeJD?.company) {
        const dossier = this.db.getCachedDossier(profile.activeJD.company);
        if (dossier) {
          profile.companyDossier = dossier;
        }
      }

      this.cachedProfileData = profile;
      return profile;
    } catch (error) {
      console.error('[KnowledgeOrchestrator] Failed to build profile data:', error);
      return null;
    }
  }

  getCompanyResearchEngine(): {
    researchCompany: (company: string, jdCtx: any, useCache: boolean) => Promise<CompanyDossier>;
    setSearchProvider?: (provider: any) => void;
    setApiKey?: (apiKey: string | null) => void;
  } {
    if (!this.generateContentFn) {
      throw new Error('Knowledge engine not fully initialized: no LLM function available');
    }
    if (!this.companyResearchEngine) {
      const { CompanyResearchEngine } = require('./CompanyResearchEngine');
      this.companyResearchEngine = new CompanyResearchEngine(this.generateContentFn, this.db);
    }

    return this.companyResearchEngine;
  }

  getNegotiationScript(): NegotiationScript | null {
    return this.cachedNegotiationScript;
  }

  async generateNegotiationScriptOnDemand(): Promise<NegotiationScript | null> {
    if (!this.generateContentFn) {
      return null;
    }

    const profile = this.getProfileData();
    if (!profile) {
      return null;
    }

    const { NegotiationEngine } = require('./NegotiationEngine');
    const engine = new NegotiationEngine(this.generateContentFn);
    const script = await engine.generateScript(
      profile,
      profile.activeJD || null,
      profile.companyDossier || null
    );

    this.cachedNegotiationScript = script;
    const tracker = this.getNegotiationTracker();
    if (tracker?.setScript) {
      tracker.setScript(script);
    }
    const resumeDoc = this.db.getDocumentByType(DocType.RESUME);
    const jdDoc = this.db.getDocumentByType(DocType.JD);
    this.db.saveNegotiationState(resumeDoc?.id ?? null, jdDoc?.id ?? null, script, tracker?.getState?.() ?? null);
    this.cachedProfileData = null;

    return script;
  }

  getNegotiationTracker(): {
    getState: () => any;
    isActive: () => boolean;
    reset?: () => void;
    setScript?: (script: NegotiationScript) => void;
    feedUtterance?: (text: string) => void;
    getCoachingResponse?: (text: string) => any;
  } {
    if (!this.negotiationTracker) {
      const { NegotiationTracker } = require('./NegotiationEngine');
      this.negotiationTracker = new NegotiationTracker();
    }

    return this.negotiationTracker;
  }

  resetNegotiationSession(): void {
    if (this.negotiationTracker?.reset) {
      this.negotiationTracker.reset();
    }

    this.cachedNegotiationScript = null;
    this.cachedProfileData = null;
    this.db.clearNegotiationState();
  }

  feedForDepthScoring(message: string): void {
    this.depthScorer.feed(message);
  }

  feedInterviewerUtterance(text: string): void {
    if (this.negotiationTracker?.feedUtterance) {
      this.negotiationTracker.feedUtterance(text);

      const resumeDoc = this.db.getDocumentByType(DocType.RESUME);
      const jdDoc = this.db.getDocumentByType(DocType.JD);
      this.db.saveNegotiationState(
        resumeDoc?.id ?? null,
        jdDoc?.id ?? null,
        this.cachedNegotiationScript,
        this.negotiationTracker.getState?.() ?? null,
      );
    }
  }

  async processQuestion(message: string): Promise<KnowledgeResult | null> {
    if (!this.isKnowledgeMode()) {
      return null;
    }

    try {
      if (this.isIntroQuestion(message)) {
        const profile = this.getProfileData();
        if (profile && this.generateContentFn) {
          const prompt = buildIntroResponsePrompt(profile);
          const introResponse = await this.generateContentFn([{ text: prompt }]);
          return { isIntroQuestion: true, introResponse };
        }
      }

      if (this.negotiationTracker?.isActive?.()) {
        const coaching = this.negotiationTracker.getCoachingResponse?.(message);
        if (coaching) {
          return { liveNegotiationResponse: coaching };
        }
      }

      if (this.embedQueryFn && this.vectorStore.hasEmbeddings()) {
        const queryEmbedding = await this.embedQueryFn(message);
        const results = this.vectorStore.searchSimilar(queryEmbedding, 5);

        if (results.length > 0) {
          const profile = this.getProfileData();
          const identityName = profile?.identity?.name || 'the candidate';
          const latestRole = profile?.experience?.[0]?.role || '';
          const totalExperienceYears = profile?.totalExperienceYears || 0;
          const identitySummary = `${identityName}, ${latestRole} with ${totalExperienceYears} years of experience`;
          const depthInstruction = this.depthScorer.getDepthInstruction();
          const contextChunks = results.map((result) => result.text);
          const systemPrompt = buildContextEnhancementPrompt(
            message,
            contextChunks,
            identitySummary,
            depthInstruction,
          );

          return {
            systemPromptInjection: systemPrompt,
            contextBlock: contextChunks.join('\n\n'),
          };
        }
      }

      const profile = this.getProfileData();
      if (profile) {
        const identitySummary = `${profile.identity.name}, ${profile.experience?.[0]?.role || ''} with ${profile.totalExperienceYears} years of experience. Skills: ${profile.skills.slice(0, 10).join(', ')}`;
        return {
          systemPromptInjection: `You are helping this candidate answer interview questions. Candidate: ${identitySummary}. Use their background to provide personalized, specific answers.`,
          contextBlock: profile.rawText.slice(0, 2000),
        };
      }

      return null;
    } catch (error) {
      console.error('[KnowledgeOrchestrator] processQuestion error:', error);
      return null;
    }
  }

  private isIntroQuestion(message: string): boolean {
    const lower = message.toLowerCase();
    const patterns = [
      'tell me about yourself',
      'introduce yourself',
      'walk me through your resume',
      'walk me through your background',
      'give me an overview of your experience',
      'tell me about your background',
      'who are you',
      'describe yourself',
    ];

    return patterns.some((pattern) => lower.includes(pattern));
  }

  private chunkDocument(text: string, docType: DocType): Array<{ text: string; metadata?: any }> {
    const sections = text.split(/\n{2,}|\n(?=#{1,3}\s)/);
    const chunks: Array<{ text: string; metadata?: any }> = [];

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed || trimmed.length < 20) {
        continue;
      }

      if (trimmed.length > 1000) {
        const subChunks = this.splitLongSection(trimmed, 800);
        for (const subChunk of subChunks) {
          chunks.push({
            text: subChunk,
            metadata: { docType, section: this.detectSection(subChunk) },
          });
        }
      } else {
        chunks.push({
          text: trimmed,
          metadata: { docType, section: this.detectSection(trimmed) },
        });
      }
    }

    return chunks;
  }

  private splitLongSection(text: string, maxLen: number): string[] {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      if (current.length + sentence.length > maxLen && current.length > 0) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += `${current ? ' ' : ''}${sentence}`;
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks;
  }

  private detectSection(text: string): string {
    const lower = text.toLowerCase();

    if (lower.includes('experience') || lower.includes('work history')) return 'experience';
    if (lower.includes('education') || lower.includes('university') || lower.includes('degree')) return 'education';
    if (lower.includes('skill') || lower.includes('technologies')) return 'skills';
    if (lower.includes('project')) return 'projects';
    if (lower.includes('summary') || lower.includes('objective')) return 'summary';

    return 'general';
  }

  private async embedChunksBackground(chunks: Array<{ id: number; text: string }>): Promise<void> {
    try {
      await this.vectorStore.storeEmbeddings(chunks, this.embedFn!);
      console.log(`[KnowledgeOrchestrator] Embedded ${chunks.length} chunks`);
    } catch (error) {
      console.error('[KnowledgeOrchestrator] Background embedding error:', error);
    }
  }

  private restoreState(): void {
    const resumeDoc = this.db.getDocumentByType(DocType.RESUME);
    if (resumeDoc) {
      console.log('[KnowledgeOrchestrator] Resume found in database, knowledge mode available');
    }

    const negotiationState = this.db.getNegotiationState();
    if (negotiationState?.script) {
      try {
        this.cachedNegotiationScript = typeof negotiationState.script === 'string'
          ? JSON.parse(negotiationState.script)
          : negotiationState.script;
      } catch {
        this.cachedNegotiationScript = null;
      }
    }
  }
}
