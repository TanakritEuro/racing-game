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
    /** The AI driver (`ai/driver.ts`). */
    driver: {
      /**
       * Steering: the line's curvature is read this many seconds ahead (the rack takes time to
       * turn); heading error gain; cross-track gain (1/s), its softening (m/s) at low speed and
       * the most it may steer (rad): little when slow, so a car far off the line (on the grid)
       * joins it gently, more by `speed` (m/s);
       * yaw-rate damping (s): steer less into a turn when the car is rotating faster than the line.
       */
      feedForward: 0.12,
      headingGain: 1,
      crossTrackGain: 4,
      crossTrackSoftening: 6,
      crossTrackMax: { slow: 0.12, fast: 0.35, speed: 20 },
      yawDamping: 0.08,
      /** Speed control: how far ahead it reads the profile (s), and how hard it corrects an error in speed (1/s). */
      speedLead: 0.25,
      speedGain: 2,
      /** Throttle held when the target is just met (cruising), as a fraction of full. */
      cruiseThrottle: 0.15,
      /** Sliding: body slip angle (rad) past which it comes off the brakes and holds this much throttle while the steering catches the car. */
      slideAngle: 0.13,
      slideThrottle: 0.25,
      /** Stuck: slower than this (m/s) for this long (s) and it asks to be put back on the track. */
      stuck: { speed: 1.5, time: 5 },
    },
  },
};
