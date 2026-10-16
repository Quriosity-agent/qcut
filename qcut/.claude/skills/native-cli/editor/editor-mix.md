# QCut Editor CLI — Mixer: track levels, buses, master, ducking

Every audio or media track has a mixer strip: level (`gainDb`), pan, the bus
it feeds, solo, mute, ducking, and effects (EQ, compressor, limiter). Buses
group tracks (dialogue, music, SFX, ambience) under one strip, and every bus
feeds the master. Exports (both engines) render exactly what the editor
plays.

These commands need a running QCut editor with the project open.
`--project-id` defaults to the active project.

## Commands

| Command | Required | Key options | What it does |
| --- | --- | --- | --- |
| `editor track audio-get` | `--track-id` | `--project-id` | Show one track's mixer settings |
| `editor track audio-set` | `--track-id` | `--gain-db`, `--pan`, `--bus`, `--ducking`, `--effects` | Change them; answers with the settings read back |
| `editor track mute` | `--track-id` | `--off` | Mute a track (`--off` unmutes) |
| `editor track solo` | `--track-id` | `--off` | Solo a track (`--off` unsolos) |
| `editor track audio-automation` | `--track-id --param` | `--points`, `--clear` | Set or remove a track's level or pan curve |
| `editor mix export` | — | `--project-id` | The whole mix: master, buses, every audio track |
| `editor mix bus-list` | — | `--project-id` | Master and buses with the tracks feeding each |
| `editor mix bus-create` | `--name` | `--bus-id`, `--gain-db`, `--pan`, `--effects` | Create a bus |
| `editor mix bus-set` | `--bus-id` | `--name`, `--gain-db`, `--pan`, `--mute`/`--no-mute`, `--solo`/`--no-solo`, `--effects` | Change a bus |
| `editor mix bus-remove` | `--bus-id` | — | Remove a bus; its tracks go back to the master |
| `editor mix master-set` | — | `--gain-db`, `--pan`, `--mute`/`--no-mute`, `--effects` | Change the master |
| `editor mix loudness` | — | `--timeout`, `--poll-interval`, `--no-wait` | Render the mix as an export would and measure it (a job; waits for the result by default) |
| `editor mix stems` | `--output-dir` | `--timeout`, `--poll-interval`, `--no-wait` | Write one WAV per bus into a folder (a job; waits by default) |
| `editor mix job-status` | `--job-id` | `--project-id` | Progress and result of a loudness or stems job |
| `editor mix bus-automation` | `--bus-id --param` | `--points`, `--clear` | Set or remove a bus's (or the master's) level or pan curve |

Ranges: `--gain-db` -60 to 12, `--pan` -1 (left) to 1 (right). A value
outside a range is refused with the reason; nothing is quietly clamped.
Every change answers with what the editor now holds.

## Rules

- A track feeds its bus (`--bus <id>`, or `master` for none). A bus feeds
  the master.
- Solo: once any track is soloed, only soloed tracks are heard. Once any bus
  is soloed, only tracks on soloed buses are heard.
- `mix export` shows each track's `effective` result: whether it is
  `silenced` and the bus it actually feeds.
- Ducking: while any of `sourceTrackIds` is louder than `thresholdDb`, the
  track drops by `reductionDb`, gliding down over `attackMs` and back over
  `releaseMs`.
- `--ducking` and `--effects` take JSON or `@file.json`, and only the fields
  given change. EQ bands change by `id` (the defaults are `low`, `body`,
  `presence`, `air`), or by position.
- `timeline export` includes each audio track's `audio` settings and
  `muted`, and the project's `audioMix` (master and buses).

## Automation

Level and pan can follow a curve over timeline time instead of a fixed
value, on a track, a bus or the master. A curve is a list of `{time, value}`
points: seconds on the timeline, and dB for level or -1..1 for pan. Between
points the value moves in a straight line (in dB for level); before the
first point and after the last it holds. While a curve has points it
replaces the fader, and the mixer panel shows that fader greyed out at the
curve's current value. Curves belong to the track or bus, not to a clip, so
cutting or replacing clips leaves them alone. The preview and every export
engine follow them.

- `--param gainDb|pan` picks the curve; `--points` replaces it whole (JSON
  or `@file`); `--clear` removes it.
- `timeline export` and `mix export` include each strip's `automation`.

```bash
# Dip the music 6 dB over 0.3 s at 12 s, bring it back over a second at 20 s
qcut editor track audio-automation --project-id $P --track-id <music> --param gainDb \
  --points '[{"time":12,"value":0},{"time":12.3,"value":-6},{"time":20,"value":-6},{"time":21,"value":0}]' --json
# Fade the whole mix out over the last four seconds
qcut editor mix bus-automation --project-id $P --bus-id master --param gainDb \
  --points '[{"time":88,"value":0},{"time":92,"value":-60}]' --json
qcut editor track audio-automation --project-id $P --track-id <music> --param gainDb --clear --json
```

