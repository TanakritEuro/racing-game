// A shared clock for two browsers: the guest estimates how far the host's clock is ahead of
// its own from timed pings (NTP-style). Each ping goes out at local time t0, the host stamps
// its time on the way back, and it arrives at t1: if the trip was symmetric the host's clock
// read its stamp at (t0 + t1) / 2. Trips that took longest are the least symmetric, so the
// estimate is the median offset of the quickest third. Pure.

export interface ClockSample {
  /** Round trip (s). */
  rtt: number;
  /** Host clock minus local clock (s). */
  offset: number;
}

export class ClockSync {
  readonly samples: ClockSample[] = [];
  /** Host clock minus local clock (s); 0 until there is a sample. */
  offset = 0;

  /** A ping sent at local `sentAt`, stamped `hostAt` by the host, back at local `receivedAt`. */
  add(sentAt: number, hostAt: number, receivedAt: number): void {
    const rtt = receivedAt - sentAt;
    if (!(rtt >= 0)) return;
    this.samples.push({ rtt, offset: hostAt - (sentAt + receivedAt) / 2 });
    const quickest = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(this.samples.length / 3)));
    const offsets = quickest.map((s) => s.offset).sort((a, b) => a - b);
    this.offset = offsets[Math.floor(offsets.length / 2)];
  }

  /** The quickest round trip seen (s), or null. */
  get bestRtt(): number | null {
    return this.samples.length === 0 ? null : Math.min(...this.samples.map((s) => s.rtt));
  }

  /** Local time → host time. */
  toHost(local: number): number {
    return local + this.offset;
  }

  /** Host time → local time. */
  toLocal(host: number): number {
    return host - this.offset;
  }
}
