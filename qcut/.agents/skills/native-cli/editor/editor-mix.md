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
| `editor mix export` | — | `--project-id` | The whole mix: master, buses, every audio track |
| `editor mix bus-list` | — | `--project-id` | Master and buses with the tracks feeding each |
| `editor mix bus-create` | `--name` | `--bus-id`, `--gain-db`, `--pan`, `--effects` | Create a bus |
| `editor mix bus-set` | `--bus-id` | `--name`, `--gain-db`, `--pan`, `--mute`/`--no-mute`, `--solo`/`--no-solo`, `--effects` | Change a bus |
| `editor mix bus-remove` | `--bus-id` | — | Remove a bus; its tracks go back to the master |
| `editor mix master-set` | — | `--gain-db`, `--pan`, `--mute`/`--no-mute`, `--effects` | Change the master |
| `editor mix loudness` | — | `--project-id` | Render the mix as an export would and measure it |

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

## Loudness

`editor mix loudness` renders the whole mix the way an export does and
reports, per ITU-R BS.1770-4 / EBU R 128: `integratedLufs` (gated),
`maxShortTermLufs` (3 s), `maxMomentaryLufs` (400 ms), `truePeakDbtp` (4x
oversampled) and `samplePeakDb`. Online platforms usually ask for about -14
LUFS integrated with true peak at or below -1 dBTP. The mixer panel's master
strip shows the same numbers.

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

# Check the delivery loudness
qcut editor mix loudness --project-id $P --json
```
