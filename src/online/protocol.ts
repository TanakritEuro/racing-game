// The messages between two browsers in an online race. Either side can send most of them;
// the host decides the circuit, the laps and when the lights go out. What arrives is only as
// good as the other browser's code, so every message is checked before it is used.
//
// Bump PROTOCOL whenever a message changes: mismatched versions refuse to race.

export const PROTOCOL = 1;

export type Message =
  /** Guest → host on connecting: its version and the car it will drive. */
  | { type: 'hello'; version: number; car: string }
  /** Host → guest: the race, and the host's car. */
  | { type: 'welcome'; track: string; laps: number; car: string }
  | { type: 'reject'; reason: string }
  /** The circuit is built and the car is on the grid. */
  | { type: 'ready' }
  /** Clock sync: a ping with the sender's time, and the answer with the answerer's. */
  | { type: 'ping'; t: number }
  | { type: 'pong'; t: number; at: number }
  /** Host → guest: the lights go out at this time on the host's clock (s). */
  | { type: 'lights'; outAt: number }
  /** A car's packed state (state.ts), on the unordered channel. */
  | { type: 'state'; data: ArrayBuffer }
  /** Took the flag: race time (s) and best lap. */
  | { type: 'finish'; time: number; best: number | null }
  /** Wants another race on the same circuit. */
  | { type: 'rematch' }
  | { type: 'bye'; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isString = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;

/** A message from the network, or null if it isn't one this version understands. */
export function parseMessage(raw: unknown): Message | null {
  if (!isObject(raw) || !isString(raw.type, 20)) return null;
  switch (raw.type) {
    case 'hello':
      return isNumber(raw.version) && isString(raw.car, 40) ? { type: 'hello', version: raw.version, car: raw.car } : null;
    case 'welcome':
      return isString(raw.track, 40) && Number.isInteger(raw.laps) && (raw.laps as number) >= 1 && (raw.laps as number) <= 50 && isString(raw.car, 40)
        ? { type: 'welcome', track: raw.track, laps: raw.laps as number, car: raw.car }
        : null;
    case 'reject':
      return isString(raw.reason) ? { type: 'reject', reason: raw.reason } : null;
    case 'ready':
      return { type: 'ready' };
    case 'ping':
      return isNumber(raw.t) ? { type: 'ping', t: raw.t } : null;
    case 'pong':
      return isNumber(raw.t) && isNumber(raw.at) ? { type: 'pong', t: raw.t, at: raw.at } : null;
    case 'lights':
      return isNumber(raw.outAt) ? { type: 'lights', outAt: raw.outAt } : null;
    case 'state':
      return raw.data instanceof ArrayBuffer ? { type: 'state', data: raw.data } : null;
    case 'finish':
      return isNumber(raw.time) && (raw.best === null || isNumber(raw.best)) ? { type: 'finish', time: raw.time, best: raw.best as number | null } : null;
    case 'rematch':
      return { type: 'rematch' };
    case 'bye':
      return isString(raw.reason) ? { type: 'bye', reason: raw.reason } : null;
    default:
      return null;
  }
}
