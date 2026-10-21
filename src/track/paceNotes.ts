// Pace notes: what a co-driver reads out, worked out from the road. Each corner gets its
// direction and a severity from its tightest radius (6 the fastest, 1 the slowest, then
// "hairpin"), "long" if it keeps turning, "into" when the next follows straight on; crests are
// called, in a corner as "over crest"; and the distance to the next call when there's a gap
// worth knowing. Pure, from the track's samples alone.

import { TUNING } from '../config';
import { curvature } from './corners';
import type { Track } from './track';

export type Severity = 1 | 2 | 3 | 4 | 5 | 6 | 'hairpin';

export interface PaceNote {
  /** Where the call is about (m along the road: the corner's start, the crest's top). */
  at: number;
  kind: 'corner' | 'crest';
  /** A corner's direction, severity, and whether it keeps turning. */
  direction?: 'left' | 'right';
  severity?: Severity;
  long?: boolean;
  /** Over a crest (a corner on one). */
  crest?: boolean;
  /** The next call follows straight on (within `TUNING.stage.notes.link` m). */
  into?: boolean;
  /** Metres to the next call, when there's a gap worth calling (rounded to 50). */
  gap?: number;
}

/** The notes for a stage, start to finish, in order. */
export function paceNotes(track: Track): PaceNote[] {
  const N = TUNING.stage.notes;
  const { samples } = track;
  const n = samples.length;
  const spacing = track.length / Math.max(1, n - 1);
  const k = samples.map((_, i) => curvature(track, i));
  // The road's vertical curvature (1/m): negative over a crest.
  const reach = Math.max(1, Math.round(N.crestSpan / spacing));
  const vertical = samples.map((p, i) => {
    if (i < reach || i >= n - reach) return 0;
    const g0 = (p.y - samples[i - reach].y) / (reach * spacing);
    const g1 = (samples[i + reach].y - p.y) / (reach * spacing);
    return (g1 - g0) / (reach * spacing);
  });

  const notes: PaceNote[] = [];
  /** Where each corner ends (m). */
  const ends = new Map<PaceNote, number>();
  // Corners: runs turning the same way tighter than the loosest note's radius.
  let i = 0;
  while (i < n) {
    if (Math.abs(k[i]) < 1 / N.radii[5]) {
      i++;
      continue;
    }
    const sign = Math.sign(k[i]);
    const first = i;
    let tightest = Math.abs(k[i]);
    while (i < n && Math.sign(k[i]) === sign && Math.abs(k[i]) >= 1 / N.radii[5]) {
      tightest = Math.max(tightest, Math.abs(k[i]));
      i++;
    }
    const last = i - 1;
    const radius = 1 / tightest;
    const length = (last - first) * spacing;
    if (length < N.minLength) continue;
    let severity: Severity = 6;
    if (radius < N.hairpin) severity = 'hairpin';
    else for (let s = 0; s < 6; s++) if (radius < N.radii[s]) {
      severity = (s + 1) as Severity;
      break;
    }
    let crest = false;
    for (let j = first; j <= last; j++) if (vertical[j] < -N.crest) crest = true;
    // With +X right and +Z towards the viewer from above, a right turn has positive curvature.
    const note: PaceNote = { at: samples[first].s, kind: 'corner', direction: sign > 0 ? 'right' : 'left', severity, long: length > N.long, crest };
    notes.push(note);
    ends.set(note, samples[last].s);
  }
  // Crests on the straights: the top of each run of convex road outside a corner.
  const inCorner = (s: number) => notes.some((c) => s >= c.at && s <= (ends.get(c) ?? c.at));
  i = 0;
  while (i < n) {
    if (vertical[i] >= -N.crest) {
      i++;
      continue;
    }
    let top = i;
    while (i < n && vertical[i] < -N.crest) {
      if (vertical[i] < vertical[top]) top = i;
      i++;
    }
    if (!inCorner(samples[top].s)) notes.push({ at: samples[top].s, kind: 'crest' });
  }
  notes.sort((a, b) => a.at - b.at);
  // Links and gaps: from the end of each call to the start of the next.
  notes.forEach((note, j) => {
    const next = notes[j + 1];
    const end = ends.get(note) ?? note.at;
    if (!next) return;
    const gap = next.at - end;
    if (gap < N.link) note.into = true;
    else if (gap >= N.callGap) note.gap = Math.round(gap / 50) * 50;
  });
  return notes;
}

/** A note as the co-driver says it: "left 4 long, over crest, into", "hairpin right, 150". */
export function noteText(note: PaceNote): string {
  const parts: string[] = [];
  if (note.kind === 'crest') parts.push('crest');
  else {
    parts.push(note.severity === 'hairpin' ? `hairpin ${note.direction}` : `${note.direction} ${note.severity}`);
    if (note.long) parts[0] += ' long';
    if (note.crest) parts.push('over crest');
  }
  if (note.into) parts.push('into');
  else if (note.gap) parts.push(String(note.gap));
  return parts.join(', ');
}
