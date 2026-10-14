import cessna172 from './data/cessna172.js';
import citation from './data/citation.js';
import fighter from './data/fighter.js';
import kingair from './data/kingair.js';

// Phase 2 roster. Phase 3 adds the remaining aircraft here.
export const AIRCRAFT = [cessna172, kingair, citation, fighter];

export function getAircraft(id) {
  return AIRCRAFT.find((a) => a.id === id) ?? AIRCRAFT[0];
}
