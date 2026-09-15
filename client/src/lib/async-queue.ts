/** A push-based queue consumed as an async iterator, for bridging callback subscriptions. */
export class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private failed: unknown;
  private done = false;

  push(item: T): void {
    if (this.done) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  fail(error: unknown): void {
    if (this.done) return;
    this.failed = error ?? new Error('subscription failed');
    this.done = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  end(): void {
    this.done = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  get size(): number {
    return this.items.length;
  }

  /** Resolves with the next item, or undefined after `timeoutMs` with nothing queued. */
  async next(timeoutMs?: number): Promise<T | undefined> {
    if (this.items.length) return this.items.shift();
    if (this.failed !== undefined) throw this.failed;
    if (this.done) return undefined;
    return new Promise<T | undefined>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter = (r: IteratorResult<T>) => {
        if (timer) clearTimeout(timer);
        if (r.done && this.failed !== undefined) reject(this.failed);
        else resolve(r.done ? undefined : r.value);
      };
      this.waiters.push(waiter);
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          resolve(undefined);
        }, timeoutMs);
      }
    });
  }

  get closed(): boolean {
    return this.done && this.items.length === 0;
  }
}
