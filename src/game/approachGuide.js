// Approach geometry for the HUD: finds the runway the aircraft is lined up for (or the one ATC
// assigned) and reports localiser/glidepath deviation, distance and a landing score preview.

const DEG = Math.PI / 180;
const NM = 1852;
const FT = 3.28084;
const dirOf = (h) => ({ x: Math.sin(h * DEG), z: -Math.cos(h * DEG) });

function localTo(end, x, z) {
  const d = dirOf(end.heading);
  const dx = x - end.threshold.x;
  const dz = z - end.threshold.z;
  return { along: dx * d.x + dz * d.z, lateral: dx * -d.z + dz * d.x };
}

const gradeFor = (fpm) => (fpm < 150 ? 'Smooth' : fpm < 300 ? 'Good' : fpm < 500 ? 'Firm' : 'Hard');

/**
 * @param model FlightModel
 * @param airports map airports
 * @param assigned { airport, endId } from ATC when an approach is assigned
 */
export function computeApproach(model, airports, assigned = null, telemetry = model.telemetry) {
  const t = telemetry;
  const x = model.pos.x;
  const z = model.pos.z;
  let best = null;
  const consider = (airport, rw, end, forced) => {
    const loc = localTo(end, x, z);
    if (loc.along > 400) return; // beyond the threshold
    const dist = Math.max(1, -loc.along);
    if (!forced && dist > 22000) return;
    if (!forced && Math.abs(loc.lateral) > 0.3 * dist + 400) return;
    const diff = Math.abs(((t.heading - end.heading + 540) % 360) - 180);
    if (!forced && diff > 70) return;
    const score = dist + diff * 40;
    if (!best || score < best.score) best = { airport, rw, end, loc, dist, diff, score };
  };
  if (assigned?.airport) {
    const ap = assigned.airport;
    for (const rw of ap.runways) for (const end of rw.ends) if (end.id === assigned.endId) consider(ap, rw, end, true);
  }
  if (!best) {
    for (const ap of airports) {
      if (Math.hypot(ap.x - x, ap.z - z) > 30000) continue;
      for (const rw of ap.runways) for (const end of rw.ends) consider(ap, rw, end, false);
    }
  }
  if (!best) return null;
  const { airport, rw, end, loc, dist } = best;
  const aglThr = (model.pos.y - airport.elevation) ;
  const gsAngle = Math.atan2(aglThr - 12, dist) / DEG; // angle of the aircraft above the threshold aiming point
  const locDeg = Math.atan2(-loc.lateral, dist) / DEG; // + = course is to the right
  const vref = model.spec.speeds.vapp;
  const sink = Math.max(0, -t.vsFpm);
  // Landing score preview from what the aircraft is doing right now.
  const targetSink = Math.max(150, t.groundSpeed * 0.514444 * Math.tan(3 * DEG) / 0.00508 * 0.4);
  const expected = t.aglFt < 150 ? sink : Math.min(sink, targetSink + 60);
  let score = 100;
  score -= Math.min(40, Math.max(0, expected - 150) * 0.09);
  score -= Math.min(20, Math.abs(t.ias - vref) * 0.8);
  score -= Math.min(25, Math.abs(loc.lateral) / Math.max(dist, 200) * 600);
  if (t.gear < 0.98 && model.spec.gear.retractable && dist < 5000) score -= 20;
  score = Math.max(0, Math.round(score));
  return {
    airport, runway: rw, end, distM: dist, distNm: dist / NM, along: loc.along, lateral: loc.lateral, locDeg, gsAngle,
    gsDots: (gsAngle - 3) / 0.35, locDots: locDeg / 0.5, hasIls: !!end.ils, headingDiff: best.diff,
    aglFt: t.aglFt, ias: t.ias, vref, sinkFpm: sink, speedDev: t.ias - vref,
    centerlineOffset: Math.abs(loc.lateral), predictedGrade: gradeFor(expected), score,
    heightFt: aglThr * FT,
  };
}
