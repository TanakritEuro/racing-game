// Two ends of a link in one process, for tests (after five-a-side's): each message arrives at
// the other end as a structured clone (nothing shared, as over a network), after a delay
// with jitter on a virtual clock that the test moves on with `advance(now)`. The unordered
// channel may reorder (as a real one can); the reliable one keeps its order. A cut line is
// noticed as a real link notices it, by the heartbeats stopping: both ends close after
// `silence` seconds.

import { createRng } from '../math';
import type { Channel, Link } from './link';

export interface LoopbackOptions {
  /** One-way delay (s), give or take `jitter` (s). */
  delay?: number;
  jitter?: number;
  seed?: number;
  /** How long after a cut each end gives up (s), as link.ts does on missing heartbeats. */
  silence?: number;
}

interface Item {
  to: LoopLink;
  at: number;
  order: number;
  message?: unknown;
  close?: true;
}

export interface Loopback {
  a: Link;
  b: Link;
  /** Deliver everything due by virtual time `now` (s); returns how many were delivered. */
  advance(now: number): number;
  /** Cut the line without either end hanging up (a network failure). */
  cut(): void;
}

export function loopback({ delay = 0, jitter = 0, seed = 1, silence = 6 }: LoopbackOptions = {}): Loopback {
  const rng = createRng(seed);
  let queue: Item[] = [];
  let now = 0;
  let order = 0;
  let cut = false;
  let lostAt = Infinity;
  // The reliable channel never overtakes itself: each message no earlier than the last.
  const lastReliable = new Map<LoopLink, number>();
  const post = (to: LoopLink, item: Omit<Item, 'to' | 'at' | 'order'>, channel: Channel) => {
    if (cut) return;
    let at = now + Math.max(0, delay + (rng() * 2 - 1) * jitter);
    if (channel === 'events') {
      at = Math.max(at, lastReliable.get(to) ?? 0);
      lastReliable.set(to, at);
    }
    queue.push({ ...item, to, at, order: order++ });
  };
  const a: LoopLink = new LoopLink((item, channel) => post(b, item, channel));
  const b: LoopLink = new LoopLink((item, channel) => post(a, item, channel));
  return {
    a,
    b,
    advance(t: number): number {
      now = t;
      const due = queue.filter((i) => i.at <= t).sort((x, y) => x.at - y.at || x.order - y.order);
      queue = queue.filter((i) => i.at > t);
      for (const item of due) {
        if (item.close) item.to.remoteClosed();
        else if (!item.to.closed) item.to.onMessage(item.message);
      }
      if (t >= lostAt) {
        lostAt = Infinity;
        for (const end of [a, b]) end.remoteClosed('Lost touch with your opponent.');
      }
      return due.length;
    },
    cut(): void {
      cut = true;
      queue = [];
      lostAt = now + silence;
    },
  };
}

class LoopLink implements Link {
  onMessage: (message: unknown) => void = () => {};
  onClose: (reason: string) => void = () => {};
  closed = false;

  constructor(private readonly post: (item: { message?: unknown; close?: true }, channel: Channel) => void) {}

  send(message: object, channel: Channel = 'events'): void {
    if (!this.closed) this.post({ message: structuredClone(message) }, channel);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.post({ close: true }, 'events');
  }

  /** The other end hung up, or the line was lost. */
  remoteClosed(reason = 'Your opponent left the race.'): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose(reason);
  }
}
