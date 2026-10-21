// The messages between two browsers in an online race. Either side can send most of them;
// the host decides the circuit, the laps and when the lights go out. What arrives is only as
// good as the other browser's code, so every message is checked before it is used.
//
// Bump PROTOCOL whenever a message (or the list of cars) changes: mismatched versions refuse to race.

import { CONDITIONS, type Conditions } from '../track/weather';
import { WEAR_RATES, type WearRate } from '../vehicle/wear';
import { cleanCustom, customId, type CustomCircuit } from '../track/custom';

export const PROTOCOL = 7;

export type Message =
  /** Guest → host on connecting: its version and the car it will drive. */
  | { type: 'hello'; version: number; car: string }
  /** Host → guest: the race, the host's car (the AI's too), how many AI opponents, the weather and tyre wear. */
  | { type: 'welcome'; track: string; laps: number; car: string; opponents: number; conditions: Conditions; wear: WearRate; custom: CustomCircuit | null }
  | { type: 'reject'; reason: string }
  /** The circuit is built and the car is on the grid. */
  | { type: 'ready' }
  /** Clock sync: a ping with the sender's time, and the answer with the answerer's. */
  | { type: 'ping'; t: number }
  | { type: 'pong'; t: number; at: number }
  /**
   * Host → guest: the lights go out at `outAt` on the host's clock (s); all five were lit
   * `wait` seconds before that, one a second before them.
   */
  | { type: 'lights'; outAt: number; wait: number }
  /** A car's packed state (state.ts), on the unordered channel: car 0 is the host's, 1 the guest's, 2 and up the host's AI. */
  | { type: 'state'; car: number; data: ArrayBuffer }
  /** A car (numbered as for states) took the flag: race time (s) and best lap. */
  | { type: 'finish'; car: number; time: number; best: number | null }
  /** Wants another race on the same circuit. */
  | { type: 'rematch' }
  | { type: 'bye'; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isString = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const isCount = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** A message from the network, or null if it isn't one this version understands. */
export function parseMessage(raw: unknown): Message | null {
  if (!isObject(raw) || !isString(raw.type, 20)) return null;
  switch (raw.type) {
    case 'hello':
      return isNumber(raw.version) && isString(raw.car, 40) ? { type: 'hello', version: raw.version, car: raw.car } : null;
    case 'welcome':
      return isString(raw.track, 40) &&
        isCount(raw.laps, 1, 50) &&
        isString(raw.car, 40) &&
        isCount(raw.opponents, 0, 7) &&
        CONDITIONS.includes(raw.conditions as Conditions) &&
        WEAR_RATES.includes(raw.wear as WearRate) &&
        // A custom circuit, in full: it must be one, and the one named.
        (raw.custom === null || cleanCustom(raw.custom) !== null) &&
        (raw.custom === null || customId(cleanCustom(raw.custom)!) === raw.track)
        ? {
            type: 'welcome',
            track: raw.track,
            laps: raw.laps,
            car: raw.car,
            opponents: raw.opponents,
            conditions: raw.conditions as Conditions,
            wear: raw.wear as WearRate,
            custom: raw.custom === null ? null : cleanCustom(raw.custom),
          }
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
      return isNumber(raw.outAt) && isNumber(raw.wait) && raw.wait >= 0 && raw.wait < 10 ? { type: 'lights', outAt: raw.outAt, wait: raw.wait } : null;
    case 'state':
      return isCount(raw.car, 0, 15) && raw.data instanceof ArrayBuffer ? { type: 'state', car: raw.car, data: raw.data } : null;
    case 'finish':
      return isCount(raw.car, 0, 15) && isNumber(raw.time) && (raw.best === null || isNumber(raw.best))
        ? { type: 'finish', car: raw.car, time: raw.time, best: raw.best as number | null }
        : null;
    case 'rematch':
      return { type: 'rematch' };
    case 'bye':
      return isString(raw.reason) ? { type: 'bye', reason: raw.reason } : null;
    default:
      return null;
  }
}
