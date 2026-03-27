// electron/knowledge/ProfileExtractor.ts
import { GenerateContentFn, ProfileData, ProfileExperience, ProfileProject, ProfileEducation, ProfileIdentity } from './types';
import { buildProfileExtractionPrompt } from './prompts';
import { parseLLMJson } from './parseLLMJson';

export class ProfileExtractor {
  constructor(private generateContentFn: GenerateContentFn) {}

  async extract(rawText: string): Promise<ProfileData> {
    const prompt = buildProfileExtractionPrompt(rawText);
    const response = await this.generateContentFn([{ text: prompt }]);
    return this.parseResponse(response, rawText);
  }

  private parseResponse(response: string, rawText: string): ProfileData {
    const parsed: any = parseLLMJson(response);

    // Validate and build ProfileData with defaults for missing fields
    const identity: ProfileIdentity = {
      name: parsed.identity?.name || 'Unknown',
      email: parsed.identity?.email || undefined,
      phone: parsed.identity?.phone || undefined,
      location: parsed.identity?.location || undefined,
      linkedin: parsed.identity?.linkedin || undefined,
      github: parsed.identity?.github || undefined,
    };

    const skills: string[] = Array.isArray(parsed.skills) ? parsed.skills : [];

    const experience: ProfileExperience[] = (parsed.experience || []).map((exp: any) => ({
      company: exp.company || 'Unknown',
      role: exp.role || 'Unknown',
      startDate: exp.startDate || '',
      endDate: exp.endDate || undefined,
      highlights: Array.isArray(exp.highlights) ? exp.highlights : [],
    }));

    const projects: ProfileProject[] = (parsed.projects || []).map((proj: any) => ({
      name: proj.name || 'Unknown',
      description: proj.description || '',
      technologies: Array.isArray(proj.technologies) ? proj.technologies : [],
      highlights: Array.isArray(proj.highlights) ? proj.highlights : [],
    }));

    const education: ProfileEducation[] = (parsed.education || []).map((edu: any) => ({
      institution: edu.institution || 'Unknown',
      degree: edu.degree || '',
      year: edu.year || undefined,
    }));

    const totalExperienceYears = typeof parsed.totalExperienceYears === 'number'
      ? parsed.totalExperienceYears
      : 0;

    return {
      identity,
      skills,
      experience,
      projects,
      education,
      totalExperienceYears,
      experienceCount: experience.length,
      projectCount: projects.length,
      nodeCount: skills.length + experience.length + projects.length,
      rawText,
      hasActiveJD: false,
    };
  }
}
