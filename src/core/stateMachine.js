import { Emitter } from './events.js';

export const GameState = Object.freeze({
  MENU: 'menu',
  LOADING: 'loading',
  FLYING: 'flying',
  PAUSED: 'paused',
});

// Which states each state may move to. Anything else is a bug and throws,
// which keeps UI wiring honest as more screens/modes are added.
const TRANSITIONS = {
  [GameState.MENU]: [GameState.LOADING],
  [GameState.LOADING]: [GameState.FLYING, GameState.MENU],
  [GameState.FLYING]: [GameState.PAUSED, GameState.MENU],
  [GameState.PAUSED]: [GameState.FLYING, GameState.MENU],
};

export class StateMachine extends Emitter {
  constructor(initial = GameState.MENU) {
    super();
    this.current = initial;
  }

  is(...states) {
    return states.includes(this.current);
  }

  go(next, data) {
    if (next === this.current) return;
    if (!TRANSITIONS[this.current]?.includes(next)) {
      throw new Error(`Illegal state transition ${this.current} -> ${next}`);
    }
    const from = this.current;
    this.current = next;
    this.emit('change', { from, to: next, data });
  }
}
