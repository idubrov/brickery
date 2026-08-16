// Application coordinator (spec §6): wires GameEngine ↔ Renderers (2D/3D) ↔
// Audio ↔ UI. Owns render-mode switching, persistence of the render mode,
// and session restoration.

import { STORAGE_RENDER_MODE_KEY } from './core/Constants.js';
import { GameEngine } from './core/GameEngine.js';
import SoundSystem from './audio/SoundSystem.js';
import UIManager from './ui/UIManager.js';
import Renderer3D from './render/Renderer3D.js';
import Renderer2D from './render/Renderer2D.js';

const RENDER_MODES = ['3d', '2d'];
const DEFAULT_RENDER_MODE = '3d';

function safeStorage() {
  try {
    const s = window.localStorage;
    s.setItem('__bricks_probe__', '1');
    s.removeItem('__bricks_probe__');
    return s;
  } catch {
    return null;
  }
}

export class App {
  constructor() {
    this.storage = safeStorage();
    this.engine = new GameEngine({ storage: this.storage || undefined });
    this.restored = this.engine.loadState();

    this.renderMode = this.readRenderMode();
    this.soundOn = true;
    this.busy = false;

    this.sound = new SoundSystem();
    this.ui = new UIManager({ callbacks: this.makeUiCallbacks() });
    this.renderers = {
      '3d': new Renderer3D({ callbacks: this.makeRendererCallbacks(), sound: this.sound }),
      '2d': new Renderer2D({ callbacks: this.makeRendererCallbacks(), sound: this.sound }),
    };
    this.active = null;
  }

  readRenderMode() {
    try {
      const m = this.storage && this.storage.getItem(STORAGE_RENDER_MODE_KEY);
      return RENDER_MODES.includes(m) ? m : DEFAULT_RENDER_MODE;
    } catch {
      return DEFAULT_RENDER_MODE;
    }
  }

  makeRendererCallbacks() {
    return { onLaunch: (side, lane) => this.handleLaunch(side, lane) };
  }

  makeUiCallbacks() {
    return {
      onModeToggle: () => this.toggleMode(),
      onRestartWave: () => this.restartWave(),
      onResetGame: () => this.resetGame(),
      onNextWave: () => this.nextWave(),
      onFullscreen: () => this.toggleFullscreen(),
      onSoundToggle: () => this.toggleSound(),
      onHelp: () => this.showHelp(),
    };
  }

  start() {
    const hud = document.getElementById('hud');
    const board = document.getElementById('board');
    const modals = document.getElementById('modals');

    this.ui.mount(hud, modals);
    this.activateRenderer(this.renderMode);
    this.syncUI();

    if (this.engine.state === 'WAVE_CLEAR') this.ui.showModal('wave_clear');
    else if (this.engine.state === 'GAME_OVER') this.ui.showModal('game_over');

    document.addEventListener('fullscreenchange', () => this.syncUI());

    const unlock = () => this.sound.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  activateRenderer(mode) {
    if (this.active) this.active.unmount();
    this.active = this.renderers[mode];
    this.active.mount(document.getElementById('board'));
    this.active.syncFromGrid(this.engine.grid);
    this.active.setEnabled(this.engine.state === 'READY');
  }

  toggleMode() {
    this.renderMode = this.renderMode === '3d' ? '2d' : '3d';
    try {
      if (this.storage) this.storage.setItem(STORAGE_RENDER_MODE_KEY, this.renderMode);
    } catch {
      /* ignore */
    }
    this.activateRenderer(this.renderMode);
    this.syncUI();
  }

  handleLaunch(side, lane) {
    if (this.busy || this.engine.state !== 'READY') return;
    const tl = this.engine.launch(side, lane);
    if (!tl) return;
    this.busy = true;
    this.active.setEnabled(false);
    this.syncUI();
    const done = this.active.playTurnTimeline(tl);
    Promise.resolve(done).then(() => {
      this.afterTurn(tl);
      this.busy = false;
    });
  }

  afterTurn(tl) {
    this.active.syncFromGrid(this.engine.grid);
    this.syncUI();
    if (tl.result.state === 'WAVE_CLEAR') {
      this.active.setEnabled(false);
      this.ui.showModal('wave_clear');
    } else if (tl.result.state === 'GAME_OVER') {
      this.active.setEnabled(false);
      this.ui.showModal('game_over');
    } else {
      this.active.setEnabled(true);
    }
  }

  restartWave() {
    this.engine.restartWave();
    this.busy = false;
    this.ui.hideModal();
    this.active.syncFromGrid(this.engine.grid);
    this.active.setEnabled(true);
    this.syncUI();
  }

  resetGame() {
    this.engine.resetToWave1();
    this.busy = false;
    this.ui.hideModal();
    this.active.syncFromGrid(this.engine.grid);
    this.active.setEnabled(true);
    this.syncUI();
  }

  nextWave() {
    this.engine.startNextWave();
    this.busy = false;
    this.ui.hideModal();
    this.active.syncFromGrid(this.engine.grid);
    this.active.setEnabled(true);
    this.syncUI();
  }

  toggleSound() {
    this.soundOn = !this.soundOn;
    this.sound.setEnabled(this.soundOn);
    this.syncUI();
  }

  toggleFullscreen() {
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    }
  }

  showHelp() {
    this.ui.showModal('help');
  }

  syncUI() {
    this.ui.updateHUD({
      score: this.engine.score,
      highScore: this.engine.highScore,
      wave: this.engine.wave,
      waveStartScore: this.engine.waveStartScore,
      turnCount: this.engine.turnCount,
      renderMode: this.renderMode,
      soundOn: this.soundOn,
      fullscreen: !!document.fullscreenElement,
    });
  }
}

// Boot the application on load (module executes after the DOM is parsed).
const app = new App();
app.start();
