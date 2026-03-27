// electron/knowledge/JDAnalyzer.ts
import { GenerateContentFn, JDData } from './types';
import { buildJDAnalysisPrompt } from './prompts';
import { parseLLMJson } from './parseLLMJson';

export class JDAnalyzer {
  constructor(private generateContentFn: GenerateContentFn) {}

  async analyze(rawText: string): Promise<JDData> {
    const prompt = buildJDAnalysisPrompt(rawText);
    const response = await this.generateContentFn([{ text: prompt }]);
    return this.parseResponse(response);
  }

  private parseResponse(response: string): JDData {
    const parsed: any = parseLLMJson(response);

    return {
      company: parsed.company || 'Unknown',
      title: parsed.title || 'Unknown',
      level: parsed.level || undefined,
      location: parsed.location || undefined,
      requirements: Array.isArray(parsed.requirements) ? parsed.requirements : [],
      technologies: Array.isArray(parsed.technologies) ? parsed.technologies : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      compensation_hint: parsed.compensation_hint || undefined,
      min_years_experience: typeof parsed.min_years_experience === 'number' ? parsed.min_years_experience : undefined,
    };
  }
}
