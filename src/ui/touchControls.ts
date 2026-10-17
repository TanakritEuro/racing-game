// The on-screen controls for phones and tablets, shown once the screen is touched:
//   - the left half steers: a thumb put down anywhere there and slid sideways (a marker shows
//     where it landed and how far it has gone);
//   - bottom right, the brake and the accelerator (pressed harder further up), and the
//     handbrake;
//   - along the top, pause, camera, put back on the track, and shift down and up (manual).
// Also: the device's tilt (tilt steering), a notice to turn a phone held upright sideways,
// full screen and the screen kept awake. Fingers go to `TouchInput`; nothing else is touched.

import type { Pedal, TouchButton, TouchInput } from '../input/touch';
import { div } from './menu';

export class TouchControls {
  private readonly root: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly shifters: HTMLElement[] = [];
  private shown = false;
  private listening = false;

  constructor(
    parent: HTMLElement,
    private readonly input: TouchInput,
  ) {
    this.root = div(parent, 'touch-controls hidden');
    div(parent, 'touch-portrait', 'Turn your phone sideways to drive.');

    // Steering: the left half.
    const steer = div(this.root, 'touch-steer');
    this.marker = div(steer, 'touch-marker hidden');
    this.knob = div(this.marker, 'touch-knob');
    steer.addEventListener('pointerdown', (e) => {
      capture(steer, e);
      input.thumbDown(e.pointerId, e.clientX);
      this.marker.classList.remove('hidden');
      this.marker.style.left = `${e.clientX}px`;
      this.marker.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translateX(0)';
    });
    steer.addEventListener('pointermove', (e) => {
      input.thumbMove(e.pointerId, e.clientX);
      const x0 = Number.parseFloat(this.marker.style.left);
      this.knob.style.transform = `translateX(${Math.max(-70, Math.min(70, e.clientX - x0))}px)`;
    });
    const lift = (e: PointerEvent) => {
      input.up(e.pointerId);
      this.marker.classList.add('hidden');
    };
    steer.addEventListener('pointerup', lift);
    steer.addEventListener('pointercancel', lift);

    // Pedals: bottom right.
    const pedals = div(this.root, 'touch-pedals');
    this.pedal(pedals, 'brake', 'BRAKE');
    this.pedal(pedals, 'throttle', 'GAS');
    this.pedal(this.root, 'handbrake', 'HAND\nBRAKE');

    // Buttons: along the top.
    const top = div(this.root, 'touch-top');
    this.button(top, 'pause', '❚❚');
    this.button(top, 'camera', 'CAM');
    this.button(top, 'reset', '↺');
    this.shifters.push(this.button(top, 'down', '−'), this.button(top, 'up', '+'));

    // The first touch anywhere: a touch screen. Show the controls, go full screen.
    window.addEventListener(
      'touchstart',
      () => {
        this.show();
        void document.documentElement.requestFullscreen?.().catch(() => {});
      },
      { once: true, passive: true },
    );
    window.addEventListener('blur', () => input.release());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.shown) void this.keepAwake();
    });
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Show the controls (a touch screen is in use). */
  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.input.active = true;
    this.root.classList.remove('hidden');
    document.body.classList.add('touch');
    void this.keepAwake();
  }

  /** Each frame: the shift buttons only with a manual gearbox. */
  update(manual: boolean): void {
    for (const b of this.shifters) b.classList.toggle('hidden', !manual);
  }

  /** Tilt steering on or off. On iOS the first time needs permission, asked from this tap. */
  setTilt(on: boolean): void {
    this.input.mode = on ? 'tilt' : 'thumb';
    if (!on) {
      this.input.setRoll(null);
      return;
    }
    type Permission = { requestPermission?: () => Promise<string> };
    const ask = (globalThis.DeviceOrientationEvent as unknown as Permission | undefined)?.requestPermission;
    const listen = () => {
      if (this.listening) return;
      this.listening = true;
      window.addEventListener('deviceorientation', (e) => this.orientation(e));
    };
    if (ask) void ask().then((answer) => answer === 'granted' && listen(), () => {});
    else listen();
  }

  /** The device's roll, as a steering wheel's turn, from its orientation and which way up the screen is. */
  private orientation(e: DeviceOrientationEvent): void {
    if (this.input.mode !== 'tilt' || e.beta === null || e.gamma === null) return;
    const angle = screen.orientation?.angle ?? 0;
    // Landscape: turning it like a wheel is the front-to-back tilt (beta); upright, the side tilt (gamma).
    const roll = angle === 90 ? e.beta : angle === 270 || angle === -90 ? -e.beta : e.gamma;
    this.input.setRoll(roll);
  }

  private pedal(parent: HTMLElement, pedal: Pedal, label: string): void {
    const el = div(parent, `touch-pedal touch-${pedal}`, label);
    const up = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return 1 - (e.clientY - r.top) / r.height;
    };
    el.addEventListener('pointerdown', (e) => {
      capture(el, e);
      this.input.pedalDown(e.pointerId, pedal, up(e));
      el.classList.add('down');
    });
    el.addEventListener('pointermove', (e) => this.input.pedalMove(e.pointerId, up(e)));
    const lift = (e: PointerEvent) => {
      this.input.up(e.pointerId);
      el.classList.remove('down');
    };
    el.addEventListener('pointerup', lift);
    el.addEventListener('pointercancel', lift);
  }

  private button(parent: HTMLElement, button: TouchButton, label: string): HTMLElement {
    const el = div(parent, 'touch-button', label);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.press(button);
    });
    return el;
  }

  /** Keep the screen on while driving, where the browser allows it. */
  private async keepAwake(): Promise<void> {
    type WakeLock = { request(type: 'screen'): Promise<unknown> };
    const lock = (navigator as unknown as { wakeLock?: WakeLock }).wakeLock;
    try {
      // (The browser lets it go when the page is hidden; it's asked for again when it's back.)
      await lock?.request('screen');
    } catch {
      // Not allowed here: the screen may dim.
    }
  }
}

/** Keep a finger's moves coming to `el` even when it slides off (where the browser allows). */
function capture(el: HTMLElement, e: PointerEvent): void {
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    // An unknown pointer (synthetic): moves still arrive while it stays over the element.
  }
}
