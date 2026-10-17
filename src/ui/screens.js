// Shows exactly one full-screen overlay at a time (main menu, loading, pause,
// settings). `show(null)` hides them all, e.g. while flying.
export class ScreenManager {
  #screens = new Map();
  current = null;

  constructor(root) {
    this.root = root;
  }

  register(name, element) {
    element.classList.add('screen');
    this.root.append(element);
    this.#screens.set(name, element);
    return element;
  }

  show(name) {
    this.current = name;
    this.onShow?.(name);
    for (const [id, el] of this.#screens) el.classList.toggle('active', id === name);
    if (name) this.#screens.get(name)?.onShow?.();
  }
}
