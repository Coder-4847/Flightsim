import { AlertAudio } from '../audio/alerts.js';
import { getAudio } from '../audio/audioBus.js';
import { computeApproach } from '../game/approachGuide.js';
import { evaluate as evaluateWarnings } from '../game/warnings.js';
import { h } from './dom.js';
import { createChecklistPanel } from './hud/checklistPanel.js';
import { createControlsPanel } from './hud/controlsPanel.js';
import { createDashboard } from './hud/dashboard.js';
import { createEnginePanel } from './hud/enginePanel.js';
import { createMissionPanel } from './hud/missionPanel.js';
import { createApproachPanel, createNavPanel, createPfdPanel } from './hud/instrumentPanels.js';
import { createPadMenu } from './hud/padMenu.js';
import { PanelManager, button } from './hud/panels.js';
import { createRadioPanel } from './hud/radioPanel.js';
import { createSystemsPanel } from './hud/systemsPanel.js';

// The flight HUD: data strip, prioritised warnings (with audio), toasts, touchdown report, crash
// card, ATC subtitles, plus the mouse-operable panels (radio, checklist, engines, controls, fuel and
// systems, flight display, map, approach guide) and the controller menu. Everything can be hidden
// with H; scale and opacity come from the settings.

const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '--');
const HOLD_SECONDS = 2.5;

