// Tuning values that aren't about a particular car. Everything you might want to tweak
// while playtesting lives here or in the car's data (`vehicle/cars.ts`), so feel can be
// adjusted without hunting through the code.

export const TUNING = {
  /** Keyboard steering (`drivers/steeringAssist.ts`): digital keys → a steering position. */
  keyboardSteering: {
    /** How fast the position moves towards the keys' target (per second) and back to centre. */
    attack: 4,
    release: 7,
    /**
     * Speed-sensitive lock (assist on): full keys give the angle the front tyres can use,
     * the geometric angle for a turn at `limitG` plus `slipMargin` × their peak slip angle.
     */
    limitG: 1,
    slipMargin: 1.3,
    /**
     * Counter-steer help (assist on): with no key held, or a key held into the
     * counter-steer, the target steers `counterSteer` × the body slip angle beyond
     * `slipDeadband` (rad) against the slide, up to `counterSteerMax` of full lock.
     */
    counterSteer: 0.7,
    slipDeadband: 0.05,
    counterSteerMax: 0.5,
    /** Below this speed (m/s) there is no slide to catch. */
    counterSteerSpeed: 3,
  },
  transmission: {
    /** Below this speed (m/s) the car counts as stopped: the automatic's brake pedal can select reverse. */
    reverseBelow: 0.5,
    /** In manual, reverse can only be selected below this speed (m/s). */
    reverseShiftBelow: 2,
    /** A manual downshift is refused if it would take the engine past the limiter by more than this (rpm). */
    overRevMargin: 300,
    /** The automatic waits this long after a shift before the next (s). */
    shiftPause: 0.4,
    /** The automatic only shifts down if the lower gear lands this far below its upshift point (rpm). */
    downshiftMargin: 300,
    /** Throttle per rpm short of the target while blipping to match revs on a downshift. */
    revMatchGain: 0.004,
    /** The automatic clutch latches fully in once it slips less than this (rpm)... */
    latchSlipRpm: 100,
    /** ...with the gearbox input at least this far above idle (rpm), and lets go below `unlatchAboveIdle`. */
    latchAboveIdle: 250,
    unlatchAboveIdle: 100,
    /** Pulling away, the automatic clutch carries this much extra torque per rpm above its bite point, at full throttle (N·m/rpm). */
    biteGain: 0.3,
    /** At or above this pedal the automatic clutch is dumped on a launch instead of fed in (with TC off). */
    launchDumpPedal: 0.95,
    /** Pulling the handbrake past this lets the automatic clutch go. */
    handbrakeClutch: 0.5,
    /**
     * After a shift the clutch carries the engine's torque plus this (N·m) until the revs
     * match the new gear: enough to pull them into step in ~0.25 s without spinning the wheels.
     */
    shiftSyncTorque: 60,
  },
  drivetrain: {
    /** Gauss-Seidel passes over the clutch, differential and brake couplings per substep. */
    solverIterations: 10,
    /** Idle control: throttle per rpm below idle. */
    idleGain: 0.005,
    /** The limiter restores fuel this far below the limit (rpm). */
    limiterHysteresis: 150,
  },
  gamepad: {
    /** Stick travel ignored around the centre, then a response curve (1 = linear, more = finer near the centre). */
    steerDeadZone: 0.08,
    steerCurve: 1.6,
    /** Trigger travel ignored at rest. */
    triggerDeadZone: 0.04,
  },
  surfaces: {
    /** Grip relative to the tyre's own (multiplies its μ) and extra rolling drag (fraction of load). */
    asphalt: { grip: 1, drag: 0 },
    kerb: { grip: 1, drag: 0 },
    grass: { grip: 0.6, drag: 0.08 },
    // Loose stones: little grip and a great deal of drag, so a car sinks in and stops.
    gravel: { grip: 0.5, drag: 0.3 },
  },
  /** Tyre wear (`vehicle/wear.ts`): rates, and grip against wear. */
  wear: {
    /** Times the normal rate. */
    rates: { off: 0, normal: 1, high: 3 },
    /** Grip lost by the cliff (as a share), where the cliff is (wear), and grip lost per unit of wear beyond it. */
    drop: 0.08,
    cliff: 0.8,
    beyond: 1.6,
  },
  /** Pit lanes and stops (`track/pitLane.ts`, `race/pits.ts`). */
  pits: {
    /** Across, from the road edge (m): the pit wall's middle, the lane's inner edge, the lane's width (boxes on its outer side, `boxDepth` deep), and room to the barrier. */
    wall: 1.4,
    inner: 2.4,
    width: 9,
    boxDepth: 4.5,
    clearance: 3,
    /** The entry and exit tapers (m) and how far the run-off widening blends in beyond them (m). */
    taper: 120,
    blend: 30,
    /** Boxes, and their spacing along the lane (m). */
    boxes: 9,
    boxSpacing: 12,
    /** The lane's road sits this far above the run-off under it (m). */
    lift: 0.01,
    /** The speed limit (m/s, 60 km/h); the limiter cuts the throttle within `limiterBand` of it. Over by `tolerance` is a `penalty` (s). */
    limit: 60 / 3.6,
    limiterBand: 0.3,
    tolerance: 1,
    penalty: 5,
    /** The limit lines: this far into each taper (share of its length). */
    limitLine: 0.6,
    /** A car slower than this (m/s) within its box (`boxLength` m along) is serviced, for `service` s. */
    stopSpeed: 0.5,
    boxLength: 6,
    service: 4,
  },
  /** Fuel: the car's mass and centre of mass follow the fuel aboard once it changes by this much (kg). */
  fuel: { massStep: 0.25 },
  /** The weather (`track/weather.ts`, `track/puddles.ts`). */
  weather: {
    /** How wet each condition is (0–1): every wet effect scales with it. */
    wetness: { dry: 0, damp: 0.5, wet: 1 },
    /** Each surface's grip when fully wet, as a share of its dry grip: painted kerbs are slippery. */
    wetGrip: { asphalt: 0.72, kerb: 0.5, grass: 0.75, gravel: 0.9 },
    water: {
      /** Standing water's grip as a share of the wet road's, slowly, and its extra rolling drag (fraction of load). */
      grip: 0.85,
      drag: 0.04,
      /** Aquaplaning: from `from` to `to` (m/s) the grip falls to `grip` of its slow value. */
      aquaplane: { from: 20, to: 45, grip: 0.3 },
    },
    puddles: {
      /**
       * A puddle sits at the lowest point for `around` (m) either side, at least `minDepth` (m)
       * below the highest road within `reach` (m) either side.
       */
      around: 50,
      reach: 150,
      minDepth: 0.3,
      /** A flat road drains badly: along stretches flatter than `grade` for `run` (m), one puddle per `every` (m), `spacing` (m) apart at least. */
      flatRoad: { grade: 0.005, run: 200, every: 800, spacing: 120 },
      /** Not within this far of the start line (m), either way. */
      startClear: 150,
      /** Length along the road (m), width in from the edge (m). */
      length: [8, 18],
      width: [2.5, 4.5],
      /** Below this cross-slope the road counts as flat, and water may lie right across it (this often). */
      flat: 0.02,
      across: 0.3,
      /** Height above the road (m): the tread rays find the water first. */
      lift: 0.004,
    },
  },
  tyreIntegration: {
    /**
     * Wheel spin and slip are integrated this many times per physics step. A wheel's spin
     * against its tyre's grip rings at ~35 Hz, too fast for 120 Hz on its own.
     */
    substeps: 8,
    /**
     * Below `lowSpeedFade` (m/s) the tyre also damps its slip velocity, so the relaxed slip
     * (a spring at a standstill) doesn't ring. N·s/m per newton of load, at zero speed.
     */
    lowSpeedDamping: 1.5,
    lowSpeedFade: 3,
    /**
     * The relaxed slip ratio and tan(slip angle) are kept within ±this. Past it the tyre is
     * sliding anyway; the limit stops a stationary tyre storing a large deflection.
     */
    slipLimit: 1,
  },
  camera: {
    chase: {
      distance: 6.2,
      height: 2.1,
      lookAhead: 4,
      fov: 62,
      near: 0.3,
      /** Smoothing: fraction of the remaining gap closed per second (higher = stiffer). */
      follow: 6,
    },
    bumper: { fov: 75 },
    hood: { fov: 70 },
    /** Near clip plane for the cameras on the car (m), so the hood isn't cut off. */
    inCarNear: 0.05,
    /** Replay TV cameras: width of the shot at the car (m), field of view limits (degrees), aim above the car's origin (m), turn smoothing, near plane (m). */
    tv: { framing: 14, minFov: 4, maxFov: 50, aimHeight: 0.5, follow: 10, near: 0.5 },
  },
  /** Tyre and impact effects (`render/effects/`). */
  effects: {
    /** The weather on screen (`render/weatherView.ts`): sky, fog and sun from dry to wet, and the rain. */
    weather: {
      sky: { dry: 0x9cc6ee, wet: 0x8a939c },
      /** Fog from near to far (m). */
      fog: { dry: [250, 900], wet: [90, 520] },
      /** The sun's brightness when wet, as a share of the dry. */
      sun: 0.35,
      rain: {
        drops: 5000,
        /** The box round the camera (m), how fast the drops fall (m/s), streak length (m), wind (m/s, x and z). */
        radius: 40,
        height: 24,
        fall: 9,
        length: 0.7,
        wind: [1.2, 0.6],
        colour: 0xc9d3dc,
        opacity: 0.45,
      },
      /** The road and kerbs when wet: glossier and darker. */
      road: { roughness: 0.35, darken: 0.62 },
      puddle: { colour: 0x2b3238, roughness: 0.06, metalness: 0.5, opacity: 0.9 },
    },
    /** Spray thrown up behind wheels on a wet road: puffs like smoke's, by speed. */
    spray: {
      capacity: 900,
      rate: 28,
      minSpeed: 8,
      /** Speed (m/s) above `minSpeed` for full spray. */
      fullSpeed: 30,
      life: 0.55,
      size: [0.8, 3.2],
      rise: 0.9,
      opacity: 0.28,
      colour: 0xdfe4e8,
    },
    /** A tyre slides once its slip passes this multiple of its peak (angle or ratio). */
    slideFrom: 1.15,
    skid: {
      /** Quads kept (the oldest are overwritten), metres between them, lift off the road (m), darkness. */
      capacity: 4000,
      step: 0.3,
      /** Further than this between frames (m) and the mark breaks: the car jumped. */
      maxStep: 4,
      lift: 0.025,
      opacity: 0.6,
    },
    smoke: {
      colour: 0xd8d8d8,
      capacity: 700,
      /** Puffs per second per wheel at full slide, from this speed (m/s) up. */
      rate: 45,
      minSpeed: 4,
      /** Seconds a puff lasts, its size growing from `size[0]` to `size[1]` (m), rising (m/s), how thick. */
      life: 1.8,
      size: [0.7, 3.2],
      rise: 0.5,
      opacity: 0.45,
    },
    sparks: {
      capacity: 400,
      /** Sparks per N·s of impulse, at most `max` per knock; how long they fly (s) and how fast (m/s). */
      perImpulse: 0.04,
      max: 30,
      life: 0.5,
      speed: [3, 13],
    },
  },
  /** Contacts reported to the presentation (sparks, thumps): touches lighter than this force (N) are ignored. */
  contacts: { minForce: 3000 },
  /** Races (`race/race.ts`). */
  race: {
    /** Start lights: the first comes on after `first` (s), one more each `interval` (s), all out after a random wait. */
    lights: { count: 5, first: 1, interval: 1, wait: [0.2, 3] },
    /** After the leader finishes, cars still running are classified where they are after this long (s). */
    classifyAfter: 90,
    /** A championship round's chance of being wet, and of being damp. */
    seasonWeather: { wet: 0.25, damp: 0.25 },
  },
  /** Car setup (`vehicle/setup.ts`): clicks either way from the car's own numbers, and what one click changes. */
  setup: {
    clicks: 5,
    /** Spring rate, anti-roll bar and damping per click (fractions of the car's own). */
    spring: 0.06,
    antiRoll: 0.1,
    dampers: 0.08,
    /** Spring rest length per click (m). */
    rideHeight: 0.01,
    /** Downforce per click (a fraction of the car's own), and drag area added per m² of downforce area. */
    wing: 0.15,
    wingDrag: 0.3,
    /** Front brake share per click, within these limits. */
    brakeBias: { step: 0.02, min: 0.45, max: 0.8 },
    /** Differential preload (fraction) and ramp (absolute) per click. */
    diff: { preload: 0.2, ramp: 0.04 },
    /** Final drive per click (fraction): up is shorter. */
    gearing: 0.05,
  },
  /** Online races (`online/session.ts`). */
  online: {
    /**
     * Clock sync: `pings` answered before the guest is ready, one every `pingInterval` (s);
     * then one every `pingAfter` (s) for as long as the race lasts, refining the estimate.
     */
    pings: 12,
    pingInterval: 0.1,
    pingAfter: 0.25,
    /** A car's state goes out every this many physics steps (4 at 120 Hz: 30 a second). */
    stateEvery: 4,
    /** Behind the clock by more than this (s, a hidden tab), the rest is skipped rather than caught up. */
    catchUp: 0.25,
    /** Distance between the checkpoints the gap is timed at (m). */
    checkpoint: 20,
    /**
     * The other car's newest state older than this (s, a hidden tab, a stall) and it becomes a
     * ghost, so it can't jump into your car when its states resume; solid again once fresh and
     * at least `clearance` (m) from your car.
     */
    stale: 0.5,
    clearance: 6,
  },
  /** AI drivers (`ai/`). */
  ai: {
    envelope: {
      /**
       * Share of the tyres' peak grip at the static load that the whole car really reaches
       * (load transfer, combined slip, slip angles off the peak): calibrated against the
       * measured ~0.98 g on the skidpad and ~1 g stopping with ABS.
       */
      lateral: 0.9,
      braking: 0.9,
      /**
       * Braking while cornering gives up this share of the friction circle's braking per unit
       * of cornering load (as a fraction of the grip): trail braking unloads the rear, and this
       * car oversteers if it brakes hard while cornering hard.
       */
      trailBraking: 0.6,
      /**
       * Accelerating: only the driven (rear) tyres push, so only their share of the grip left
       * over from cornering is there for it: the rear axle's static share, plus this much for
       * the load that moves onto it under acceleration.
       */
      tractionTransfer: 0.08,
      /** Share of the engine's ideal acceleration the car really gets: gearshifts cut the drive, and the automatic shifts late. Measured on the long oval. */
      power: 0.88,
    },
    line: {
      /** Room kept from the edge of the usable road (m), and how much of a kerb the line may use. */
      margin: 0.3,
      kerbUse: 0.5,
      /**
       * Coarse-to-fine: the line is solved on every n-th sample for each stride in turn (the
       * coarsest kept to at least 12 points), each level until no offset moves more than
       * `tolerance` (m) in a sweep, or `maxSweeps`.
       */
      strides: [256, 128, 64, 32, 16, 8, 4, 2, 1],
      tolerance: 1e-3,
      maxSweeps: 20000,
      /** Curvature is measured over ±this many samples, so 2 m steps don't make it noisy. */
      curvatureSpan: 3,
    },
    /** Top of the speed profile on a straight (m/s), past the car's real top speed. */
    maxSpeed: 90,
    /** Through standing water the AI holds at most this (m/s), however straight the road: it lifts. */
    waterSpeed: 38,
    /**
     * Difficulty (`ai/skill.ts`): the range each skill is spread over across a field. pace:
     * share of the car's grip used; braking: extra metres before each braking point;
     * precision: how far it wanders off the line (m, standard deviation); mistakes: chance of
     * a mistake at each corner; aggression: 0–1, how small a gap it goes for.
     */
    difficulty: {
      easy: { pace: [0.8, 0.87], braking: [8, 16], precision: [0.4, 0.8], mistakes: [0.03, 0.06], aggression: [0.2, 0.5] },
      medium: { pace: [0.87, 0.93], braking: [3, 8], precision: [0.25, 0.5], mistakes: [0.015, 0.03], aggression: [0.4, 0.7] },
      hard: { pace: [0.94, 0.98], braking: [0, 3], precision: [0.1, 0.25], mistakes: [0.004, 0.012], aggression: [0.6, 0.9] },
    },
    /** Mistakes: what can go wrong at a corner, and how wandering off the line is paced. */
    mistakes: {
      /** A corner counts where the profile drops by this much (m/s) within `lookahead` (m). */
      cornerDrop: 5,
      lookahead: 60,
      /** Overcooking it: target speed raised by this factor for this many metres. */
      overcook: { factor: [1.06, 1.12], length: 80 },
      /** Running wide: aiming this far to the outside (m) for this many metres. */
      wide: { offset: [1, 2], length: 70 },
      /** The line wanders back and forth with this time constant (s). */
      wanderTime: 2.5,
    },
    /** Racing in traffic (`ai/traffic.ts`). */
    traffic: {
      /** Space kept between cars side by side (m), and how far past a car it stays out of its way (m, bumper to bumper). */
      clearance: 1,
      clearBehind: 5,
      /** Overlapping a car slightly ahead of it, it concedes and drops this much (m/s) slower than that car. */
      concede: 1.5,
      /** Slower than this (m/s), a car counts as out of the race for now: driven round, not followed. */
      racingSpeed: 4,
      /** Further than this from its line (m), a car joins it from where it is, at `sideRate`. */
      offLine: 3,
      /** How far ahead it looks for cars: this many seconds at its speed, at least `minLook` (m). */
      lookTime: 2.5,
      minLook: 25,
      /** It acts on a car ahead in its path when it would reach it within this time (s). */
      reactTime: 3,
      /** Following: this gap in time (s) plus `followGap` (m) bumper to bumper, and how hard it closes up (1/s). */
      followTime: 0.5,
      followGap: 3,
      followGain: 0.8,
      /** Room it wants beyond the bare clearance to go for a gap (m), at aggression 0 (none at 1). */
      boldness: 1.5,
      /** How fast it moves across the road for traffic (m/s). */
      sideRate: 2,
      /** On the first lap: aggression and following gap scaled by these. */
      firstLap: { aggression: 0.5, followTime: 1.5 },
    },
    /** The AI driver (`ai/driver.ts`). */
    driver: {
      /**
       * Steering: the line's curvature is read this many seconds ahead (the rack takes time to
       * turn); heading error gain; cross-track gain (1/s), its softening (m/s) at low speed and
       * the most it may steer (rad): little when slow, so a car far off the line (on the grid)
       * joins it gently, more by `speed` (m/s), and all of it when more than `far` (m) off the line;
       * yaw-rate damping (s): steer less into a turn when the car is rotating faster than the line.
       */
      feedForward: 0.12,
      headingGain: 1,
      crossTrackGain: 4,
      crossTrackSoftening: 6,
      crossTrackMax: { slow: 0.12, fast: 0.35, speed: 20, far: 6 },
      yawDamping: 0.08,
      /** Speed control: how far ahead it reads the profile (s), and how hard it corrects an error in speed (1/s). */
      speedLead: 0.25,
      speedGain: 2,
      /**
       * Off the line (traffic, a mistake), corners tighten: it looks this far ahead (m, more at
       * speed) and plans to brake for them at this share of its braking grip.
       */
      offLineLook: 60,
      offLineBraking: 0.8,
      /** Throttle held when the target is just met (cruising), as a fraction of full. */
      cruiseThrottle: 0.15,
      /** Sliding: body slip angle (rad) past which it comes off the brakes and holds this much throttle while the steering catches the car. */
      slideAngle: 0.13,
      slideThrottle: 0.25,
      /**
       * Stuck: slower than this (m/s) for this long (s), or more than `offRoad` (m) beyond the
       * road's edge for `offRoadTime` (s), and it asks to be put back on the track.
       */
      stuck: { speed: 1.5, time: 5, offRoad: 3, offRoadTime: 8 },
    },
  },
};
