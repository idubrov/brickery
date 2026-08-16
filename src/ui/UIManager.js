// HUD, wave dropdown menu, modals, and fullscreen controls. (spec §4.6 / §6)
//
// UIManager renders the left (wave brand badge + dropdown) and right (score /
// high score / mode / fullscreen / sound / help) HUD groups, the Wave Clear /
// Game Over / Help modals, and owns the Fullscreen API toggle + fullscreenchange
// icon updates. It delegates all game actions to the injected callbacks.

const STYLE_ID = 'bricks-ui-style';

let styleInjected = false;

function ensureStyle() {
  if (styleInjected || typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) {
    styleInjected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
  styleInjected = true;
}

const CSS = `
.bricks-hud-bar{
  display:flex;align-items:center;gap:10px;
  padding:8px 12px;
  overflow-x:auto;overflow-y:hidden;
  -webkit-overflow-scrolling:touch;
  touch-action:pan-x;
  scrollbar-width:none;
  background:rgba(9,15,26,.85);
  backdrop-filter:blur(8px);
  border-bottom:1px solid rgba(71,85,105,.35);
}
.bricks-hud-bar::-webkit-scrollbar{display:none}
.bricks-hud-group{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.bricks-hud-left{flex:0 0 auto}
.bricks-hud-right{margin-left:auto;flex:0 0 auto}

.bricks-wave-badge{
  display:inline-flex;align-items:center;gap:5px;
  padding:6px 14px;border-radius:20px;border:none;
  background:linear-gradient(135deg,rgba(41,98,255,.32),rgba(0,200,83,.2));
  border:1px solid rgba(125,211,252,.45);
  color:#e2e8f0;font-weight:700;font-size:14px;font-family:inherit;
  cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.4);
  white-space:nowrap;
}
.bricks-wave-badge:hover{filter:brightness(1.15)}
.bricks-wave-badge-bracket{opacity:.6}
.bricks-wave-brand{letter-spacing:.06em;font-weight:800;color:#7dd3fc}
.bricks-wave-label{opacity:.85;font-weight:600}
.bricks-wave-n{color:#ffd600;font-weight:800}
.bricks-wave-caret{font-size:11px;opacity:.85}

.bricks-card{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  min-width:62px;padding:4px 12px;border-radius:12px;
  background:rgba(22,36,59,.85);border:1px solid rgba(71,85,105,.4);
  white-space:nowrap;
}
.bricks-card-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8}
.bricks-card-value{font-size:18px;font-weight:800;color:#f8fafc;font-variant-numeric:tabular-nums}

.bricks-btn{
  width:36px;height:36px;border-radius:10px;border:none;
  display:flex;align-items:center;justify-content:center;
  background:rgba(22,36,59,.85);border:1px solid rgba(71,85,105,.4);
  color:#e2e8f0;font-size:16px;font-family:inherit;cursor:pointer;
  white-space:nowrap;
}
.bricks-btn:hover{background:rgba(41,98,255,.3)}
.bricks-btn--mode{
  width:auto;min-width:42px;padding:0 12px;font-weight:800;font-size:14px;letter-spacing:.05em;
}

/* glassmorphic dropdown (z-index 100, viewport coords) */
.bricks-dropdown{
  position:fixed;z-index:100;min-width:230px;
  padding:6px;border-radius:14px;
  background:rgba(15,23,42,.94);
  backdrop-filter:blur(14px);
  border:1px solid rgba(125,211,252,.35);
  box-shadow:0 12px 40px rgba(0,0,0,.6);
}
.bricks-dropdown[hidden]{display:none}
.bricks-menu-item{
  display:block;width:100%;text-align:left;
  padding:11px 12px;border:none;border-radius:9px;
  background:transparent;color:#e2e8f0;font-size:14px;font-family:inherit;cursor:pointer;
}
.bricks-menu-item:hover{background:rgba(41,98,255,.3)}

/* mobile swipe affordance */
.bricks-swipe-cue{
  position:absolute;right:6px;top:50%;transform:translateY(-50%);
  width:28px;height:28px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  background:rgba(41,98,255,.92);color:#fff;font-weight:800;font-size:18px;
  opacity:0;pointer-events:none;transition:opacity .2s;z-index:6;
  box-shadow:0 2px 8px rgba(0,0,0,.5);cursor:pointer;
}
.bricks-swipe-cue.is-visible{opacity:1;pointer-events:auto;animation:bricks-swipe-hint 1.2s ease-in-out infinite}
@keyframes bricks-swipe-hint{
  0%,100%{transform:translateY(-50%) translateX(0)}
  50%{transform:translateY(-50%) translateX(6px)}
}
.bricks-edge-fade{
  position:absolute;right:0;top:0;bottom:0;width:48px;
  background:linear-gradient(90deg,transparent,rgba(9,15,26,.95));
  opacity:0;pointer-events:none;transition:opacity .2s;z-index:5;
}
.bricks-edge-fade.is-visible{opacity:1}

/* modals */
.bricks-modal{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  pointer-events:auto;z-index:1;padding:16px;
}
.bricks-modal[hidden]{display:none}
.bricks-modal-backdrop{
  position:absolute;inset:0;background:rgba(2,6,18,.62);backdrop-filter:blur(4px);
}
.bricks-modal-card{
  position:relative;max-width:440px;width:100%;
  padding:26px 24px;border-radius:18px;
  background:rgba(15,23,42,.97);
  border:1px solid rgba(125,211,252,.35);
  box-shadow:0 20px 60px rgba(0,0,0,.7);
  text-align:center;
}
.bricks-modal-card h2{margin:0 0 6px;font-size:24px;color:#f8fafc}
.bricks-modal-card .bricks-modal-sub{margin:0 0 18px;color:#94a3b8;font-size:14px}
.bricks-modal-actions{display:flex;flex-direction:column;gap:10px}
.bricks-modal-btn{
  padding:12px 16px;border-radius:12px;border:1px solid rgba(71,85,105,.4);
  background:rgba(22,36,59,.9);color:#e2e8f0;font-size:15px;font-weight:700;
  font-family:inherit;cursor:pointer;
}
.bricks-modal-btn:hover{background:rgba(41,98,255,.3)}
.bricks-modal-btn--primary{
  background:linear-gradient(135deg,#2962ff,#00c853);border:none;color:#fff;
}
.bricks-help-list{text-align:left;margin:0 0 18px;padding-left:20px;color:#cbd5e1;font-size:14px}
.bricks-help-list li{margin-bottom:9px;line-height:1.4}
.bricks-help-list strong{color:#f8fafc}
.bricks-help-link{
  display:inline-flex;align-items:center;gap:8px;
  color:#7dd3fc;text-decoration:none;font-weight:600;font-size:14px;
}
.bricks-help-link:hover{text-decoration:underline}
.bricks-help-link svg{width:18px;height:18px;fill:#7dd3fc}
`;

const GITHUB_MARK =
  'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';

export default class UIManager {
  constructor({ callbacks } = {}) {
    this.callbacks = callbacks || {};
    this._wave = 1;
    this._soundOn = true;
    this._fullscreenOn = false;
    this._dropdownOpen = false;
    this._modalOpen = false;

    this._hudEl = null;
    this._modalsEl = null;
    this._badge = null;
    this._waveEl = null;
    this._scoreEl = null;
    this._highEl = null;
    this._modeBtn = null;
    this._fullscreenBtn = null;
    this._soundBtn = null;
    this._bar = null;
    this._cue = null;
    this._edge = null;
    this._dropdown = null;
  }

  // ---- lifecycle ----

  mount(hudEl, modalsEl) {
    this._hudEl = hudEl;
    this._modalsEl = modalsEl;
    ensureStyle();
    this._buildHUD();
    this._buildModals();
    this._buildDropdown();
    this._attachListeners();
    this._updateSwipeAffordance();
  }

  destroy() {
    this._detachListeners();
    if (this._dropdown && this._dropdown.parentNode) this._dropdown.remove();
    if (this._hudEl) this._hudEl.textContent = '';
    if (this._modalsEl) this._modalsEl.textContent = '';
    this._hudEl = null;
    this._modalsEl = null;
    this._badge = null;
    this._waveEl = null;
    this._scoreEl = null;
    this._highEl = null;
    this._modeBtn = null;
    this._fullscreenBtn = null;
    this._soundBtn = null;
    this._bar = null;
    this._cue = null;
    this._edge = null;
    this._dropdown = null;
    this.callbacks = {};
  }

  // ---- HUD update ----

  updateHUD({ score, highScore, wave, waveStartScore, turnCount, renderMode, soundOn, fullscreen } = {}) {
    if (Number.isFinite(score) && this._scoreEl) this._scoreEl.textContent = String(score);
    if (Number.isFinite(highScore) && this._highEl) this._highEl.textContent = String(highScore);
    if (Number.isFinite(wave)) {
      this._wave = wave;
      if (this._waveEl) this._waveEl.textContent = String(wave);
    }
    if (renderMode && this._modeBtn) {
      this._modeBtn.textContent = renderMode === '3d' ? '2D' : '3D';
    }
    if (typeof soundOn === 'boolean') this.setSoundIcon(soundOn);
    if (typeof fullscreen === 'boolean') this.setFullscreenIcon(fullscreen);
  }

  setSoundIcon(on) {
    this._soundOn = Boolean(on);
    if (this._soundBtn) {
      this._soundBtn.textContent = on ? '🔊' : '🔇';
      this._soundBtn.title = on ? 'Mute sound' : 'Unmute sound';
    }
  }

  setFullscreenIcon(on) {
    this._fullscreenOn = Boolean(on);
    if (this._fullscreenBtn) {
      this._fullscreenBtn.textContent = on ? '⤡' : '⛶';
      this._fullscreenBtn.title = on ? 'Exit fullscreen' : 'Enter fullscreen';
    }
  }

  // ---- modals ----

  showModal(type) {
    const modal = this._modals && this._modals[type];
    if (!modal) return;
    this.hideModal();
    if (type === 'wave_clear') {
      const t = modal.querySelector('[data-wave-title]');
      if (t) t.textContent = 'Wave ' + this._wave + ' Cleared!';
    } else if (type === 'game_over') {
      const b = modal.querySelector('[data-restart-btn]');
      if (b) b.textContent = 'Restart Wave ' + this._wave + ' \u21BB';
    }
    modal.hidden = false;
    this._modalOpen = true;
  }

  hideModal() {
    if (!this._modals) return;
    for (const modal of Object.values(this._modals)) {
      if (modal) modal.hidden = true;
    }
    this._modalOpen = false;
  }

  // ---- DOM builders ----

  _el(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  _buildHUD() {
    const bar = this._el('div', 'bricks-hud-bar');
    const left = this._el('div', 'bricks-hud-group bricks-hud-left');
    const right = this._el('div', 'bricks-hud-group bricks-hud-right');

    // Left group — wave brand badge.
    this._badge = this._el('button', 'bricks-wave-badge');
    this._badge.setAttribute('type', 'button');
    this._badge.setAttribute('aria-haspopup', 'true');
    this._badge.setAttribute('aria-expanded', 'false');
    this._badge.append(this._el('span', 'bricks-wave-badge-bracket', '['));
    this._badge.append(this._el('span', 'bricks-wave-brand', 'BRICKS'));
    this._badge.append(this._el('span', 'bricks-wave-label', 'Wave'));
    this._waveEl = this._el('span', 'bricks-wave-n', String(this._wave));
    this._badge.append(this._waveEl);
    this._badge.append(this._el('span', 'bricks-wave-caret', '\u25BE'));
    this._badge.append(this._el('span', 'bricks-wave-badge-bracket', ']'));
    this._badge.title = 'Wave options';
    left.append(this._badge);

    // Right group — score, high score, mode, fullscreen, sound, help.
    const scoreCard = this._el('div', 'bricks-card');
    scoreCard.append(this._el('span', 'bricks-card-label', 'Score'));
    this._scoreEl = this._el('span', 'bricks-card-value', '0');
    scoreCard.append(this._scoreEl);

    const highCard = this._el('div', 'bricks-card');
    highCard.append(this._el('span', 'bricks-card-label', 'High'));
    this._highEl = this._el('span', 'bricks-card-value', '0');
    highCard.append(this._highEl);

    this._modeBtn = this._el('button', 'bricks-btn bricks-btn--mode', '2D');
    this._modeBtn.id = 'mode-toggle-btn';
    this._modeBtn.type = 'button';
    this._modeBtn.title = 'Toggle render mode';

    this._fullscreenBtn = this._el('button', 'bricks-btn', '\u26F6');
    this._fullscreenBtn.type = 'button';
    this._fullscreenBtn.title = 'Enter fullscreen';

    this._soundBtn = this._el('button', 'bricks-btn', '\uD83D\uDD0A');
    this._soundBtn.type = 'button';
    this._soundBtn.title = 'Mute sound';

    const helpBtn = this._el('button', 'bricks-btn', '?');
    helpBtn.type = 'button';
    helpBtn.title = 'How to play';

    right.append(scoreCard, highCard, this._modeBtn, this._fullscreenBtn, this._soundBtn, helpBtn);

    bar.append(left, right);
    this._hudEl.append(bar);

    // Swipe cue + edge fade overlays.
    this._cue = this._el('div', 'bricks-swipe-cue', '\u203A');
    this._cue.setAttribute('aria-hidden', 'true');
    this._edge = this._el('div', 'bricks-edge-fade');
    this._hudEl.append(this._cue, this._edge);

    this._bar = bar;
    this._helpBtn = helpBtn;
  }

  _buildModals() {
    const waveClear = this._el('div', 'bricks-modal');
    waveClear.dataset.modal = 'wave_clear';
    waveClear.hidden = true;
    waveClear.append(this._el('div', 'bricks-modal-backdrop'));
    const wcCard = this._el('div', 'bricks-modal-card');
    const wcTitle = this._el('h2', null, 'Wave Cleared!');
    wcTitle.setAttribute('data-wave-title', '');
    wcCard.append(wcTitle);
    wcCard.append(this._el('p', 'bricks-modal-sub', '+2,500 wave clear bonus'));
    const wcActions = this._el('div', 'bricks-modal-actions');
    const nextBtn = this._el('button', 'bricks-modal-btn bricks-modal-btn--primary', 'Start Next Wave \u2192');
    nextBtn.dataset.action = 'next_wave';
    wcActions.append(nextBtn);
    wcCard.append(wcActions);
    waveClear.append(wcCard);
    this._modalsEl.append(waveClear);

    const gameOver = this._el('div', 'bricks-modal');
    gameOver.dataset.modal = 'game_over';
    gameOver.hidden = true;
    gameOver.append(this._el('div', 'bricks-modal-backdrop'));
    const goCard = this._el('div', 'bricks-modal-card');
    goCard.append(this._el('h2', null, 'Game Over'));
    goCard.append(this._el('p', 'bricks-modal-sub', 'No valid moves remain on the board.'));
    const goActions = this._el('div', 'bricks-modal-actions');
    const restartBtn = this._el('button', 'bricks-modal-btn bricks-modal-btn--primary', 'Restart Wave \u21BB');
    restartBtn.dataset.action = 'restart_wave';
    restartBtn.setAttribute('data-restart-btn', '');
    const resetBtn = this._el('button', 'bricks-modal-btn', 'Reset to Wave 1 \u23EE');
    resetBtn.dataset.action = 'reset_game';
    goActions.append(restartBtn, resetBtn);
    goCard.append(goActions);
    gameOver.append(goCard);
    this._modalsEl.append(gameOver);

    const help = this._el('div', 'bricks-modal');
    help.dataset.modal = 'help';
    help.hidden = true;
    help.append(this._el('div', 'bricks-modal-backdrop'));
    const helpCard = this._el('div', 'bricks-modal-card');
    helpCard.append(this._el('h2', null, 'How to Play'));
    const list = this._el('ul', 'bricks-help-list');
    const rules = [
      ['Launch Bricks', 'Tap a brick in any wall\u2019s inner layer to launch it across the field; it stops right before the first obstacle.'],
      ['Form Lines', 'Match 3 or more bricks of the same color in a straight line to clear them.'],
      ['Momentum Cascades', 'Moving bricks keep sliding after every match, chaining combos and pushing bricks into the walls.'],
      ['Clear the Field', 'Empty the 10\u00D710 field to clear the wave. If no moves remain, the game is over.'],
    ];
    for (const [title, body] of rules) {
      const li = this._el('li');
      li.append(this._el('strong', null, title));
      li.append(document.createTextNode(' \u2014 ' + body));
      list.append(li);
    }
    helpCard.append(list);
    const link = this._el('a', 'bricks-help-link');
    link.href = 'https://github.com/AlexKorostov/bricks-game';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' +
      GITHUB_MARK +
      '"/></svg><span>GitHub</span>';
    helpCard.append(link);
    help.append(helpCard);
    this._modalsEl.append(help);

    this._modals = {
      wave_clear: waveClear,
      game_over: gameOver,
      help,
    };
  }

  _buildDropdown() {
    this._dropdown = this._el('div', 'bricks-dropdown');
    this._dropdown.hidden = true;
    this._dropdown.setAttribute('role', 'menu');

    const restart = this._el('button', 'bricks-menu-item', '\u21BB Restart Current Wave');
    restart.type = 'button';
    restart.dataset.action = 'restart';
    restart.setAttribute('role', 'menuitem');

    const reset = this._el('button', 'bricks-menu-item', '\u23EE Reset to Wave 1 (New Game)');
    reset.type = 'button';
    reset.dataset.action = 'reset';
    reset.setAttribute('role', 'menuitem');

    this._dropdown.append(restart, reset);
    document.body.append(this._dropdown);
  }

  // ---- listeners ----

  _attachListeners() {
    this._onBadgeClick = (e) => this._toggleDropdown(e);
    this._onDocClick = (e) => this._handleDocClick(e);
    this._onKey = (e) => this._handleKey(e);
    this._onScroll = () => this._updateSwipeAffordance();
    this._onResize = () => this._updateSwipeAffordance();
    this._onFullscreenChange = () => this._handleFullscreenChange();
    this._onDropdownAction = (e) => this._handleDropdownAction(e);
    this._onModalAction = (e) => this._handleModalAction(e);

    this._badge.addEventListener('click', this._onBadgeClick);
    this._dropdown.addEventListener('click', this._onDropdownAction);
    document.addEventListener('click', this._onDocClick);
    document.addEventListener('keydown', this._onKey);
    this._bar.addEventListener('scroll', this._onScroll, { passive: true });
    window.addEventListener('resize', this._onResize);
    document.addEventListener('fullscreenchange', this._onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this._onFullscreenChange);
    this._cue.addEventListener('click', () => this._revealRest());

    this._modeBtn.addEventListener('click', () => this.callbacks.onModeToggle && this.callbacks.onModeToggle());
    this._fullscreenBtn.addEventListener('click', () => this._toggleFullscreen());
    this._soundBtn.addEventListener('click', () => this.callbacks.onSoundToggle && this.callbacks.onSoundToggle());
    this._helpBtn.addEventListener('click', () => {
      this.showModal('help');
      if (this.callbacks.onHelp) this.callbacks.onHelp();
    });

    this._modalsEl.addEventListener('click', this._onModalAction);
    this._modalsEl.addEventListener('click', (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('bricks-modal-backdrop')) {
        this.hideModal();
      }
    });
  }

  _detachListeners() {
    document.removeEventListener('click', this._onDocClick);
    document.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('fullscreenchange', this._onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', this._onFullscreenChange);
    if (this._bar) this._bar.removeEventListener('scroll', this._onScroll);
  }

  // ---- handlers ----

  _toggleDropdown(e) {
    e.stopPropagation();
    if (this._dropdownOpen) {
      this._closeDropdown();
    } else {
      this._openDropdown();
    }
  }

  _openDropdown() {
    this._dropdown.hidden = false;
    this._dropdownOpen = true;
    this._badge.setAttribute('aria-expanded', 'true');
    const r = this._badge.getBoundingClientRect();
    const menuWidth = this._dropdown.offsetWidth || 230;
    let left = r.left;
    if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
    this._dropdown.style.left = Math.max(8, left) + 'px';
    this._dropdown.style.top = r.bottom + 6 + 'px';
  }

  _closeDropdown() {
    this._dropdown.hidden = true;
    this._dropdownOpen = false;
    this._badge.setAttribute('aria-expanded', 'false');
  }

  _handleDocClick(e) {
    if (
      this._dropdownOpen &&
      !this._dropdown.contains(e.target) &&
      !this._badge.contains(e.target)
    ) {
      this._closeDropdown();
    }
  }

  _handleKey(e) {
    if (e.key === 'Escape') {
      if (this._dropdownOpen) {
        this._closeDropdown();
      } else if (this._modalOpen) {
        this.hideModal();
      }
    }
  }

  _handleDropdownAction(e) {
    const item = e.target.closest('[data-action]');
    if (!item) return;
    this._closeDropdown();
    const action = item.dataset.action;
    if (action === 'restart' && this.callbacks.onRestartWave) this.callbacks.onRestartWave();
    if (action === 'reset' && this.callbacks.onResetGame) this.callbacks.onResetGame();
  }

  _handleModalAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'next_wave' && this.callbacks.onNextWave) {
      this.hideModal();
      this.callbacks.onNextWave();
    } else if (action === 'restart_wave' && this.callbacks.onRestartWave) {
      this.hideModal();
      this.callbacks.onRestartWave();
    } else if (action === 'reset_game' && this.callbacks.onResetGame) {
      this.hideModal();
      this.callbacks.onResetGame();
    }
  }

  _toggleFullscreen() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsEl) {
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) req.call(el).catch(() => {});
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document).catch(() => {});
    }
  }

  _handleFullscreenChange() {
    const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
    this.setFullscreenIcon(on);
    if (this.callbacks.onFullscreen) this.callbacks.onFullscreen(on);
  }

  _revealRest() {
    if (!this._bar) return;
    const max = this._bar.scrollWidth - this._bar.clientWidth;
    this._bar.scrollTo({ left: max, behavior: 'smooth' });
  }

  _updateSwipeAffordance() {
    if (!this._bar || !this._cue || !this._edge) return;
    const maxScroll = this._bar.scrollWidth - this._bar.clientWidth;
    const atEnd = this._bar.scrollLeft >= maxScroll - 2;
    const overflowing = maxScroll > 2;
    const show = overflowing && !atEnd;
    this._cue.classList.toggle('is-visible', show);
    this._edge.classList.toggle('is-visible', show);
  }
}
