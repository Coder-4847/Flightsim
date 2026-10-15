import { buildJet } from './jetBuild.js';

// Zenith CJ: Citation CJ-class light jet (rear fuselage-mounted turbofans, T-tail). Geometry: jetBuild.js / jetConfigs.js.
export const buildCitation = (spec, mats, detail) => buildJet(spec, mats, detail, 'citation');
