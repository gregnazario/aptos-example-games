export class TtlCache<T> {
  #entries = new Map<string, { value: T; expires: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): T | null {
    const hit = this.#entries.get(key);
    if (!hit || hit.expires <= this.now()) {
      if (hit) this.#entries.delete(key);
      return null;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    this.#entries.set(key, { value, expires: this.now() + this.ttlMs });
  }

  clear(): void {
    this.#entries.clear();
  }
}
