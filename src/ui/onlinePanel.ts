// An online race's own screens: connecting, the room code while the host waits, and what went
// wrong; and a status line over the race (waiting for the other player, a rematch, the other
// player gone). Plain DOM in the menus' style. Reads nothing from the game itself.

import { button, div } from './menu';

export interface PanelButton {
  label: string;
  onClick: () => void;
}

export class OnlinePanel {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly code: HTMLElement;
  private readonly text: HTMLElement;
  private readonly buttons: HTMLElement;
  private readonly status: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = div(parent, 'menu-root hidden');
    const panel = div(this.root, 'menu online-menu');
    this.title = div(panel, 'menu-title');
    this.code = div(panel, 'online-code');
    this.text = div(panel, 'menu-help online-text');
    this.buttons = div(panel, 'menu-row');
    this.status = div(parent, 'online-status');
  }

  /** A screen: a title, a room code in big letters (or nothing), a line of text and buttons. */
  show(title: string, text: string, { code = '', buttons = [] }: { code?: string; buttons?: PanelButton[] } = {}): void {
    this.root.classList.remove('hidden');
    this.title.textContent = title;
    this.code.textContent = code;
    this.code.classList.toggle('hidden', code === '');
    this.text.textContent = text;
    this.buttons.replaceChildren();
    buttons.forEach((b, i) => button(this.buttons, b.label, i === 0 ? 'menu-go' : '').addEventListener('click', b.onClick));
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** The line over the race ('' hides it). */
  setStatus(text: string): void {
    if (this.status.textContent !== text) this.status.textContent = text;
    this.status.classList.toggle('hidden', text === '');
  }
}
