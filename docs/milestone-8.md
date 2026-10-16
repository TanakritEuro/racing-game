# Milestone 8 plan: two-player online racing

## Status: done

Closed without playtest answers; the questions (connecting, the lights together, the other
car's smoothness, side-by-side contact, both screens agreeing, the AI racing the guest) stay
open for a session on two machines.

Approved as proposed, AI opponents included (commit 6): each player simulates their own car,
each picks their own car, matchmaking through the public PeerJS server.

Measured over the loopback (50 ± 20 ms each way, the clocks 3.7 s apart): the lights go out
within 2 ms of each other; the other car is shown within 11 cm of where it really is, the
host's AI on the guest's screen within 7 cm (median) and 11 cm (99th percentile); both sides
agree on every car's time and place. Over the real PeerJS server (two instances in one tab of
the in-app browser): connecting, the handshake, the clock sync (6 ms round trip), the shared
lights, positions and names on both screens. That pane only drew about two frames a second,
so how it feels in real time is for your playtest on two machines.

Where the build differs from the plan below:

- **States are float64**, not float32: the time on the shared clock needs the precision.
- **More in some messages:** `lights` also carries the wait after the fifth light (both
  screens draw the same countdown); `state` and `finish` carry a car number (the host's AI);
  `welcome` carries the number of AI opponents. `PROTOCOL` is 2.
- **The clock keeps syncing.** Twelve pings before the guest is ready, then one every
  0.25 s for the rest of the race, refining the estimate. Twelve alone left the lights up to
  10 ms apart on a jittery line.
- **Both simulations step in time with the host's clock**, their steps falling at the same
  moments and one exactly on the lights going out. A tab more than 0.25 s behind (hidden)
  skips ahead rather than catching up.
- **A stale remote car becomes a ghost.** No states for 0.5 s (a hidden tab, a stall) and the
  proxy stops being solid, so it can't jump into your car when its states resume. It turns
  solid again once fresh and 6 m clear of your car. A remote car that moves more than 4 m
  at once (put back on the track, a rematch) is shown there at once instead of sliding.
- **A lost link is the link's to notice** (its heartbeats, 6 s), not the race's: a player
  whose tab is hidden sends no states but is still there. The loopback now notices a cut
  line the same way.
- **The players start mid-grid**, the host ahead of the guest, with the AI around them.
- **Room codes are letters and digits** (five-a-side's alphabet), so the menu's code field
  takes both.
- **Fixed in passing:** a race restarted with Backspace counted laps from before the
  restart (`Race.restart` now resets them); `?autopilot` drives online too (for checking).
- **Not tested directly:** the AI's traffic avoiding the guest's car. Traffic sees it (it is
  one of the cars traffic tracks), but no test sets up the encounter.

Goal: race a friend on another computer. One player hosts (picks the circuit and laps, gets a
four-letter room code), the other joins with the code; both see each other's car on track,
start from the same lights, and get the same result. No backend of our own: matchmaking uses
the public PeerJS server, as in penalty-shootout and five-a-side, and the cars talk directly
browser to browser.

## Scope decisions

- **Each player simulates their own car.** Football could run on the host with the guest
  sending inputs; a racing car can't, because your own car must answer the controls at once
  and a round trip (50–150 ms) of lag at 200 km/h feels broken. So each browser runs the full
  vehicle model for its own car only, and sends that car's state (pose, wheels, speed, RPM,
  throttle, lap and distance) 30 times a second.
- **The other car is a proxy:** a kinematic body in your simulation, moved each step to where
  the other car is now, estimated from its last states (dead reckoning on its velocity, eased
  back onto each new state so corrections don't jump). It drives nothing itself, but you can
  hit it and it pushes you, so contact works both ways, each side feeling the other's push.
  It is drawn with the same car model, wheels turning, and sounds through an engine voice.
- **One clock.** The two browsers estimate their clock offset from timed pings (the usual
  NTP-style round trip, the best of several). The host schedules the lights to go out at a
  moment on that shared clock, so both start together within a few milliseconds.
- **Each side times its own laps** (the same `LapTimer`, track limits and all) and reports
  laps and finishing time. Positions during the race come from both cars' laps and distance;
  the result comes from the two finishing times, so both screens agree on the winner.
- **The host picks the circuit and laps; each player picks their own car** (Wren, Kestrel or
  Harrier), so a mismatched pair can still race. (Same car for both is a question below.)
- **After the flag:** rematch (same circuit, same room, back to the grid, no reload) or leave.
  If either side leaves or the link goes quiet for 6 s, the other is told and can go back to
  the menu.
- **No pausing online:** Esc opens the menu over the race, but the race goes on.
- **AI opponents online** come last (commit 6) and only if you want them: the host would run
  them and send their states, the guest would see them as proxies.

## Files

Simulation:

| File | Contents |
| --- | --- |
| `src/sim.ts`, `src/physics.ts` | Proxy cars: kinematic chassis bodies (tagged as cars, so contacts and AI traffic see them), moved each step to a given pose |
| `src/online/remoteCar.ts` | A remote car's state stream → its pose at any moment: a buffer of timed states, dead reckoning past the newest, eased corrections. Pure |
| `src/online/clock.ts` | Clock offset from ping round trips (best of the lowest-latency samples). Pure |
| `src/online/state.ts` | A car's state packed into a `Float32Array` and back |

Presentation:

| File | Contents |
| --- | --- |
| `src/online/link.ts` | Ported from five-a-side: PeerJS rooms with four-letter codes, a reliable channel and an unordered one, heartbeats |
| `src/online/loopback.ts` | Ported: two linked ends in one process, with a delay and jitter added, for tests |
| `src/online/protocol.ts` | The messages (hello, welcome, ready, ping and pong, lights, state, lap, finish, rematch, bye), every one checked on arrival; `PROTOCOL` version |
| `src/online/session.ts` | `OnlineRace`: the handshake, clock sync, lights, sending your state and moving the proxy, positions, results, rematch, leaving |
| `src/ui/menu.ts` | *Online*: Host (circuit, laps, your car → the room code, waiting) or Join (the code, your car) |
| `src/main.ts` | `?online=host` and `?online=join&code=ABCD` build the race once the other side is known; the race HUD and results for two |

## Key data structures

```ts
/** A car's state on the wire, 30 times a second. */
interface CarState {
  time: number;       // sender's race clock (s), on the shared clock
  pose: CarPose;      // position, rotation, wheels (suspension, steer, spin)
  velocity: Vec3;     // m/s, for dead reckoning
  angular: Vec3;      // rad/s
  speed: number; rpm: number; throttle: number;
  laps: number;       // completed
  distance: number;   // round the current lap (m)
}

type Message =
  | { type: 'hello'; version: number; car: string }
  | { type: 'welcome'; track: string; laps: number; car: string }
  | { type: 'ready' }
  | { type: 'ping'; t: number } | { type: 'pong'; t: number; at: number }
  | { type: 'lights'; outAt: number }          // shared-clock time the lights go out
  | { type: 'state'; data: ArrayBuffer }       // packed CarState, unordered channel
  | { type: 'finish'; time: number; best: number | null }
  | { type: 'rematch' } | { type: 'bye'; reason: string };
```

## Tests

| File | Asserts |
| --- | --- |
| `clock.test.ts` | Over a loopback with 40 ms ± 15 ms delay and a 3.7 s clock difference, the estimated offset is right within 5 ms |
| `remoteCar.test.ts` | A recorded drive sent at 30 Hz over 60 ms ± 20 ms: the proxy stays within 0.5 m of the real car at speed, never jumps more than 10 cm a step, and holds still at a standstill |
| `proxy.test.ts` | Driving into a proxy pushes your car and gives a car contact; the AI's traffic avoids a proxy like any car |
| `online.test.ts` | Two simulations over a loopback, each with an AI driving its own car: lights out within 10 ms of each other, a whole 1-lap race, both sides agree on the result; a link that goes quiet ends the session on both sides |
| `protocol.test.ts` | Every message type round-trips; malformed or wrong-version messages are refused |

The real thing (PeerJS between two browsers) is checked with two tabs of the in-app browser,
and then by you on two computers.

## Commits, in order

1. Plan (this file).
2. Link, loopback and protocol ported and extended; clock sync. Tests.
3. Proxy cars in the simulation; remote car states, dead reckoning and smoothing. Tests.
4. The online race: handshake, lights on the shared clock, states both ways, positions,
   results, rematch, leaving. Tests over the loopback.
5. Online in the menus (host and join), the race HUD and results for two, the other car's
   sound; checked with two browser tabs.
6. AI opponents online, run by the host (if you want them).
7. Docs, then playtest questions.

## Risks

- **Networks that block peer-to-peer.** PeerJS uses public STUN servers; behind some strict
  NATs (some offices, mobile hotspots) browsers can't connect without a TURN relay, which
  costs money to run. The game says so plainly instead of hanging.
- **Contact feels different on each screen.** Each player is pushed by where the other car
  *seems* to be. At typical latencies that's within a few tens of centimetres; side-by-side
  rubbing may feel a little spongy.
- **Testing:** the loopback tests cover the logic with simulated latency and jitter; real
  networks need your playtest on two machines.

## Questions for you

1. Each player simulating their own car, with the other as a proxy you can bump: all right?
2. Each player picks their own car (Wren, Kestrel or Harrier), or both forced to the same?
3. AI opponents in online races (commit 6, the host runs them), or just the two of you?
4. Matchmaking through the public PeerJS server with four-letter room codes, as in your other
   games: all right?
