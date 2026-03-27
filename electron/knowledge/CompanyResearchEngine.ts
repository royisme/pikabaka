import { CompanyDossier, GenerateContentFn } from './types';
import { KnowledgeDatabaseManager } from './KnowledgeDatabaseManager';
import { buildCompanyResearchPrompt } from './prompts';
import { parseLLMJson } from './parseLLMJson';

interface TavilySearchResult {
  title: string;
  content?: string;
  snippet?: string;
}

interface TavilySearchProvider {
  search(query: string): Promise<TavilySearchResult[]>;
}

export class CompanyResearchEngine {
  private generateContentFn: GenerateContentFn;
  private db: KnowledgeDatabaseManager;
  private searchProvider: TavilySearchProvider | null = null;
  private tavilyApiKey: string | null = null;

  constructor(generateContentFn: GenerateContentFn, db: KnowledgeDatabaseManager) {
    this.generateContentFn = generateContentFn;
    this.db = db;
  }

  setSearchProvider(provider: TavilySearchProvider | null): void {
    this.searchProvider = provider;
  }

  setApiKey(apiKey: string | null): void {
    this.tavilyApiKey = apiKey;
  }

  private async searchTavily(query: string): Promise<TavilySearchResult[]> {
    if (!this.tavilyApiKey) return [];
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: this.tavilyApiKey, query, search_depth: 'advanced', max_results: 5 }),
    });
    if (!response.ok) {
      throw new Error(`Tavily search failed: ${response.status}`);
    }
    const data: any = await response.json();
    return Array.isArray(data?.results)
      ? data.results.map((result: any) => ({ title: result.title || '', content: result.content, snippet: result.snippet }))
      : [];
  }

  async researchCompany(
    company: string,
    jdContext: Record<string, any> = {},
    useCache: boolean = true,
  ): Promise<CompanyDossier> {
    if (useCache) {
      const cached = this.db.getCachedDossier(company);
      if (cached) {
        console.log(`[CompanyResearch] Cache hit for ${company}`);
        return cached;
      }
    }

    let searchResults = '';
    try {
      const queries = [
        `${company} glassdoor reviews interview`,
        `${company} engineering culture tech stack`,
        `${company} recent news funding`,
      ];
      const results = await Promise.all(queries.map((query) => this.searchProvider ? this.searchProvider.search(query) : this.searchTavily(query)));
      searchResults = results
        .flat()
        .map((result) => `${result.title}: ${result.content || result.snippet || ''}`.trim())
        .filter(Boolean)
        .join('\n\n');
    } catch (error) {
      console.error('[CompanyResearch] Tavily search failed:', error);
    }

    if (!searchResults) {
      searchResults = `No live search results available. Use your knowledge about ${company} to generate a dossier. Note that information may not be current.`;
    }

    const prompt = buildCompanyResearchPrompt(company, searchResults, jdContext);
    const response = await this.generateContentFn([{ text: prompt }]);
    const dossier = this.parseResponse(response, company);

    this.db.cacheCompanyDossier(company, dossier);

    return dossier;
  }

  private parseResponse(response: string, company: string): CompanyDossier {
    try {
      const parsed: any = parseLLMJson(response);
      return {
        company: parsed.company || company,
        overview: parsed.overview || '',
        products: Array.isArray(parsed.products) ? parsed.products : [],
        hiring_strategy: parsed.hiring_strategy || undefined,
        culture_ratings: {
          overall: typeof parsed.culture_ratings?.overall === 'number' ? parsed.culture_ratings.overall : 3,
          work_life_balance: typeof parsed.culture_ratings?.work_life_balance === 'number'
            ? parsed.culture_ratings.work_life_balance
            : undefined,
          compensation: typeof parsed.culture_ratings?.compensation === 'number'
            ? parsed.culture_ratings.compensation
            : undefined,
          management: typeof parsed.culture_ratings?.management === 'number'
            ? parsed.culture_ratings.management
            : undefined,
          review_count: parsed.culture_ratings?.review_count || undefined,
          data_sources: Array.isArray(parsed.culture_ratings?.data_sources)
            ? parsed.culture_ratings.data_sources
            : undefined,
        },
        interview_focus: parsed.interview_focus || undefined,
        interview_difficulty: parsed.interview_difficulty || undefined,
        salary_estimates: Array.isArray(parsed.salary_estimates) ? parsed.salary_estimates : [],
        employee_reviews: Array.isArray(parsed.employee_reviews) ? parsed.employee_reviews : [],
        critics: Array.isArray(parsed.critics) ? parsed.critics : [],
        benefits: Array.isArray(parsed.benefits) ? parsed.benefits : [],
        core_values: Array.isArray(parsed.core_values) ? parsed.core_values : [],
        recent_news: Array.isArray(parsed.recent_news) ? parsed.recent_news : [],
        competitors: Array.isArray(parsed.competitors) ? parsed.competitors : [],
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        talking_points: Array.isArray(parsed.talking_points) ? parsed.talking_points : [],
      };
    } catch {
      return {
        company,
        overview: response.slice(0, 500),
        products: [],
        culture_ratings: { overall: 3 },
        salary_estimates: [],
        employee_reviews: [],
        critics: [],
        benefits: [],
        core_values: [],
        competitors: [],
        sources: [],
        recent_news: [],
        talking_points: [],
      };
    }
  }
}
