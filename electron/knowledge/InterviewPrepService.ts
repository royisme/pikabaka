import {
  ProfileData,
  JDData,
  InterviewPrepData,
  InterviewPrepQuestion,
  GenerateContentFn,
} from './types';

export class InterviewPrepService {
  private generateContentFn: GenerateContentFn;
  private cache: Map<string, { data: InterviewPrepData; timestamp: number }> = new Map();
  private CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  constructor(generateContentFn: GenerateContentFn) {
    this.generateContentFn = generateContentFn;
  }

  async generatePrep(profile: ProfileData, jd: JDData): Promise<InterviewPrepData> {
    const cacheKey = `${profile.identity?.name || ''}_${jd.company}_${jd.title}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    const matchAnalysis = this.analyzeMatch(profile, jd);

    const prompt = this.buildPrepPrompt(profile, jd, matchAnalysis);
    const response = await this.generateContentFn([{ text: prompt }]);

    let prepData: InterviewPrepData;
    try {
      const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      prepData = JSON.parse(cleaned);
    } catch {
      prepData = this.buildFallbackPrep(profile, jd, matchAnalysis);
    }

    prepData.matchScore = matchAnalysis.matchScore;

    this.cache.set(cacheKey, { data: prepData, timestamp: Date.now() });
    return prepData;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private analyzeMatch(profile: ProfileData, jd: JDData): {
    matched: string[];
    weak: string[];
    missing: string[];
    matchScore: number;
  } {
    const profileSkillsLower = (profile.skills || []).map(s => s.toLowerCase());
    const profileTechLower = (profile.projects || []).flatMap(p => p.technologies || []).map(t => t.toLowerCase());
    const profileAllLower = [...new Set([...profileSkillsLower, ...profileTechLower])];

    const jdRequirements = (jd.requirements || []).map(r => r.toLowerCase());
    const jdTechnologies = (jd.technologies || []).map(t => t.toLowerCase());
    const jdAll = [...new Set([...jdRequirements, ...jdTechnologies])];

    const matched: string[] = [];
    const missing: string[] = [];

    for (const req of jdAll) {
      const isMatched = profileAllLower.some(skill =>
        req.includes(skill) || skill.includes(req) || this.fuzzyMatch(skill, req)
      );
      if (isMatched) {
        matched.push(req);
      } else {
        missing.push(req);
      }
    }

    const weak: string[] = [];
    const experienceText = (profile.experience || [])
      .flatMap(e => e.highlights || [])
      .join(' ')
      .toLowerCase();

    for (const req of missing) {
      if (experienceText.includes(req) || req.split(' ').some(word => word.length > 3 && experienceText.includes(word))) {
        weak.push(req);
      }
    }

    const finalMissing = missing.filter(m => !weak.includes(m));
    const totalReqs = jdAll.length || 1;
    const matchScore = Math.round(((matched.length + weak.length * 0.5) / totalReqs) * 100);

    return { matched, weak, missing: finalMissing, matchScore: Math.min(matchScore, 100) };
  }

  private fuzzyMatch(a: string, b: string): boolean {
    const aWords = a.split(/[\s,/\\-]+/).filter(w => w.length > 2);
    const bWords = b.split(/[\s,/\\-]+/).filter(w => w.length > 2);
    return aWords.some(aw => bWords.some(bw => aw === bw || aw.includes(bw) || bw.includes(aw)));
  }

  private buildPrepPrompt(
    profile: ProfileData,
    jd: JDData,
    matchAnalysis: { matched: string[]; weak: string[]; missing: string[]; matchScore: number },
  ): string {
    const profileSummary = JSON.stringify({
      name: profile.identity?.name,
      role: profile.experience?.[0]?.role,
      totalYears: profile.totalExperienceYears,
      skills: profile.skills?.slice(0, 20),
      experience: profile.experience?.slice(0, 3).map(e => ({
        company: e.company, role: e.role, highlights: e.highlights?.slice(0, 3)
      })),
      projects: profile.projects?.slice(0, 3).map(p => ({
        name: p.name, technologies: p.technologies, highlights: p.highlights?.slice(0, 2)
      })),
    }, null, 0);

    const jdSummary = JSON.stringify({
      company: jd.company,
      title: jd.title,
      level: jd.level,
      requirements: jd.requirements,
      technologies: jd.technologies,
      keywords: jd.keywords,
    }, null, 0);

    return `You are an expert interview coach. Generate interview preparation materials based on the candidate profile and target job description.

## Candidate Profile
${profileSummary}

## Target Position
${jdSummary}

## Skill Match Analysis
Matched skills: ${matchAnalysis.matched.join(', ')}
Weak/partial matches: ${matchAnalysis.weak.join(', ')}
Missing skills: ${matchAnalysis.missing.join(', ')}
Match score: ${matchAnalysis.matchScore}%

Generate ONLY valid JSON matching this schema:
{
  "likelyQuestions": [
    {
      "question": "the interview question",
      "category": "behavioral" | "technical" | "system_design" | "intro",
      "difficulty": 1-3,
      "relatedJDRequirement": "which JD requirement this tests",
      "suggestedAnswer": {
        "opening": "1-sentence opening",
        "keyPoints": ["3-5 key talking points referencing candidate's real experience"],
        "evidence": "specific project/experience from resume to cite"
      }
    }
  ],
  "knowledgeGaps": [
    { "skill": "missing skill", "importance": "critical" | "nice_to_have", "suggestion": "how to address this gap in the interview" }
  ],
  "mustMentionKeywords": ["keywords from JD the candidate should naturally include in answers"],
  "openingPitch": "A 30-second self-introduction tailored specifically to this role at this company"
}

Generate 8-12 likely questions across categories. Focus on questions that test the JD requirements.
Return ONLY the JSON, no markdown fences.`;
  }

  private buildFallbackPrep(
    profile: ProfileData,
    jd: JDData,
    matchAnalysis: { matched: string[]; weak: string[]; missing: string[]; matchScore: number },
  ): InterviewPrepData {
    const questions: InterviewPrepQuestion[] = [
      {
        question: 'Tell me about yourself and why you\'re interested in this role.',
        category: 'intro',
        difficulty: 1,
        relatedJDRequirement: jd.title,
        suggestedAnswer: {
          opening: `I'm ${profile.identity?.name}, a ${profile.experience?.[0]?.role || 'professional'} with ${profile.totalExperienceYears} years of experience.`,
          keyPoints: ['Highlight relevant experience', 'Connect skills to role requirements', 'Express genuine interest in the company'],
        },
      },
      {
        question: 'What is your greatest technical strength?',
        category: 'behavioral',
        difficulty: 1,
        suggestedAnswer: {
          opening: `My strongest technical area is ${profile.skills?.[0] || 'problem solving'}.`,
          keyPoints: profile.skills?.slice(0, 3).map(s => `Demonstrate depth in ${s}`) || [],
        },
      },
    ];

    for (const req of (jd.requirements || []).slice(0, 5)) {
      questions.push({
        question: `Can you describe your experience with ${req}?`,
        category: 'technical',
        difficulty: 2,
        relatedJDRequirement: req,
        suggestedAnswer: {
          opening: `Yes, I have experience with ${req} from my work at ${profile.experience?.[0]?.company || 'my previous role'}.`,
          keyPoints: [`Reference specific project using ${req}`, 'Quantify impact if possible', 'Connect to business outcomes'],
        },
      });
    }

    return {
      likelyQuestions: questions,
      matchScore: matchAnalysis.matchScore,
      knowledgeGaps: matchAnalysis.missing.map((skill: string) => ({
        skill,
        importance: 'nice_to_have' as const,
        suggestion: 'Frame as eager to learn; mention adjacent experience',
      })),
      mustMentionKeywords: jd.keywords || jd.technologies?.slice(0, 10) || [],
      openingPitch: `I'm ${profile.identity?.name}, a ${profile.experience?.[0]?.role || 'professional'} with ${profile.totalExperienceYears} years of experience, particularly in ${profile.skills?.slice(0, 3).join(', ')}. I'm excited about this ${jd.title} role at ${jd.company}.`,
    };
  }
}
