export interface RetryContext {
  attempt: number;
  maxAttempts: number;
}

export async function withRetry<T>(operation: (context: RetryContext) => Promise<T>, maxAttempts = 1): Promise<T> {
  let attempt = 1;
  while (true) {
    try {
      return await operation({ attempt, maxAttempts });
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      attempt += 1;
    }
  }
}
