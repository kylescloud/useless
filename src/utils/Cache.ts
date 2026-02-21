/**
 * Cache - In-memory caching utility with TTL support
 * Optimizes performance by caching frequently accessed data
 */
export class Cache<T> {
  private cache: Map<string, { value: T; timestamp: number; ttl: number }>;
  private defaultTTL: number;
  private maxSize: number;
  private hits = 0;
  private misses = 0;

  /**
   * Create a new cache
   * @param defaultTTL Default time-to-live in milliseconds
   * @param maxSize Maximum number of entries (0 for unlimited)
   */
  constructor(defaultTTL: number = 60000, maxSize: number = 1000) {
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
    this.maxSize = maxSize;
    
    // Start cleanup interval
    setInterval(() => this.cleanup(), 60000); // Clean every minute
  }

  /**
   * Get a value from the cache
   * @param key Cache key
   * @returns Cached value or undefined if not found/expired
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    return entry.value;
  }

  /**
   * Set a value in the cache
   * @param key Cache key
   * @param value Value to cache
   * @param ttl Time-to-live in milliseconds (uses default if not specified)
   */
  set(key: string, value: T, ttl?: number): void {
    // Check max size
    if (this.maxSize > 0 && this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) { this.cache.delete(oldestKey); }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: ttl ?? this.defaultTTL,
    });
  }

  /**
   * Delete a value from the cache
   * @param key Cache key
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Check if a key exists and is not expired
   * @param key Cache key
   * @returns True if key exists and is valid
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Get or set a value (cache-through pattern)
   * @param key Cache key
   * @param factory Function to generate value if not in cache
   * @param ttl Time-to-live in milliseconds
   * @returns Cached or generated value
   */
  async getOrSet(key: string, factory: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Get or set a value (synchronous)
   * @param key Cache key
   * @param factory Function to generate value if not in cache
   * @param ttl Time-to-live in milliseconds
   * @returns Cached or generated value
   */
  getOrSetSync(key: string, factory: () => T, ttl?: number): T {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = factory();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   * @returns Cache statistics
   */
  getStats(): {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Get all keys in the cache
   * @returns Array of cache keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get all values in the cache
   * @returns Array of cached values
   */
  values(): T[] {
    const now = Date.now();
    return Array.from(this.cache.values())
      .filter(entry => now - entry.timestamp <= entry.ttl)
      .map(entry => entry.value);
  }
}

/**
 * LRU (Least Recently Used) Cache
 * Automatically evicts least recently used entries when size limit is reached
 */
export class LRUCache<T> {
  private cache: Map<string, { value: T; timestamp: number }>;
  private maxSize: number;

  /**
   * Create a new LRU cache
   * @param maxSize Maximum number of entries
   */
  constructor(maxSize: number = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Get a value from the cache
   * @param key Cache key
   * @returns Cached value or undefined
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // Update timestamp (mark as recently used)
    entry.timestamp = Date.now();
    
    // Re-insert to end of map (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set a value in the cache
   * @param key Cache key
   * @param value Value to cache
   */
  set(key: string, value: T): void {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) { this.cache.delete(oldestKey); }
    }

    this.cache.set(key, { value, timestamp: Date.now() });
  }

  /**
   * Get cache size
   * @returns Number of entries in cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
  }
}

/**
 * Specialized pool cache for DEX pool data
 */
export class PoolCache {
  private reservesCache: Cache<{ reserve0: bigint; reserve1: bigint; timestamp: number }>;
  private priceCache: Cache<{ price: bigint; timestamp: number }>;

  constructor() {
    this.reservesCache = new Cache(30000, 5000); // 30s TTL, 5000 max entries
    this.priceCache = new Cache(5000, 10000); // 5s TTL, 10000 max entries
  }

  /**
   * Get cached reserves for a pool
   * @param poolAddress Pool address
   * @returns Cached reserves or undefined
   */
  getReserves(poolAddress: string): { reserve0: bigint; reserve1: bigint; timestamp: number } | undefined {
    return this.reservesCache.get(poolAddress);
  }

  /**
   * Set cached reserves for a pool
   * @param poolAddress Pool address
   * @param reserves Reserves data
   */
  setReserves(poolAddress: string, reserves: { reserve0: bigint; reserve1: bigint }): void {
    this.reservesCache.set(poolAddress, { ...reserves, timestamp: Date.now() });
  }

  /**
   * Get cached price for a pair
   * @param pairKey Pair key (e.g., "token1-token2-dex")
   * @returns Cached price or undefined
   */
  getPrice(pairKey: string): { price: bigint; timestamp: number } | undefined {
    return this.priceCache.get(pairKey);
  }

  /**
   * Set cached price for a pair
   * @param pairKey Pair key
   * @param price Price data
   */
  setPrice(pairKey: string, price: bigint): void {
    this.priceCache.set(pairKey, { price, timestamp: Date.now() });
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      reserves: this.reservesCache.getStats(),
      prices: this.priceCache.getStats(),
    };
  }
}