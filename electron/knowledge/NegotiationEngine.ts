import {
  CompanyDossier,
  GenerateContentFn,
  JDData,
  NegotiationScript,
  NegotiationState,
  ProfileData,
} from './types';
import { buildNegotiationScriptPrompt } from './prompts';
import { parseLLMJson } from './parseLLMJson';

export class NegotiationEngine {
  private generateContentFn: GenerateContentFn;

  constructor(generateContentFn: GenerateContentFn) {
    this.generateContentFn = generateContentFn;
  }

  async generateScript(
    profile: ProfileData,
    jd: JDData | null,
    dossier: CompanyDossier | null,
  ): Promise<NegotiationScript> {
    const profileSummary = this.summarizeProfile(profile);
    const jdSummary = jd ? this.summarizeJD(jd) : 'No job description available.';
    const dossierSummary = dossier ? this.summarizeDossier(dossier) : 'No company intel available.';

    const prompt = buildNegotiationScriptPrompt(profileSummary, jdSummary, dossierSummary);
    const response = await this.generateContentFn([{ text: prompt }]);
    return this.parseResponse(response);
  }

  private summarizeProfile(profile: ProfileData): string {
    const parts = [
      `Name: ${profile.identity.name}`,
      `Role: ${profile.experience?.[0]?.role || 'N/A'}`,
      `Experience: ${profile.totalExperienceYears} years`,
      `Skills: ${profile.skills.slice(0, 10).join(', ')}`,
    ];

    if (profile.experience?.length > 0) {
      parts.push(`Recent: ${profile.experience[0].role} at ${profile.experience[0].company}`);
    }

    return parts.join('\n');
  }

  private summarizeJD(jd: JDData): string {
    return [
      `Company: ${jd.company}`,
      `Title: ${jd.title}`,
      `Level: ${jd.level || 'N/A'}`,
      `Tech: ${jd.technologies.join(', ')}`,
      jd.compensation_hint ? `Compensation: ${jd.compensation_hint}` : '',
    ].filter(Boolean).join('\n');
  }

  private summarizeDossier(dossier: CompanyDossier): string {
    return [
      `Company: ${dossier.company}`,
      `Overview: ${dossier.overview}`,
      `Glassdoor: ${dossier.culture_ratings.overall}/5`,
      dossier.interview_difficulty ? `Interview difficulty: ${dossier.interview_difficulty}` : '',
    ].filter(Boolean).join('\n');
  }

  private parseResponse(response: string): NegotiationScript {
    try {
      const parsed: any = parseLLMJson(response);
      return {
        phases: Array.isArray(parsed.phases)
          ? parsed.phases.map((phase: any) => ({
              name: phase.name || '',
              objective: phase.objective || '',
              suggested_lines: Array.isArray(phase.suggested_lines) ? phase.suggested_lines : [],
              warnings: Array.isArray(phase.warnings) ? phase.warnings : [],
              silence_strategy: phase.silence_strategy || false,
            }))
          : [],
        salary_range: parsed.salary_range || undefined,
        opening_line: parsed.opening_line || parsed.phases?.[0]?.suggested_lines?.[0] || undefined,
        justification: parsed.justification || parsed.phases?.[1]?.suggested_lines?.[0] || undefined,
        counter_offer_fallback: parsed.counter_offer_fallback || parsed.phases?.[2]?.suggested_lines?.[0] || undefined,
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        key_leverage_points: Array.isArray(parsed.key_leverage_points) ? parsed.key_leverage_points : [],
      };
    } catch {
      return { phases: [], key_leverage_points: [] };
    }
  }
}

const NEGOTIATION_KEYWORDS = [
  'salary', 'compensation', 'offer', 'package', 'equity', 'stock',
  'bonus', 'benefits', 'negotiate', 'counter', 'base pay', 'total comp',
  'signing bonus', 'relocation', 'remote', 'pto', 'vacation',
];

export class NegotiationTracker {
  private state: NegotiationState = {
    currentPhase: 0,
    utterances: [],
    isActive: false,
  };

  private script: NegotiationScript | null = null;

  setScript(script: NegotiationScript): void {
    this.script = script;
    this.state.isActive = true;
    this.state.currentPhase = 0;
  }

  feedUtterance(text: string): void {
    this.state.utterances.push(text);
    // Cap utterance history to prevent unbounded growth in long meetings
    if (this.state.utterances.length > 200) {
      this.state.utterances = this.state.utterances.slice(-150);
    }

    if (!this.state.isActive) {
      const lower = text.toLowerCase();
      const hasKeyword = NEGOTIATION_KEYWORDS.some((keyword) => lower.includes(keyword));
      if (hasKeyword && this.script) {
        this.state.isActive = true;
        console.log('[NegotiationTracker] Auto-activated: negotiation keywords detected');
      }
    }
  }

  getState(): NegotiationState {
    return { ...this.state };
  }

  isActive(): boolean {
    return this.state.isActive;
  }

  getCoachingResponse(utterance: string): any | null {
    if (!this.state.isActive || !this.script) {
      return null;
    }

    const lower = utterance.toLowerCase();
    const hasNegKeyword = NEGOTIATION_KEYWORDS.some((keyword) => lower.includes(keyword));
    if (!hasNegKeyword) {
      return null;
    }

    const phase = this.script.phases[this.state.currentPhase];
    if (!phase) {
      return null;
    }

    return {
      phase: phase.name,
      objective: phase.objective,
      suggested_lines: phase.suggested_lines,
      warnings: phase.warnings,
      leverage_points: this.script.key_leverage_points,
      salary_range: this.script.salary_range,
    };
  }

  advancePhase(): void {
    if (this.script && this.state.currentPhase < this.script.phases.length - 1) {
      this.state.currentPhase++;
    }
  }

  reset(): void {
    this.state = {
      currentPhase: 0,
      utterances: [],
      isActive: false,
    };
    this.script = null;
  }
}
