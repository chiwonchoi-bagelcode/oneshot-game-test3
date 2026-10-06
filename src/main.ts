import './style.css';
import { App } from './app/App';

const app = new App();

// Menus that should close with the same key that opened them.
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (app.mode === 'journal' || app.mode === 'paused') {
    // Defer so the Input handler (which ignores non-playing modes) doesn't re-open them.
    setTimeout(() => app.handleMenuKey(e.code), 0);
  }
});

// Debug / test hook.
(window as unknown as { __game: App }).__game = app;
