import type { CommandDef, FlagDef } from "./command-registry-types.js";

/**
 * Mixer commands: each audio track's level, pan, bus, mute, solo, ducking
 * and effects, and the project's buses and master.
 */
export function createAudioMixEditorCommands({
	f,
	ed,
	projectId,
}: {
	f: (
		name: string,
		type: FlagDef["type"],
		desc: string,
		opts?: Partial<FlagDef>
	) => FlagDef;
	ed: (
		name: string,
		description: string,
		flags: FlagDef[],
		examples?: string[]
	) => CommandDef;
	/** --project-id, defaulting to the active project. */
	projectId: FlagDef;
}): Record<string, CommandDef> {
	const trackId = f("--track-id", "string", "Audio or media track ID", {
		required: true,
	});
	const gainDb = (subject: string) =>
		f("--gain-db", "number", `${subject} level in dB, -60 to 12`);
	const pan = (subject: string) =>
		f("--pan", "number", `${subject} pan, -1 (left) to 1 (right)`);
	const effects = (subject: string) =>
		f(
			"--effects",
			"string",
			`${subject} EQ, compressor and limiter as JSON or @file; only the fields given change`
		);
	const mute = f("--mute", "boolean", "Mute (--no-mute to unmute)");
	const off = f("--off", "boolean", "Turn it off instead of on");
	const param = f("--param", "string", "Which curve: gainDb or pan", {
		required: true,
	});
	const points = f(
		"--points",
		"string",
		'The curve as JSON or @file: [{"time":12,"value":0},{"time":12.3,"value":-6}] (time in seconds on the timeline)'
	);
	const clear = f("--clear", "boolean", "Remove the curve instead");

	return {
		"editor:track:audio-automation": ed(
			"editor:track:audio-automation",
			"Set a track's level (dB) or pan curve over timeline time; it replaces the fixed value while it has points",
			[projectId, trackId, param, points, clear],
			[
				'qcut editor track audio-automation --project-id <id> --track-id <track> --param gainDb --points \'[{"time":12,"value":0},{"time":12.3,"value":-6}]\' --json',
				"qcut editor track audio-automation --project-id <id> --track-id <track> --param pan --clear --json",
			]
		),
		"editor:track:audio-get": ed(
			"editor:track:audio-get",
			"Show a track's mixer settings: level, pan, bus, solo, mute, ducking, effects",
			[projectId, trackId],
			[
				"qcut editor track audio-get --project-id <id> --track-id <track> --json",
			]
		),
		"editor:track:audio-set": ed(
			"editor:track:audio-set",
			"Change a track's level, pan, bus, ducking or effects; answers with the settings read back",
			[
				projectId,
				trackId,
				gainDb("Track"),
				pan("Track"),
				f("--bus", "string", "Bus the track feeds (master for none)"),
				f(
					"--ducking",
					"string",
					'Ducking as JSON or @file, e.g. {"enabled":true,"sourceTrackIds":["<track>"],"reductionDb":-6}'
				),
				effects("Track"),
			],
			[
				"qcut editor track audio-set --project-id <id> --track-id <track> --gain-db -6 --bus sfx --json",
				'qcut editor track audio-set --project-id <id> --track-id <ambience> --ducking \'{"enabled":true,"sourceTrackIds":["<guns>"],"reductionDb":-6}\' --json',
			]
		),
		"editor:track:mute": ed(
			"editor:track:mute",
			"Mute a track (--off to unmute)",
			[projectId, trackId, off],
			["qcut editor track mute --project-id <id> --track-id <track> --json"]
		),
		"editor:track:solo": ed(
			"editor:track:solo",
			"Solo a track: only soloed tracks are heard (--off to unsolo)",
			[projectId, trackId, off],
			["qcut editor track solo --project-id <id> --track-id <track> --json"]
		),
		"editor:mix:export": ed(
			"editor:mix:export",
			"Show the whole mix: master, buses, and every audio track's settings and what is heard",
			[projectId],
			["qcut editor mix export --project-id <id> --json"]
		),
		"editor:mix:bus-list": ed(
			"editor:mix:bus-list",
			"List the master and buses with the tracks feeding each",
			[projectId],
			["qcut editor mix bus-list --project-id <id> --json"]
		),
		"editor:mix:bus-create": ed(
			"editor:mix:bus-create",
			"Create a bus that tracks can feed",
			[
				projectId,
				f("--name", "string", "Bus name", { required: true }),
				f(
					"--bus-id",
					"string",
					"Bus id (letters, digits, - and _; made from the name by default)"
				),
				gainDb("Bus"),
				pan("Bus"),
				effects("Bus"),
			],
			[
				'qcut editor mix bus-create --project-id <id> --name "SFX" --bus-id sfx --json',
			]
		),
		"editor:mix:bus-set": ed(
			"editor:mix:bus-set",
			"Change a bus's name, level, pan, mute, solo or effects",
			[
				projectId,
				f("--bus-id", "string", "Bus ID", { required: true }),
				f("--name", "string", "New bus name"),
				gainDb("Bus"),
				pan("Bus"),
				mute,
				f("--solo", "boolean", "Solo (--no-solo to unsolo)"),
				effects("Bus"),
			],
			[
				"qcut editor mix bus-set --project-id <id> --bus-id sfx --gain-db -3 --json",
			]
		),
		"editor:mix:bus-remove": ed(
			"editor:mix:bus-remove",
			"Remove a bus; its tracks go back to the master",
			[projectId, f("--bus-id", "string", "Bus ID", { required: true })]
		),
		"editor:mix:loudness": ed(
			"editor:mix:loudness",
			"Render the mix as an export would and measure integrated LUFS, loudest short-term and momentary LUFS, and true peak",
			[projectId],
			["qcut editor mix loudness --project-id <id> --json"]
		),
		"editor:mix:bus-automation": ed(
			"editor:mix:bus-automation",
			"Set a bus's (or the master's) level or pan curve over timeline time",
			[
				projectId,
				f("--bus-id", "string", "Bus ID, or master", { required: true }),
				param,
				points,
				clear,
			],
			[
				'qcut editor mix bus-automation --project-id <id> --bus-id music --param gainDb --points \'[{"time":0,"value":-6},{"time":4,"value":0}]\' --json',
			]
		),
		"editor:mix:stems": ed(
			"editor:mix:stems",
			"Write one WAV per bus (and one for tracks feeding the master directly), each as long as the programme",
			[
				projectId,
				f("--output-dir", "string", "Folder for the stems", { required: true }),
			],
			["qcut editor mix stems --project-id <id> --output-dir ./stems --json"]
		),
		"editor:mix:master-set": ed(
			"editor:mix:master-set",
			"Change the master's level, pan, mute or effects",
			[projectId, gainDb("Master"), pan("Master"), mute, effects("Master")],
			["qcut editor mix master-set --project-id <id> --gain-db -1 --json"]
		),
	};
}
