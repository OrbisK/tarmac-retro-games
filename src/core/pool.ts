import { onCleanup } from "./lifecycle";

/**
 * Fixed-capacity object pool.
 *
 * Short-lived effects (sparks, floating score popups) are the classic way a
 * long-running arcade loop turns into a GC sawtooth: thousands of objects
 * allocated and dropped per minute. A pool allocates its members once, hands
 * out slots, and never grows — when it is full the oldest entry is recycled,
 * so a runaway spawn rate degrades visually instead of eating memory.
 *
 * The backing array is released on scene leave.
 */
export interface Pool<T> {
  /** Take a slot. Never returns null; recycles the oldest when full. */
  spawn(): T;
  /** Visit live slots. Return `false` from `fn` to release the slot. */
  each(fn: (item: T) => boolean): void;
  /** Release every slot. */
  clear(): void;
  readonly capacity: number;
  liveCount(): number;
}

export function makePool<T>(capacity: number, create: () => T): Pool<T> {
  const items: T[] = new Array(capacity);
  const live = new Uint8Array(capacity);
  for (let i = 0; i < capacity; i++) items[i] = create();

  let cursor = 0;
  let liveCount = 0;

  const pool: Pool<T> = {
    capacity,
    liveCount: () => liveCount,
    spawn(): T {
      // Find a free slot starting at the cursor; fall back to recycling it.
      for (let probe = 0; probe < capacity; probe++) {
        const i = (cursor + probe) % capacity;
        if (live[i] === 0) {
          live[i] = 1;
          liveCount++;
          cursor = (i + 1) % capacity;
          return items[i];
        }
      }
      const i = cursor;
      cursor = (cursor + 1) % capacity;
      return items[i];
    },
    each(fn): void {
      for (let i = 0; i < capacity; i++) {
        if (live[i] === 0) continue;
        if (fn(items[i]) === false) {
          live[i] = 0;
          liveCount--;
        }
      }
    },
    clear(): void {
      live.fill(0);
      liveCount = 0;
    },
  };

  onCleanup(() => {
    pool.clear();
    items.length = 0;
  });

  return pool;
}
