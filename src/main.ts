import './style.css';
import { App } from './app/App';
import { audio } from './audio/Audio';

const app = new App();

// Menus that should close with the same key that opened them.
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (app.mode === 'journal' || app.mode === 'paused') {
    // Defer so the Input handler (which ignores non-playing modes) doesn't re-open them.
    setTimeout(() => app.handleMenuKey(e.code), 0);
  }
});

// Debug / test hooks.
(window as unknown as { __game: App; __audio: typeof audio }).__game = app;
(window as unknown as { __game: App; __audio: typeof audio }).__audio = audio;
