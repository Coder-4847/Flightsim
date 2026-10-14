// Radio phraseology helpers: spoken numbers, callsigns, headings, altitudes, runways and the
// table of controller replies. Text is always shown; the Web Speech API reads it aloud when enabled.

const DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const NATO = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliet',
  K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango',
  U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
};

/** "250" -> "two five zero" */
export function digits(value, pad = 0) {
  return String(value).padStart(pad, '0').split('').map((c) => (c in NATO ? NATO[c] : DIGIT[Number(c)] ?? c)).join(' ');
}

export const heading = (deg) => digits(String(Math.round(((deg % 360) + 360) % 360) || 360).padStart(3, '0'));

/** "7 5 0 0 ft" -> "seven thousand five hundred" */
export function altitudeWords(ft) {
  const rounded = Math.round(ft / 100) * 100;
  if (rounded >= 18000) return `flight level ${digits(Math.round(rounded / 100), 3)}`;
  const thousands = Math.floor(rounded / 1000);
  const hundreds = Math.round((rounded % 1000) / 100);
  const parts = [];
  if (thousands) parts.push(`${digits(thousands)} thousand`);
  if (hundreds) parts.push(`${digits(hundreds)} hundred`);
  return parts.join(' ') || 'zero';
}

/** Short on-screen form of an altitude: "7,500" or "FL250". */
export const altitudeShort = (ft) => (ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${Math.round(ft / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ','));

/** "25L" -> "two five left" */
export function runwayWords(id) {
  const m = /^(\d+)([LRC])?$/.exec(id);
  if (!m) return id;
  const side = { L: 'left', R: 'right', C: 'centre' }[m[2]];
  return `${digits(m[1])}${side ? ` ${side}` : ''}`;
}

/** Registration to a spoken callsign: N172FS -> "November one seven two Foxtrot Sierra". */
export function callsignWords(reg) {
  return reg.replace(/[^A-Za-z0-9]/g, '').split('').map((c) => (/\d/.test(c) ? DIGIT[Number(c)] : NATO[c.toUpperCase()] ?? c)).join(' ');
}

/** Abbreviated callsign after first contact: N172FS -> "Five six..." keep the last three characters. */
export function shortCallsign(reg) {
  const clean = reg.replace(/[^A-Za-z0-9]/g, '');
  return `${clean[0] === 'N' ? 'November ' : ''}${callsignWords(clean.slice(-3))}`.trim();
}

export function frequencyWords(mhz) {
  const [whole, frac] = mhz.toFixed(2).split('.');
  return `${digits(whole)} decimal ${digits(frac)}`;
}

export const formatFreq = (mhz) => mhz.toFixed(2);

export function windWords(dirDeg, speedKt) {
  if (speedKt < 2) return 'wind calm';
  return `wind ${heading(dirDeg)} at ${digits(Math.round(speedKt))}`;
}

export function clock(bearingRelative) {
  const hour = Math.round((((bearingRelative % 360) + 360) % 360) / 30) || 12;
  return `${hour} o'clock`;
}

export const squawkWords = (code) => digits(code);

/** Compass word for a heading in eighths, e.g. 45 -> "northeast". */
export const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export const compassWord = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
