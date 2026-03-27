// electron/knowledge/types.ts
// Shared types for the Knowledge/Profile system

export enum DocType {
  RESUME = 'resume',
  JD = 'jd',
}

// ─── Profile Types ───────────────────────────────────────────

export interface ProfileIdentity {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
}

export interface ProfileExperience {
  company: string;
  role: string;
  startDate: string;
  endDate?: string;
  highlights: string[];
}

export interface ProfileSkill {
  name: string;
  category: 'language' | 'framework' | 'tool' | 'soft' | 'other';
}

export interface ProfileProject {
  name: string;
  description: string;
  technologies: string[];
  highlights: string[];
}

export interface ProfileEducation {
  institution: string;
  degree: string;
  year?: string;
}

export interface ProfileData {
  identity: ProfileIdentity;
  skills: string[];                // flat list for UI compatibility
  experience: ProfileExperience[];
  projects: ProfileProject[];
  education: ProfileEducation[];
  totalExperienceYears: number;
  experienceCount: number;         // derived: experience.length
  projectCount: number;            // derived: projects.length
  nodeCount: number;               // derived: skills.length + experience.length + projects.length
  rawText: string;
  hasActiveJD: boolean;
  activeJD?: JDData;
  companyDossier?: CompanyDossier;
  negotiationScript?: NegotiationScript;
}

// ─── JD Types ────────────────────────────────────────────────

export interface JDData {
  company: string;
  title: string;
  level?: string;
  location?: string;
  requirements: string[];
  technologies: string[];
  keywords?: string[];
  compensation_hint?: string;
  min_years_experience?: number;
}

// ─── Company Research Types ──────────────────────────────────

export interface CompanyDossier {
  company: string;
  overview: string;
  products: string[];
  culture_ratings: {
    overall: number;
    work_life_balance?: number;
    compensation?: number;
    management?: number;
    review_count?: string;
    data_sources?: string[];
  };
  interview_focus?: string;
  interview_difficulty?: 'easy' | 'medium' | 'hard' | 'very_hard';
  recent_news?: string[];
  talking_points?: string[];
  hiring_strategy?: string;
  salary_estimates?: Array<{
    title?: string;
    location?: string;
    currency?: string;
    min?: number;
    max?: number;
    confidence?: 'low' | 'medium' | 'high' | string;
  }>;
  employee_reviews?: string[];
  critics?: string[];
  benefits?: string[];
  core_values?: string[];
  competitors?: string[];
  sources?: string[];
}

// ─── Negotiation Types ───────────────────────────────────────

export interface NegotiationPhase {
  name: string;
  objective: string;
  suggested_lines: string[];
  warnings: string[];
  silence_strategy?: boolean;
}

export interface NegotiationScript {
  phases: NegotiationPhase[];
  salary_range?: {
    low: number;
    mid: number;
    high: number;
    currency: string;
    min?: number;
    max?: number;
    confidence?: 'low' | 'medium' | 'high' | string;
  };
  key_leverage_points: string[];
  sources?: string[];
  opening_line?: string;
  justification?: string;
  counter_offer_fallback?: string;
}

export interface NegotiationState {
  currentPhase: number;
  utterances: string[];
  isActive: boolean;
}

// ─── Knowledge Engine Types ──────────────────────────────────

export interface KnowledgeStatus {
  hasResume: boolean;
  activeMode: boolean;
  resumeSummary?: {
    name: string;
    role: string;
    totalExperienceYears: number;
  };
}

export interface KnowledgeResult {
  isIntroQuestion?: boolean;
  introResponse?: string;
  liveNegotiationResponse?: any;
  systemPromptInjection?: string;
  contextBlock?: string;
}

// ─── Function Types (injected from main.ts) ──────────────────

export type GenerateContentFn = (contents: Array<{ text: string }>) => Promise<string>;
export type EmbedFn = (text: string) => Promise<number[]>;
export type EmbedQueryFn = (text: string) => Promise<number[]>;

// ─── Database Row Types ──────────────────────────────────────

export interface DocumentRow {
  id: number;
  doc_type: string;
  file_name: string;
  raw_text: string;
  parsed_data: string; // JSON string
  created_at: string;
  updated_at: string;
}

export interface ChunkRow {
  id: number;
  doc_id: number;
  doc_type: string;
  chunk_index: number;
  text: string;
  token_count: number;
  embedding: Buffer | null;
  metadata: string; // JSON string
}
