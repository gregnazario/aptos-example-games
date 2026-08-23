export class TtlCache<T> {
  #entries = new Map<string, { value: T; expires: number }>();
  #now: () => number;
  #maxSize: number;

  constructor(
    private readonly ttlMs: number,
    options: { now?: () => number; maxSize?: number } = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#maxSize = options.maxSize ?? 512;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: string): T | null {
    const hit = this.#entries.get(key);
    if (!hit || hit.expires <= this.#now()) {
      if (hit) this.#entries.delete(key);
      return null;
    }
    this.#entries.delete(key);
    this.#entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T): void {
    this.#sweepExpired();
    this.#entries.delete(key);
    this.#entries.set(key, { value, expires: this.#now() + this.ttlMs });
    while (this.#entries.size > this.#maxSize) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  clear(): void {
    this.#entries.clear();
  }

  #sweepExpired(): void {
    const now = this.#now();
    for (const [key, entry] of this.#entries) {
      if (entry.expires <= now) this.#entries.delete(key);
    }
  }
}
