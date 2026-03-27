// electron/knowledge/DepthScorer.ts
// Tracks question topics and depth within an interview session.
// Used to provide progressively deeper answers as the interviewer
// digs into the same topic.

interface QuestionEntry {
  text: string;
  topic: string;
  depth: number;
  timestamp: number;
}

// Topic keywords for classification
const TOPIC_KEYWORDS: Record<string, string[]> = {
  'system-design': ['design', 'architecture', 'scale', 'distributed', 'microservice', 'database', 'cache', 'load balancer', 'api'],
  'algorithms': ['algorithm', 'data structure', 'complexity', 'sort', 'search', 'tree', 'graph', 'dynamic programming', 'recursion'],
  'behavioral': ['tell me', 'describe a time', 'how do you', 'what would you', 'conflict', 'challenge', 'teamwork', 'leadership', 'mistake'],
  'experience': ['experience', 'project', 'worked on', 'built', 'implemented', 'previous role', 'responsibility', 'achievement'],
  'technical': ['code', 'implement', 'debug', 'test', 'deploy', 'ci/cd', 'git', 'docker', 'kubernetes', 'aws', 'cloud'],
  'frontend': ['react', 'vue', 'angular', 'css', 'html', 'javascript', 'typescript', 'component', 'ui', 'ux', 'responsive'],
  'backend': ['api', 'server', 'endpoint', 'rest', 'graphql', 'middleware', 'authentication', 'authorization', 'database', 'sql'],
  'culture-fit': ['culture', 'values', 'why', 'motivation', 'interest', 'career', 'goal', 'passion', 'work-life'],
  'negotiation': ['salary', 'compensation', 'offer', 'benefits', 'equity', 'bonus', 'package', 'negotiate'],
};

export class DepthScorer {
  private sessionQuestions: QuestionEntry[] = [];

  /**
   * Record a question and classify its topic.
   */
  feed(question: string): void {
    const topic = this.classifyTopic(question);
    const existing = this.sessionQuestions.filter(q => q.topic === topic);
    const depth = existing.length; // 0 = first time, 1 = follow-up, 2+ = deep dive
    this.sessionQuestions.push({
      text: question,
      topic,
      depth,
      timestamp: Date.now(),
    });
  }

  /**
   * Get the current depth level for a question's topic.
   */
  getCurrentDepth(question: string): number {
    const topic = this.classifyTopic(question);
    return this.sessionQuestions.filter(q => q.topic === topic).length;
  }

  /**
   * Get a prompt modifier string based on depth.
   * Used to instruct the LLM on answer depth.
   */
  getDepthInstruction(): string {
    if (this.sessionQuestions.length === 0) return '';

    const lastEntry = this.sessionQuestions[this.sessionQuestions.length - 1];
    const depth = lastEntry.depth;

    if (depth === 0) {
      return 'Provide a clear, concise overview answer. Hit the key points without going too deep.';
    } else if (depth === 1) {
      return 'This is a follow-up question on the same topic. Go deeper with specific examples, numbers, and technical details. Show expertise.';
    } else {
      return 'This is a deep-dive question. Provide expert-level detail with specific implementation choices, trade-offs considered, metrics achieved, and lessons learned. Be thorough.';
    }
  }

  /**
   * Get the most recent topic being discussed.
   */
  getCurrentTopic(): string | null {
    if (this.sessionQuestions.length === 0) return null;
    return this.sessionQuestions[this.sessionQuestions.length - 1].topic;
  }

  /**
   * Reset session state (e.g., when a new meeting starts).
   */
  reset(): void {
    this.sessionQuestions = [];
  }

  /**
   * Classify a question into a topic category using keyword matching.
   */
  private classifyTopic(question: string): string {
    const lower = question.toLowerCase();
    let bestTopic = 'general';
    let bestScore = 0;

    for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
      let score = 0;
      for (const keyword of keywords) {
        if (lower.includes(keyword)) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestTopic = topic;
      }
    }

    return bestTopic;
  }
}
