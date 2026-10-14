// Checklists. Each item either checks itself from the aircraft state (`auto`) or waits for a click.
// Lists are chosen by aircraft kind and suggested by flight phase; failures bring their own
// emergency list.

const flapsSet = (c, stage) => c.m.controls.flapsStage === stage;
const kind = (spec) => {
  if (spec.class === 'Fighter') return 'fighter';
  if (spec.engines.spec.type === 'piston') return 'piston';
  if (spec.engines.spec.type === 'turboprop') return 'turboprop';
  return 'jet';
};

const item = (text, auto = null) => ({ text, auto });

export function checklistsFor(spec) {
  const k = kind(spec);
  const twin = spec.engines.positions.length > 1;
  const retract = spec.gear.retractable;
  const prop = k === 'piston' || k === 'turboprop';
  const lists = [];
  lists.push({
    id: 'preflight', title: 'Before start', phases: ['parked'],
    items: [
      item('Parking brake set', (c) => c.t.parkingBrake),
      item('Flight controls free and correct'),
      item('Fuel quantity checked', (c) => c.t.fuel > 0),
      item(k === 'piston' ? 'Mixture rich, propeller high' : 'Engine instruments green', k === 'piston' ? (c) => c.t.mixture > 0.9 && c.t.prop > 0.9 : null),
      item('Flaps set for departure', (c) => c.m.controls.flapsStage <= 1),
      item('Lights on', (c) => c.m.controls.lights),
      item('Radio set, clearance obtained', (c) => c.atc?.clr?.ifr || !c.systems.atc),
    ],
  });
  lists.push({
    id: 'taxi', title: 'Taxi', phases: ['taxi'],
    items: [
      item('Parking brake released', (c) => !c.t.parkingBrake),
      item('Brakes checked'),
      item('Flight instruments checked'),
      item('Taxi clearance followed', (c) => c.atc?.clr?.taxi || !c.systems.atc),
    ],
  });
  lists.push({
    id: 'before_takeoff', title: 'Before takeoff', phases: ['hold', 'lineup'],
    items: [
      item('Flaps set for takeoff', (c) => flapsSet(c, spec.flaps.takeoffStage ?? 0)),
      item('Trim set'),
      item(prop ? 'Propeller high, mixture rich' : 'Speedbrake in', prop ? (c) => c.t.prop > 0.9 && c.t.mixture > 0.7 : (c) => c.t.speedbrake < 0.1),
      item('Takeoff clearance received', (c) => c.atc?.clr?.takeoff || !c.systems.atc),
      item('Landing gear down' + (retract ? ' (retractable)' : ' (fixed)'), (c) => c.t.gearLever !== false),
      item('Heading and runway aligned', (c) => c.t.onGround),
    ],
  });
  lists.push({
    id: 'after_takeoff', title: 'After takeoff / climb', phases: ['rolling', 'departure'],
    items: [
      item('Positive rate: gear up', retract ? (c) => !c.m.controls.gearDown : (c) => c.t.vsFpm > 100),
      item('Flaps retracted', (c) => c.m.controls.flapsStage === 0),
      item('Climb power set'),
      item('Departure frequency contacted', (c) => !c.systems.atc || c.atc?.station?.role === 'departure' || c.atc?.station?.role === 'center'),
    ],
  });
  lists.push({
    id: 'cruise', title: 'Cruise', phases: ['enroute'],
    items: [
      item('Cruise power set'),
      item('Fuel balance checked'),
      item('Engine instruments normal', (c) => c.t.failures.every((f) => !f.id.startsWith('eng') && !f.id.startsWith('fire'))),
      item('Weather and fuel for destination reviewed'),
    ],
  });
  lists.push({
    id: 'descent', title: 'Descent / approach', phases: ['approach'],
    items: [
      item('Approach briefing complete'),
      item('Approach clearance received', (c) => c.atc?.clr?.approach || !c.systems.atc),
      item('Altimeter and instruments set'),
      item('Speed reduced below flap limit', (c) => c.t.iasTrue < spec.speeds.vfe),
      item('Landing lights on', (c) => c.m.controls.lights),
    ],
  });
  lists.push({
    id: 'landing', title: 'Landing', phases: ['final', 'landing'],
    items: [
      item('Landing gear down', (c) => !retract || c.m.controls.gearDown),
      item('Flaps set for landing', (c) => flapsSet(c, spec.flaps.landingStage)),
      item(prop ? 'Propeller high, mixture rich' : 'Speedbrake in', prop ? (c) => c.t.prop > 0.9 : (c) => c.t.speedbrake < 0.1),
      item('Landing clearance received', (c) => c.atc?.clr?.land || !c.systems.atc),
      item(`Approach speed about ${spec.speeds.vapp} kt`, (c) => Math.abs(c.t.iasTrue - spec.speeds.vapp) < 12),
    ],
  });
  lists.push({
    id: 'after_landing', title: 'After landing', phases: ['rollout', 'taxi_in'],
    items: [
      item('Flaps retracted', (c) => c.m.controls.flapsStage === 0),
      item('Speedbrake in', (c) => c.t.speedbrake < 0.1),
      item('Lights as required'),
      item('Taxi to parking as instructed'),
    ],
  });
  lists.push({
    id: 'parking', title: 'Parking / shutdown', phases: [],
    items: [
      item('Parking brake set', (c) => c.t.parkingBrake),
      item('Throttle idle', (c) => Math.max(...c.t.throttle) < 0.05),
      item(twin ? 'Engines shut down' : 'Engine shut down', (c) => c.m.engines.every((e) => e.failed)),
      item('Lights off', (c) => !c.m.controls.lights),
    ],
  });
  return lists;
}

