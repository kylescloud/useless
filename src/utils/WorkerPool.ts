/**
 * WorkerPool - Manages parallel task execution for improved performance
 * Handles concurrent DEX quoting, strategy evaluation, and price updates
 */
export class WorkerPool<T, R> {
  private workers: Array<(task: T) => Promise<R>>;
  private taskQueue: Array<{ task: T; resolve: (value: R) => void; reject: (error: Error) => void }> = [];
  private activeWorkers = 0;
  private maxConcurrency: number;

  /**
   * Create a new worker pool
   * @param workerFn Function to execute for each task
   * @param maxConcurrency Maximum number of concurrent workers
   */
  constructor(workerFn: (task: T) => Promise<R>, maxConcurrency: number = 10) {
    this.maxConcurrency = maxConcurrency;
    this.workers = Array(maxConcurrency).fill(workerFn);
  }

  /**
   * Execute a task asynchronously
   * @param task Task to execute
   * @returns Promise that resolves with the result
   */
  async execute(task: T): Promise<R> {
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ task, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Execute multiple tasks in parallel
   * @param tasks Array of tasks
   * @returns Promise that resolves with array of results
   */
  async executeAll(tasks: T[]): Promise<R[]> {
    const promises = tasks.map(task => this.execute(task));
    return Promise.all(promises);
  }

  /**
   * Execute multiple tasks in parallel with batching
   * @param tasks Array of tasks
   * @param batchSize Number of tasks per batch
   * @returns Promise that resolves with array of results
   */
  async executeBatched(tasks: T[], batchSize: number = this.maxConcurrency): Promise<R[]> {
    const results: R[] = [];
    
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      const batchResults = await this.executeAll(batch);
      results.push(...batchResults);
    }
    
    return results;
  }

  /**
   * Process the task queue
   */
  private async processQueue(): Promise<void> {
    if (this.activeWorkers >= this.maxConcurrency || this.taskQueue.length === 0) {
      return;
    }

    this.activeWorkers++;
    const { task, resolve, reject } = this.taskQueue.shift()!;
    const workerIndex = (this.activeWorkers - 1) % this.workers.length;
    const worker = this.workers[workerIndex];

    try {
      const result = await worker(task);
      resolve(result);
    } catch (error) {
      reject(error as Error);
    } finally {
      this.activeWorkers--;
      this.processQueue();
    }
  }

  /**
   * Get current queue statistics
   * @returns Queue statistics
   */
  getStats(): {
    queueLength: number;
    activeWorkers: number;
    maxConcurrency: number;
  } {
    return {
      queueLength: this.taskQueue.length,
      activeWorkers: this.activeWorkers,
      maxConcurrency: this.maxConcurrency,
    };
  }

  /**
   * Clear the task queue
   */
  clearQueue(): void {
    this.taskQueue.forEach(({ reject }) => {
      reject(new Error("Worker pool cleared"));
    });
    this.taskQueue = [];
  }

  /**
   * Wait for all active tasks to complete
   * @returns Promise that resolves when all tasks are done
   */
  async drain(): Promise<void> {
    while (this.activeWorkers > 0 || this.taskQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * Shut down the worker pool
   */
  async shutdown(): Promise<void> {
    this.clearQueue();
    await this.drain();
  }
}

/**
 * Specialized worker pool for DEX quoting
 */
export class DEXQuoterPool {
  private pool: WorkerPool<any, any>;

  /**
   * Create a DEX quoter pool
   * @param quoterFn Function to quote a DEX
   * @param maxConcurrency Maximum concurrent quotes
   */
  constructor(quoterFn: (params: any) => Promise<any>, maxConcurrency: number = 10) {
    this.pool = new WorkerPool(quoterFn, maxConcurrency);
  }

  /**
   * Quote multiple DEXs in parallel
   * @param quoteParams Array of quote parameters
   * @returns Array of quote results
   */
  async quoteAll(quoteParams: any[]): Promise<any[]> {
    return this.pool.executeAll(quoteParams);
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return this.pool.getStats();
  }
}