export function createFlightHud({ onRestart, onSelect, onMenu, settings, input }) {
  const cell = (label, unit = '') => {
    const value = h('span.v', '--');
    const el = h('div.cell', h('span.l', label), value, unit && h('span.u', unit));
    return { el, value };
  };
  const cells = {
    ias: cell('IAS', 'kt'), alt: cell('ALT', 'ft'), hdg: cell('HDG', '°'),
    vs: cell('V/S', 'fpm'), thr: cell('THR', '%'), fuel: cell('FUEL', 'kg'),
  };
  const strip = h('div.strip', Object.values(cells).map((c) => c.el));
  const status = h('div.status');
  const warnings = h('div.warnings', { role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'false' });
  const toast = h('div.toast', { role: 'status', 'aria-live': 'polite' });
  const info = h('div.cam-info');
  const hint = h('div.flight-hint');
  const touchdown = h('div.touchdown');
  const subtitle = h('div.subtitle', { 'aria-live': 'polite' });
  const panelRoot = h('div.hud-panels');
  const toolbar = h('div.hud-toolbar');

  const crashTitle = h('h2', 'Crashed');
  const crashReason = h('p.crash-reason');
  const crashNote = h('p.crash-note');
  const crashRestart = h('button.btn.primary', { onclick: onRestart }, 'Restart flight');
  const crashSelect = h('button.btn', { onclick: onSelect }, 'Choose aircraft');
  const crashMenu = h('button.btn', { onclick: onMenu }, 'Main menu');
  const crash = h('div.crash-card', { hidden: true, role: 'alertdialog', 'aria-label': 'Flight ended' }, crashTitle, crashReason, crashNote, h('div.crash-actions', crashRestart, crashSelect, crashMenu));

  const el = h('div.flight-hud', warnings, info, toast, touchdown, subtitle, hint, strip, status, panelRoot, toolbar, crash);

  // ---- shared context for the panels ----------------------------------------------------------------------------
  const audio = new AlertAudio(settings, getAudio(settings));
  const hud = {
    root: el,
    panels: new PanelManager(panelRoot),
    audio,
    settings,
    session: null,
    guide: null,
    modeInfo: null, // () => info for the mission panel, or null outside the game modes
    perks: null, // Set of owned upgrade ids in the save-based modes, or null when everything is available
    autoOpenRadio: false,
    get model() { return this.session?.model ?? null; },
    get controls() { return this.session?.controls; },
    get atc() { return this.session?.atc ?? null; },
    get systems() { return this.session?.systems ?? { perEngine: false, manualFlaps: false, manualGear: false, atc: false, fuel: false, checklists: false }; },
    toast: (text) => el.showToast(text),
    flying: () => el.classList.contains('active') && !el.dataset.paused,
    showSubtitle: (msg) => showSubtitle(msg),
    toggleHud: () => setHudHidden(!hud.panels.hidden),
  };

  const radio = createRadioPanel(hud);
  const checklist = createChecklistPanel(hud);
  const engines = createEnginePanel(hud);
  const controlsPanel = createControlsPanel(hud);
  const systemsPanel = createSystemsPanel(hud);
  const pfd = createPfdPanel(hud);
  const nav = createNavPanel(hud);
  const approach = createApproachPanel(hud);
  const missionPanel = createMissionPanel(hud);
  const padMenu = createPadMenu(hud, input);
  el.append(padMenu.el);
  const dashboard = createDashboard(hud);
  el.append(dashboard.el);

  const TOOLBAR = [
    ['radio', 'Radio', 'R', 'Radio and ATC (R)'],
    ['checklist', 'Checklist', 'K', 'Checklists (K)'],
    ['nav', 'Map', 'M', 'Navigation map (M)'],
    ['pfd', 'Display', 'F2', 'Flight display (F2)'],
    ['engines', 'Engines', 'F3', 'Engines and throttle levers (F3)'],
    ['controls', 'Controls', 'F4', 'Flaps, gear, trim and more (F4)'],
    ['systems', 'Systems', 'F7', 'Fuel, electrics and emergency actions (F7)'],
    ['approach', 'Approach', 'F8', 'Approach guide and landing score (F8)'],
    ['mission', 'Mission', 'F9', 'Mission objectives and progress (F9)'],
  ];
  const toolButtons = {};
  for (const [id, label, key, tooltip] of TOOLBAR) {
    toolButtons[id] = button(h('span', h('span.tb-key', key), label), { onClick: () => hud.panels.get(id).toggle(), tooltip, className: 'tool' });
    toolbar.append(toolButtons[id]);
  }
  hud.panels.onToggle = (id, open) => toolButtons[id]?.classList.toggle('on', open);
  hud.panels.onLocked = (reason) => el.showToast(reason);

  function setHudHidden(hidden) {
    hud.panels.setHidden(hidden);
    el.classList.toggle('hud-off', hidden);
    if (hidden) el.showToast('HUD hidden (H to show)');
  }

  // ---- toasts, hints, subtitles ---------------------------------------------------------------------------------------
  let toastTimer = 0;
  let touchdownTimer = 0;
  let hintTimer = 0;
  let subTimer = 0;

  el.showToast = (text) => {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  };

  function showSubtitle(msg) {
    if (settings.get('subtitles') === false) return;
    // Subtitles for the controller voice: always shown when the transcript panel is closed.
    subtitle.replaceChildren(h('b', `${msg.station ?? 'ATC'}: `), msg.text);
    subtitle.classList.add('show');
    clearTimeout(subTimer);
    subTimer = setTimeout(() => subtitle.classList.remove('show'), Math.min(9000, 3500 + msg.text.length * 55));
  }

  el.showTouchdown = (event) => {
    touchdown.replaceChildren(
      h('span.td-grade', { dataset: { grade: event.grade.toLowerCase().replace(' ', '-') } }, event.grade),
      h('span.td-detail', `${fmt(event.fpm)} ft/min · ${fmt(event.speed / 0.514444)} kt`),
    );
    touchdown.classList.add('show');
    clearTimeout(touchdownTimer);
    touchdownTimer = setTimeout(() => touchdown.classList.remove('show'), 6500);
  };

  el.showHint = (text) => {
    hint.textContent = text;
    hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove('show'), 14000);
  };

  el.setCrash = (reason, note = '') => {
    crash.hidden = !reason;
    crashNote.textContent = note;
    crashNote.hidden = !note;
    if (reason) { crashReason.textContent = reason; audio.stall(false); }
  };

  /** Game-mode context: where the mission panel gets its text and which upgrades are installed. */
  el.setMode = (mode) => {
    hud.modeInfo = mode?.info ?? null;
    hud.perks = mode?.perks ? new Set(mode.perks) : null;
    const perks = hud.perks;
    const gate = (panel, perk, reason) => { if (perks && !perks.has(perk)) hud.panels.lock(panel, reason); else hud.panels.unlock(panel); };
    gate('nav', 'gps', 'Navigation map needs the Moving-map GPS upgrade (Shop)');
    gate('approach', 'approach', 'Approach guide needs the Approach assist upgrade (Shop)');
    crashRestart.textContent = mode?.retryLabel ?? 'Restart flight';
    crashSelect.textContent = mode?.selectLabel ?? 'Choose aircraft';
    crashMenu.textContent = mode ? 'Back to menu' : 'Main menu';
    missionPanel.reset();
    el.refreshSystems();
    if (mode) hud.panels.get('mission').open();
    else hud.panels.get('mission').close();
  };

  // ---- binding to a flight ----------------------------------------------------------------------------------------------
  /** Call when a flight starts (or restarts) so the panels pick up the new aircraft and ATC. */
  el.bind = (session) => {
    hud.session = session;
    radio.bind(session.atc);
    checklist.reset();
    engines.rebuild();
    systemsPanel.rebuild();
    dashboard.rebuild();
    activeWarnings.clear();
    audio.stall(false);
    session.atc?.on('violation', (v) => el.showToast(`ATC: ${v.text}`));
    // First time on this device: open a sensible set of panels for the chosen mode.
    if (!localStorage.getItem('hudpanels')) {
      const sim = settings.get('preset') !== 'arcade';
      // Small windows get fewer panels so nothing sits on top of anything else.
      const dash = settings.get('dashboard') !== false; // the dashboard already has the instruments and levers
      const open = sim ? (window.innerWidth >= 1250 && !dash ? ['pfd', 'engines', 'radio'] : ['radio']) : [];
      for (const id of open) hud.panels.get(id).open();
    }
    el.refreshSystems();
    if (session.systems.atc) hud.panels.get('radio').open();
  };

  el.refreshSystems = () => {
    const sys = hud.systems;
    // Panels for systems that are switched off disappear (and their keys say why).
    toolButtons.mission.hidden = !hud.modeInfo;
    toolButtons.checklist.hidden = !sys.checklists;
    toolButtons.radio.hidden = !sys.atc;
    if (!sys.checklists) hud.panels.get('checklist').close();
    if (!sys.atc) hud.panels.get('radio').close();
    engines.rebuild();
    systemsPanel.rebuild();
    dashboard.rebuild();
    radio.refresh();
  };

  // Failures open their emergency checklist.
  el.onFailure = (event) => {
    checklist.onFailure(event.failure);
    el.showToast(event.text);
    audio.master();
  };

  el.setPaused = (paused) => { if (paused) el.dataset.paused = '1'; else delete el.dataset.paused; };

  // ---- panel and key actions --------------------------------------------------------------------------------------------------
  const ACTION_PANEL = {
    radio_menu: 'radio', checklist_toggle: 'checklist', map_toggle: 'nav', panel_pfd: 'pfd', panel_engines: 'engines',
    panel_controls: 'controls', panel_systems: 'systems', panel_approach: 'approach', panel_mission: 'mission',
  };
  el.handleAction = (action) => {
    if (action === 'radio_menu' && !hud.systems.atc) return el.showToast('ATC is off (turn it on in Settings or the setup screen)');
    if (action === 'checklist_toggle' && !hud.systems.checklists) return el.showToast('Checklists are off (turn them on in Settings or the setup screen)');
    if (action === 'panel_mission' && !hud.modeInfo) return el.showToast('Missions are part of Free Flight, Career, Emergency and VIP modes');
    if (action === 'dashboard_toggle') return dashboard.toggleCollapsed();
    if (action === 'hud_toggle') hud.toggleHud();
    else if (action === 'hud_menu') padMenu.toggle();
    else if (ACTION_PANEL[action]) hud.panels.get(ACTION_PANEL[action]).toggle();
  };

  // ---- warnings ----------------------------------------------------------------------------------------------------------------------
  const activeWarnings = new Map();
  function refreshWarnings(t, model, now) {
    const list = evaluateWarnings(t, model, { gpws: !hud.perks || hud.perks.has('gpws'), runwayIncursion: hud.atc?.phase === 'taxi' && hud.atc.me?.onRunway && !hud.atc.clr?.lineup && !hud.atc.clr?.takeoff });
    for (const w of list) {
      const known = activeWarnings.get(w.id);
      activeWarnings.set(w.id, { ...w, until: now + HOLD_SECONDS, fresh: !known });
      if (!known) {
        if (w.sound === 'master') audio.master();
        else if (w.sound === 'caution') audio.caution();
        else if (w.sound?.startsWith('gpws:')) audio.speak(w.sound.slice(5));
      } else if (w.sound?.startsWith('gpws:')) audio.speak(w.sound.slice(5));
    }
    for (const [id, w] of activeWarnings) if (w.until < now && !list.some((x) => x.id === id)) activeWarnings.delete(id);
    const shown = [...activeWarnings.values()].sort((a, b) => ({ red: 0, amber: 1, info: 2 }[a.level] - { red: 0, amber: 1, info: 2 }[b.level]));
    audio.stall(activeWarnings.has('stall'));
    const lead = shown.slice(0, 5);
    warnings.replaceChildren(...lead.map((w) => h('span.warn', { dataset: { tone: w.level } }, w.text)));
    el.classList.toggle('master-red', shown.some((w) => w.level === 'red'));
    // Priority rule: a red warning hides the info chips so the screen stays readable.
    if (shown.some((w) => w.level === 'red')) warnings.querySelectorAll('.warn[data-tone="info"]').forEach((n) => n.remove());
  }

  // ---- per-frame update ----------------------------------------------------------------------------------------------------------
  let navTick = 0;
  el.update = (t, extra) => {
    const model = hud.model;
    const now = performance.now() / 1000;
    cells.ias.value.textContent = fmt(t.ias);
    cells.alt.value.textContent = fmt(t.altitudeFt);
    cells.hdg.value.textContent = fmt(t.heading).padStart(3, '0');
    cells.vs.value.textContent = fmt(Math.round(t.vsFpm / 10) * 10);
    cells.thr.value.textContent = fmt(Math.max(...t.throttle) * 100);
    cells.fuel.value.textContent = fmt(t.fuel);

    const gear = t.gear > 0.98 ? 'DOWN' : t.gear < 0.02 ? 'UP' : 'TRANSIT';
    const flags = [
      `FLAPS ${fmt(t.flaps)}°`,
      extra.fixedGear ? 'GEAR FIXED' : `GEAR ${gear}`,
      t.parkingBrake ? 'PARK BRAKE' : '',
      t.tanks.length ? `CG ${fmt(t.cg * 100, 1)}% MAC` : '',
      `G ${fmt(t.nz, 1)}`,
      `AoA ${fmt(t.alpha)}°`,
      `ASSIST ${extra.assist.toUpperCase()}`,
      extra.windText,
    ].filter(Boolean);
    status.textContent = flags.join('   ·   ');
    info.textContent = extra.cameraLabel;
    const showDash = settings.get('dashboard') !== false && extra.cameraMode !== 'cockpit' && !hud.panels.hidden;
    el.classList.toggle('has-dash', showDash);
    if (!model) return;
    dashboard.update(t, showDash);
    refreshWarnings(t, model, now);

    // Navigation data shared by the map and the approach guide.
    const session = hud.session;
    const atc = session.atc;
    const assigned = atc?.enabled && atc.ctx?.approachAirport ? { airport: atc.ctx.approachAirport, endId: atc.ctx.approachEnd } : null;
    hud.guide = computeApproach(model, model.nav.airports, assigned, t);
    if (++navTick % 2 === 0) {
      const course = hud.guide ? { x: hud.guide.end.threshold.x, z: hud.guide.end.threshold.z, heading: hud.guide.end.heading } : null;
      model.nav.course = course;
      model.nav.hdgBug = atc?.enabled ? atc.ctx?.hdg ?? null : null;
      model.nav.traffic = session.collectTraffic();
    }
    for (const p of [pfd, nav, approach, engines, controlsPanel, systemsPanel, checklist, missionPanel]) p.update(t);
  };

  el.setVisible = (visible) => { el.classList.toggle('active', visible); };
  const fit = () => el.style.setProperty('--dash-fit', String(Math.max(0.5, Math.min(1, window.innerWidth / 1270, window.innerHeight / 880))));
  fit();
  window.addEventListener('resize', () => { hud.panels.clamp(); fit(); });
  el.hud = hud;
  return el;
}
