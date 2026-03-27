// electron/knowledge/prompts.ts
// LLM prompt templates for the Knowledge system

export function buildProfileExtractionPrompt(rawText: string): string {
  return `You are a resume parser. Extract structured information from the following resume text and return ONLY valid JSON matching this exact schema. Do not include any text outside the JSON.

Schema:
{
  "identity": {
    "name": "string",
    "email": "string or null",
    "phone": "string or null",
    "location": "string or null",
    "linkedin": "string or null",
    "github": "string or null"
  },
  "skills": ["string array of skill names"],
  "experience": [
    {
      "company": "string",
      "role": "string",
      "startDate": "YYYY-MM or YYYY",
      "endDate": "YYYY-MM or YYYY or null if current",
      "highlights": ["string array of key achievements"]
    }
  ],
  "projects": [
    {
      "name": "string",
      "description": "one sentence",
      "technologies": ["string array"],
      "highlights": ["string array"]
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "year": "string or null"
    }
  ],
  "totalExperienceYears": number
}

Resume text:
---
${rawText}
---

Return ONLY the JSON object, no markdown fences or explanation.`;
}

export function buildJDAnalysisPrompt(rawText: string): string {
  return `You are a job description analyzer. Extract structured information from the following job description and return ONLY valid JSON matching this exact schema.

Schema:
{
  "company": "string",
  "title": "string (job title)",
  "level": "string (e.g. junior, mid, senior, staff, principal) or null",
  "location": "string or null",
  "requirements": ["string array of key requirements"],
  "technologies": ["string array of required/preferred technologies"],
  "keywords": ["string array of important keywords for interview prep"],
  "compensation_hint": "string describing compensation if mentioned, or null",
  "min_years_experience": number or null
}

Job description text:
---
${rawText}
---

Return ONLY the JSON object, no markdown fences or explanation.`;
}

export function buildCompanyResearchPrompt(
  companyName: string,
  searchResults: string,
  jdContext: Record<string, any>
): string {
  const jdSnippet = Object.keys(jdContext).length > 0
    ? `\nJob context: ${JSON.stringify(jdContext)}`
    : '';

  return `You are a company research analyst preparing an interview candidate. Based on the search results below, create a structured company dossier. Return ONLY valid JSON.
${jdSnippet}

Schema:
{
  "company": "${companyName}",
  "overview": "2-3 sentence company description",
  "products": ["main products/services"],
  "hiring_strategy": "how they appear to hire and what they optimize for",
  "culture_ratings": {
    "overall": number 1-5,
    "work_life_balance": number 1-5 or null,
    "compensation": number 1-5 or null,
    "management": number 1-5 or null,
    "review_count": "string like '1.2k reviews' or null",
    "data_sources": ["Glassdoor", "Blind", etc.]
  },
  "interview_focus": "what they typically test for",
  "interview_difficulty": "easy" | "medium" | "hard" | "very_hard",
  "salary_estimates": [{ "title": "Software Engineer", "location": "NYC", "currency": "USD", "min": 180000, "max": 240000, "confidence": "medium" }],
  "employee_reviews": [{ "quote": "string", "sentiment": "positive|mixed|negative", "role": "string or null", "source": "string or null" }],
  "critics": [{ "category": "string", "frequency": "rare|frequent|widespread", "complaint": "string" }],
  "benefits": ["notable perks"],
  "core_values": ["company values"],
  "recent_news": ["relevant recent developments"],
  "competitors": ["main competitors"],
  "sources": ["source names or urls"],
  "talking_points": ["things to mention that show you researched the company"]
}

Search results:
---
${searchResults}
---

Return ONLY the JSON object.`;
}

export function buildNegotiationScriptPrompt(
  profileSummary: string,
  jdSummary: string,
  dossierSummary: string
): string {
  return `You are a salary negotiation coach. Based on the candidate profile, job description, and company intel below, generate a phased negotiation script. Return ONLY valid JSON.

Schema:
{
  "phases": [
    {
      "name": "phase name (e.g. 'Initial Offer Response', 'Counter Offer', 'Final Negotiation')",
      "objective": "what to achieve in this phase",
      "suggested_lines": ["exact phrases the candidate can use"],
      "warnings": ["things to avoid saying or doing"]
    }
  ],
  "salary_range": {
    "low": number,
    "mid": number,
    "high": number,
    "min": number,
    "max": number,
    "currency": "USD",
    "confidence": "low|medium|high"
  },
  "opening_line": "short opening line when asked for expectations",
  "justification": "short justification tying experience to comp ask",
  "counter_offer_fallback": "short fallback line if they push lower",
  "sources": ["market data source names if available"],
  "key_leverage_points": ["candidate's strongest negotiation points"]
}

Candidate profile:
${profileSummary}

Job description:
${jdSummary}

Company intel:
${dossierSummary}

Return ONLY the JSON object.`;
}

export function buildIntroResponsePrompt(profileData: any): string {
  const name = profileData.identity?.name || 'the candidate';
  const role = profileData.experience?.[0]?.role || 'professional';
  const years = profileData.totalExperienceYears || 0;
  const topSkills = (profileData.skills || []).slice(0, 5).join(', ');
  const recentCompany = profileData.experience?.[0]?.company || '';

  return `Generate a natural, confident "tell me about yourself" response for a job interview. Keep it under 200 words. Use first person.

Key facts:
- Name: ${name}
- Current/recent role: ${role} at ${recentCompany}
- Years of experience: ${years}
- Top skills: ${topSkills}
- Number of projects: ${profileData.projects?.length || 0}

Structure: Present → Past → Future (what you're looking for)
Tone: Professional but conversational, not robotic.

Return ONLY the response text, no quotes or explanation.`;
}

export function buildContextEnhancementPrompt(
  question: string,
  relevantChunks: string[],
  identitySummary: string,
  depthInstruction: string
): string {
  return `You are helping a job candidate answer an interview question. Use the candidate's background context to craft a personalized, specific answer.

${depthInstruction}

Candidate identity: ${identitySummary}

Relevant background:
${relevantChunks.map((c, i) => `[${i + 1}] ${c}`).join('\n')}

Interview question: ${question}

Instructions:
- Answer in first person as the candidate
- Reference specific experiences, projects, and skills from the background
- Be specific with numbers, technologies, and outcomes where possible
- Keep the answer focused and natural (not a lecture)`;
}