/** Emergency checklists keyed by failure type. Items check themselves when they can. */
export function emergencyList(type, spec) {
  const engineFailed = (c) => c.m.engines.some((e) => e.failed);
  switch (type) {
    case 'engine_fire':
      return {
        id: 'e_fire', title: 'ENGINE FIRE', items: [
          item('Throttle of the burning engine: idle', (c) => c.m.engines.some((e, i) => c.m.sys.fire[i] && c.t.throttle[i] < 0.05) || !c.m.sys.fire.some(Boolean)),
          item('Engine shutdown (N)', (c) => engineFailed(c)),
          item('Fire bottle discharged (Z)', (c) => !c.m.sys.fire.some(Boolean)),
          item('Land as soon as possible', (c) => c.t.onGround),
        ],
      };
    case 'engine_failure':
      return {
        id: 'e_engine', title: 'ENGINE FAILURE', items: [
          item('Maintain control: rudder and bank toward the live engine'),
          item('Throttle on the failed engine idle'),
          item('Engine secured (N) or restart (T)', (c) => engineFailed(c)),
          item('Fuel and fire check', (c) => !c.m.sys.fire.some(Boolean)),
          item('Land at the nearest suitable airport'),
        ],
      };
    case 'hydraulic':
      return { id: 'e_hyd', title: 'HYDRAULIC LOSS', items: [item('Expect heavy controls and no flap or gear movement'), item('Gear: emergency extension (Y)', (c) => !spec.gear.retractable || c.t.gear > 0.98), item('Long, flat approach; brakes are weak'), item('Land at the nearest suitable airport')] };
    case 'electrical':
      return { id: 'e_elec', title: 'ELECTRICAL FAILURE', items: [item('Start the APU (U) for power', (c) => c.m.sys.apuRunning), item('Use standby instruments'), item('Reduce electrical load: lights as needed'), item('Land at the nearest suitable airport')] };
    case 'flaps':
      return { id: 'e_flaps', title: 'FLAP JAM', items: [item('Note the stuck flap angle'), item('Increase approach speed by 10 kt'), item('Plan a long final'), item('Land at the nearest suitable airport')] };
    case 'gear':
      return { id: 'e_gear', title: 'GEAR WILL NOT MOVE', items: [item('Emergency extension (Y)', (c) => c.t.gear > 0.98 || c.m.sys.gearEmergency), item('Wait for three green: gear down and locked', (c) => c.t.gear > 0.98), item('Land on the longest runway')] };
    case 'pitot':
      return { id: 'e_pitot', title: 'AIRSPEED UNRELIABLE', items: [item('Pitot heat on (I)', (c) => c.m.sys.pitot.heat), item('Hold attitude and power: do not chase the airspeed'), item('Cross-check groundspeed and pitch'), item('Wait for the indication to clear', (c) => !c.m.sys.pitot.iced)] };
    case 'jam':
      return { id: 'e_jam', title: 'CONTROL JAM', items: [item('Identify the jammed control'), item('Use trim, rudder and thrust to fly'), item('Large turns only; plan a wide approach'), item('Land at the nearest suitable airport')] };
    case 'fuel_leak':
      return { id: 'e_leak', title: 'FUEL LEAK', items: [item('Check the fuel quantity trend'), item('Crossfeed open (if equipped)', (c) => c.m.crossfeed || !c.m.tanks.length), item('Divert to the nearest airport'), item('Reduce power for best range')] };
    case 'radio':
      return { id: 'e_radio', title: 'RADIO FAILURE', items: [item('Squawk 7600 (radio menu)'), item('Continue to the planned airport'), item('Land and watch for light signals')] };
    default: return null;
  }
}

/** Suggest the list that matches the flight phase. */
export function listForPhase(lists, phase) {
  return lists.find((l) => l.phases.includes(phase)) ?? lists[0];
}
