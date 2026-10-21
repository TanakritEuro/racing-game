// The co-driver: the next pace notes on screen as the car comes up to them, and (if you turn the
// voice on) read out by the browser's speech synthesis a few seconds ahead. Reads where the car
// is on the road; never writes to the simulation.

import { TUNING } from '../config';
import { noteText, type PaceNote } from '../track/paceNotes';

export class PaceNotesHud {
  private readonly root: HTMLElement;
  private readonly lines: HTMLElement[] = [];
  /** The next note not yet read out. */
  private next = 0;
  voice = false;

  constructor(
    parent: HTMLElement,
    private readonly notes: readonly PaceNote[],
  ) {
    this.root = document.createElement('div');
    this.root.className = 'pace-notes';
    parent.appendChild(this.root);
    for (let i = 0; i < 2; i++) {
      const line = document.createElement('div');
      line.className = i === 0 ? 'pace-note now' : 'pace-note';
      this.root.appendChild(line);
      this.lines.push(line);
    }
  }

  /** Back to the start (a restart): nothing read out yet. */
  reset(): void {
    this.next = 0;
    this.spoken = new WeakSet();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // No voice here.
    }
  }

  /** The car is `at` metres along the road at `speed` (m/s); `running`: the clock is going. */
  update(at: number, speed: number, running: boolean): void {
    const N = TUNING.stage.notes;
    const reach = Math.max(N.ahead, Math.abs(speed) * N.callTime);
    // Notes already behind the car are done.
    while (this.next < this.notes.length && this.notes[this.next].at < at - 5) this.next++;
    this.root.style.display = running || at > 0 ? 'block' : 'none';
    const upcoming = this.notes.slice(this.next, this.next + 2);
    this.lines.forEach((line, i) => {
      const note = upcoming[i];
      const show = note !== undefined && note.at - at < reach * (i === 0 ? 1.6 : 1.2);
      line.textContent = show ? capitalise(noteText(note)) : '';
      line.classList.toggle('hairpin', show && note.severity === 'hairpin');
    });
    // Read out the next note once it is within the calling distance.
    const due = this.notes[this.next];
    if (this.voice && running && due && !this.spoken.has(due) && due.at - at < reach) {
      this.spoken.add(due);
      this.say(noteText(due));
    }
  }

  private spoken = new WeakSet<PaceNote>();

  private say(text: string): void {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.35;
      window.speechSynthesis.speak(u);
    } catch {
      // No voice in this browser: the notes stay on screen.
    }
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
