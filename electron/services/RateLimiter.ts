/**
 * RateLimiter - Token bucket rate limiter for LLM API calls
 * Prevents 429 errors on free-tier API plans by queuing requests
 * when the bucket is empty.
 */
export class RateLimiter {
    private tokens: number;
    private readonly maxTokens: number;
    private readonly refillRatePerSecond: number;
    private lastRefillTime: number;
    private waitQueue: Array<() => void> = [];
    private refillTimer: ReturnType<typeof setInterval> | null = null;

    /**
     * @param maxTokens - Maximum burst capacity (e.g. 30 for Groq free tier)
     * @param refillRatePerSecond - Tokens added per second (e.g. 0.5 = 30/min)
     */
    constructor(maxTokens: number, refillRatePerSecond: number) {
        this.maxTokens = maxTokens;
        this.tokens = maxTokens;
        this.refillRatePerSecond = refillRatePerSecond;
        this.lastRefillTime = Date.now();

        // Refill tokens periodically
        this.refillTimer = setInterval(() => this.refill(), 1000);
    }

    /**
     * Acquire a token. Resolves immediately if available, otherwise waits.
     */
    public async acquire(): Promise<void> {
        this.refill();

        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }

        // Wait for a token to become available
        return new Promise<void>((resolve) => {
            this.waitQueue.push(resolve);
        });
    }

    private refill(): void {
        const now = Date.now();
        const elapsed = (now - this.lastRefillTime) / 1000;
        const newTokens = elapsed * this.refillRatePerSecond;

        if (newTokens >= 1) {
            this.tokens = Math.min(this.maxTokens, this.tokens + Math.floor(newTokens));
            this.lastRefillTime = now;

            // Wake up waiting requests
            while (this.waitQueue.length > 0 && this.tokens >= 1) {
                this.tokens -= 1;
                const resolve = this.waitQueue.shift()!;
                resolve();
            }
        }
    }

    public destroy(): void {
        if (this.refillTimer) {
            clearInterval(this.refillTimer);
            this.refillTimer = null;
        }
        // Release all waiting requests
        while (this.waitQueue.length > 0) {
            const resolve = this.waitQueue.shift()!;
            resolve();
        }
    }
}

/**
 * Pre-configured rate limiters for known providers.
 * These match documented free-tier limits.
 */
export function createProviderRateLimiters() {
    return {
        groq: new RateLimiter(6, 0.1),        // 6 req/min
        gemini: new RateLimiter(120, 2.0),    // 120 req/min
        openai: new RateLimiter(120, 2.0),    // 120 req/min
        claude: new RateLimiter(120, 2.0),    // 120 req/min
    };
}
