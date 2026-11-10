/**
 * A source's sound as the preview plays it: in stereo, with a one-channel
 * file at full level in both channels.
 *
 * In the preview and the in-browser export, the first node of a clip's graph
 * that works in stereo (Chromium's DynamicsCompressorNode) copies a mono
 * signal into both channels, and every stage after it, the panners
 * included, gets a stereo signal. FFmpeg's own conversion to stereo keeps
 * the power instead of the level: each channel gets the mono signal at
 * 1/√2. Left to it, a mono clip came out of every FFmpeg export 3 dB
 * quieter than it plays, and met every threshold after it (a compressor, a
 * gate, ducking, the limiter) 3 dB lower than in the preview.
 *
 * The lift is applied ahead of that conversion and to one-channel streams
 * only, so the two cancel. Two channels pass as they are; wider layouts are
 * mixed down by FFmpeg as before.
 *
 * @module electron/ffmpeg/stereo-source
 */

/** Raises a one-channel stream by √2 and leaves any other as it is. */
const MONO_LIFT = "volume='if(eq(nb_channels,1),sqrt(2),1)'";

/**
 * The filters that make a source stereo the way the preview does. They go
 * first in a source's chain: everything after them, in FFmpeg as in the
 * preview, then works on two channels.
 */
export const STEREO_SOURCE_FILTERS: readonly string[] = [
	MONO_LIFT,
	// Its own filter, not a format constraint: the conversion then sits
	// after the lift whatever order FFmpeg settles the graph's formats in.
	"aresample=ochl=stereo",
];

/** `STEREO_SOURCE_FILTERS` as one chain. */
export const STEREO_SOURCE_CHAIN = STEREO_SOURCE_FILTERS.join(",");
