import { h } from '../dom.js';

// Controller menu: replaces the mouse on the HUD. Opened with the controller's Back button; the
// D-pad moves, A selects, B backs out. While it is open the buttons do not reach the aircraft.

export function createPadMenu(hud, input) {
  const title = h('div.pad-title', 'Menu');
  const list = h('div.pad-list');
  const el = h('div.pad-menu', { hidden: true }, title, list, h('div.pad-hint', 'D-pad move · A select · B back'));
  let stack = [];
  let index = 0;
  let open = false;

  const toggleAction = (label, panelId) => ({ label: `${label} panel`, run: () => hud.panels.get(panelId)?.toggle(), keep: true });

  function rootItems() {
    const items = [];
    const atc = hud.atc;
    if (atc?.enabled && hud.systems.atc) items.push({ label: 'Radio (ATC)', sub: () => radioItems() });
    items.push({ label: 'Gear', run: () => hud.controls.perform('gear') });
    items.push({ label: 'Flaps +', run: () => hud.controls.perform('flaps_down') });
    items.push({ label: 'Flaps −', run: () => hud.controls.perform('flaps_up') });
    items.push({ label: 'Lights', run: () => hud.controls.perform('lights') });
    items.push({ label: 'Speedbrake', run: () => hud.controls.perform('speedbrake') });
    items.push({ label: 'Parking brake', run: () => hud.controls.perform('parking_brake') });
    items.push({ label: 'Camera', run: () => hud.controls.perform('camera_cycle') });
    if (hud.systems.perEngine) items.push({ label: 'Select engine', run: () => hud.controls.perform('engine_cycle') });
    items.push({ label: 'Systems', sub: () => systemItems() });
    items.push({ label: 'Panels', sub: () => [
      toggleAction('Flight display', 'pfd'), toggleAction('Engines', 'engines'), toggleAction('Controls', 'controls'),
      toggleAction('Fuel and systems', 'systems'), toggleAction('Checklist', 'checklist'), toggleAction('Map', 'nav'),
      toggleAction('Approach guide', 'approach'), toggleAction('Radio', 'radio'), toggleAction('Mission', 'mission'),
    ] });
    items.push({ label: hud.panels.hidden ? 'Show HUD' : 'Hide HUD', run: () => hud.toggleHud() });
    return items;
  }

  function radioItems() {
    const atc = hud.atc;
    const items = atc.menu.map((it) => ({ label: it.label + (it.children ? ' …' : ''), run: () => { atc.request(it.id, it.arg); }, keep: !!it.children, rebuild: true }));
    if (atc.inSubmenu) items.push({ label: 'Back', run: () => atc.back(), keep: true, rebuild: true });
    return items;
  }

  function systemItems() {
    return [
      { label: 'APU', run: () => hud.controls.perform('apu_toggle') },
      { label: 'Pitot heat', run: () => hud.controls.perform('pitot_heat') },
      { label: 'Emergency gear', run: () => hud.controls.perform('gear_emergency') },
      { label: 'Shut down engine', run: () => hud.controls.perform('engine_shutdown') },
      { label: 'Fire bottle', run: () => hud.controls.perform('fire_extinguish') },
      { label: 'Fuel dump', run: () => hud.controls.perform('fuel_dump') },
      { label: 'Crossfeed', run: () => hud.controls.perform('crossfeed') },
    ];
  }

  const current = () => (stack.length ? stack[stack.length - 1] : { items: rootItems(), title: 'Menu' });

  function render() {
    const cur = stack.length ? stack[stack.length - 1] : null;
    const items = cur ? cur.make() : rootItems();
    title.textContent = cur ? cur.title : 'Menu';
    list.replaceChildren(...items.map((it, i) => h(`div.pad-item${i === index ? '.on' : ''}`, it.label)));
    list.children[index]?.scrollIntoView?.({ block: 'nearest' });
    return items;
  }

  function show(on) {
    open = on;
    el.hidden = !on;
    input.menuCapture = on;
    if (on) { stack = []; index = 0; render(); }
  }

  function onButton(name) {
    if (!open) return;
    const items = render();
    if (name === 'DPadDown') index = (index + 1) % items.length;
    else if (name === 'DPadUp') index = (index + items.length - 1) % items.length;
    else if (name === 'B' || name === 'Back' || name === 'Start') {
      if (stack.length) { stack.pop(); index = 0; } else show(false);
    } else if (name === 'A') {
      const it = items[index];
      if (it?.sub) { stack.push({ title: it.label, make: it.sub }); index = 0; }
      else if (it?.run) {
        it.run();
        hud.audio?.click();
        if (!it.keep) show(false);
        else if (it.rebuild) setTimeout(() => open && render(), 50);
      }
    }
    if (open) render();
  }
  input.on('padbutton', onButton);
  hud.atcMenuChanged = () => { if (open) render(); };
  void current;
  return { el, toggle: () => show(!open), get isOpen() { return open; }, close: () => show(false) };
}
