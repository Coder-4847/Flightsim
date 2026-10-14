import bizjet from './data/bizjet.js';
import caravan from './data/caravan.js';
import cessna172 from './data/cessna172.js';
import citation from './data/citation.js';
import fighter from './data/fighter.js';
import heavyfighter from './data/heavyfighter.js';
import hornet from './data/hornet.js';
import jumbo from './data/jumbo.js';
import kingair from './data/kingair.js';
import narrowbody from './data/narrowbody.js';
import regional from './data/regional.js';
import trainer from './data/trainer.js';
import turboprop72 from './data/turboprop72.js';
import widebody from './data/widebody.js';

// The 14-aircraft roster, ordered roughly by size and complexity for the hangar screen.
export const AIRCRAFT = [
  cessna172, caravan, trainer, kingair, turboprop72, citation, bizjet,
  regional, narrowbody, widebody, jumbo, fighter, hornet, heavyfighter,
];

export function getAircraft(id) {
  return AIRCRAFT.find((a) => a.id === id) ?? AIRCRAFT[0];
}