## Rendering jobs: loudness and stems

`mix loudness` and `mix stems` render the whole programme, which takes
minutes on a long timeline. Both start a job in the editor and answer with a
`jobId`; by default the command then polls the job and prints the result
when it completes. `--timeout <seconds>` (default 1800) is how long it waits
before giving up on *waiting*; the editor keeps rendering, and the message
names the job: "Waited N s; the render is still running in QCut (jobId=…)".
Follow a job later, or from another terminal, with:

```bash
qcut editor mix job-status --project-id $P --job-id mix_loudness_… --json
```

`--no-wait` prints the `jobId` straight away; `--poll-interval` (seconds,
default 3) sets how often the command checks. A job's status is `running`,
`completed` (with `result.loudness` or `result.stems`) or `failed` (with the
reason). The editor keeps the last 50 jobs per session.

A command that fails to reach the editor says so ("Cannot connect to QCut
at …"); a connection the editor closed mid-request says that instead, and
never claims the app is gone.

## Loudness

`editor mix loudness` renders the whole mix the way an export does and
reports, per ITU-R BS.1770-4 / EBU R 128: `integratedLufs` (gated),
`maxShortTermLufs` (3 s), `maxMomentaryLufs` (400 ms), `truePeakDbtp` (4x
oversampled) and `samplePeakDb`. Online platforms usually ask for about -14
LUFS integrated with true peak at or below -1 dBTP. The mixer panel's master
strip shows the same numbers.

## Stems

Stems are the mix split by bus for delivery and remixing: one WAV per bus
that something is heard on, named after the bus, plus `direct.wav` for the
tracks that feed the master directly. Each is as long as the programme and
lines up with it sample for sample. They leave each bus after its fader and
effects but before the master, so the master's level and limiter are not in
them; the stems summed through the master give the mix. Because nothing
limits them, a loud bus can pass full scale, so stems are written as 48 kHz
32-bit float WAV, which keeps those samples instead of clipping them;
convert to 16- or 24-bit after your own limiting if a tool needs it.

- `qcut editor mix stems --output-dir <folder>` writes them into a folder
  (created if needed).
- `qcut editor export start ... --output <file> --stems` waits for the export
  and writes them beside it as `<file name>-<bus>.wav`.
- In the export dialog, "Export stems per bus (WAV)" does the same as
  `--stems`.

## Example: dialogue, SFX and music buses

```bash
P=<project-id>
qcut editor mix bus-create --project-id $P --name "Dialogue" --bus-id dialogue --json
qcut editor mix bus-create --project-id $P --name "Hard SFX" --bus-id sfx --json
qcut editor mix bus-create --project-id $P --name "Transitions" --bus-id transitions --gain-db -3 --json
qcut editor mix bus-create --project-id $P --name "Music" --bus-id music --gain-db -6 --json

qcut editor track audio-set --project-id $P --track-id <main-track> --bus dialogue --json
qcut editor track audio-set --project-id $P --track-id <guns-1> --bus sfx --json
qcut editor track audio-set --project-id $P --track-id <whoosh-1> --bus transitions --json

# The music ducks 6 dB whenever the guns or hits sound
qcut editor track audio-set --project-id $P --track-id <music> --bus music \
  --ducking '{"enabled":true,"sourceTrackIds":["<guns-1>","<hit-1>"],"reductionDb":-6}' --json

# Gentle bus compression and a master limiter
qcut editor mix bus-set --project-id $P --bus-id sfx \
  --effects '{"compressor":{"enabled":true,"thresholdDb":-18,"ratio":3}}' --json
qcut editor mix master-set --project-id $P --gain-db -1 \
  --effects '{"limiter":{"enabled":true,"ceilingDb":-1}}' --json

# Check what is heard
qcut editor track solo --project-id $P --track-id <guns-1> --json
qcut editor mix export --project-id $P --json
qcut editor track solo --project-id $P --track-id <guns-1> --off --json

# Check the delivery loudness (waits for the render), then export with stems
qcut editor mix loudness --project-id $P --json
qcut editor mix stems --project-id $P --output-dir ~/Desktop/doors-stems --no-wait --json   # prints the jobId
qcut editor mix job-status --project-id $P --job-id <jobId> --json
qcut editor export start --project-id $P --output ~/Desktop/doors.mp4 --stems --json
```
