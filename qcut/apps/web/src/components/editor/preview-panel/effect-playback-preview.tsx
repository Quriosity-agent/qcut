import { useEffect, useRef, useState } from "react";
import type {
	CanvasPlaybackPreparationMetrics,
	CanvasPlaybackSession,
} from "@/hooks/preview/use-canvas-playback-preview";
import { createCanvasPlaybackReader } from "@/lib/preview/canvas-composition-playback-reader";
import { usePlaybackStore } from "@/stores/editor/playback-store";

export function EffectPlaybackCanvas({
	session,
}: {
	session: CanvasPlaybackSession;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [message, setMessage] = useState<string | null>("正在读取效果预览…");
	useEffect(() => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext("2d", { alpha: false });
		if (!canvas || !context) return;
		const { width, height, fps } = session.plan;
		canvas.width = width;
		canvas.height = height;
		const reader = createCanvasPlaybackReader({
			cache: session.cache,
			width,
			height,
			frames: session.frames,
		});
		let target = 0;
		let presented = -1;
		let resumeAfterBuffer = false;
		let changingPlayback = false;
		let disposed = false;
		const withPlaybackChange = ({ change }: { change: () => void }) => {
			changingPlayback = true;
			try {
				change();
			} finally {
				changingPlayback = false;
			}
		};
		const publish = () => {
			if (disposed) return;
			const stats = reader.stats;
			canvas.dataset.bufferedFrames = String(stats.frames);
			canvas.dataset.bufferedBytes = String(stats.bytes);
			canvas.dataset.bufferBudgetFrames = String(stats.maxFrames);
			canvas.dataset.bufferBudgetBytes = String(stats.maxBytes);
			if (reader.error) {
				resumeAfterBuffer = false;
				usePlaybackStore.getState().pause();
				setMessage(`效果预览读取失败：${reader.error.message}，请重新准备`);
				return;
			}
			const bitmap = reader.get({ frame: target });
			if (!bitmap) return;
			if (presented !== target) {
				context.drawImage(bitmap, 0, 0);
				presented = target;
				canvas.dataset.frame = String(target);
				canvas.dataset.timeSeconds = String(target / fps);
				canvas.dispatchEvent(
					new CustomEvent("qcut-effect-playback-frame", {
						bubbles: true,
						detail: { frame: target, generation: session.generation },
					})
				);
			}
			const warmEnd = Math.min(
				session.frames - 1,
				target + Math.min(stats.maxFrames, 4) - 1
			);
			const hasReadyLookahead = Array.from(
				{ length: warmEnd - target + 1 },
				(_, offset) => reader.get({ frame: target + offset })
			).every(Boolean);
			if (resumeAfterBuffer && !hasReadyLookahead) return;
			setMessage(null);
			if (resumeAfterBuffer) {
				resumeAfterBuffer = false;
				withPlaybackChange({
					change: () => {
						usePlaybackStore.getState().seek(target / fps);
						usePlaybackStore.getState().play();
					},
				});
			}
		};
		const request = ({ time }: { time: number }) => {
			if (!Number.isFinite(time) || disposed) return;
			target = Math.max(
				0,
				Math.min(session.frames - 1, Math.round(time * fps))
			);
			reader.setTarget({ frame: target });
			if (!reader.get({ frame: target })) {
				setMessage("正在缓冲效果预览…");
				if (usePlaybackStore.getState().isPlaying) {
					resumeAfterBuffer = true;
					withPlaybackChange({
						change: () => {
							usePlaybackStore.getState().pause();
							usePlaybackStore.getState().seek(target / fps);
						},
					});
				}
			}
			publish();
		};
		const onTime = (event: Event) => {
			if (changingPlayback) return;
			const detail = (event as CustomEvent<{ time: number; scrub?: boolean }>)
				.detail;
			if (event.type === "playback-seek") resumeAfterBuffer = false;
			request({ time: detail.time });
		};
		const onPlay = () =>
			request({ time: usePlaybackStore.getState().currentTime });
		const onPause = () => {
			if (!changingPlayback) resumeAfterBuffer = false;
		};
		const unsubscribeReader = reader.subscribe({ onChange: publish });
		const unsubscribePlayback = usePlaybackStore.subscribe(
			(state, previous) => {
				if (changingPlayback) return;
				if (previous.isPlaying && !state.isPlaying) resumeAfterBuffer = false;
				if (
					state.isPlaying !== previous.isPlaying ||
					state.currentTime !== previous.currentTime
				)
					request({ time: state.currentTime });
			}
		);
		window.addEventListener("playback-update", onTime);
		window.addEventListener("playback-seek", onTime);
		window.addEventListener("playback-play", onPlay);
		window.addEventListener("playback-pause", onPause);
		onPlay();
		return () => {
			disposed = true;
			reader.dispose();
			unsubscribeReader();
			unsubscribePlayback();
			window.removeEventListener("playback-update", onTime);
			window.removeEventListener("playback-seek", onTime);
			window.removeEventListener("playback-play", onPlay);
			window.removeEventListener("playback-pause", onPause);
			canvas.width = 0;
			canvas.height = 0;
		};
	}, [session]);
	return (
		<>
			<canvas
				ref={canvasRef}
				className="pointer-events-none absolute inset-0 z-40 size-full"
				data-testid="effect-playback-canvas"
				data-generation={session.generation}
			/>
			{message ? (
				<div
					role="status"
					className="pointer-events-none absolute left-2 top-2 z-50 rounded bg-black/75 px-2 py-1 text-xs text-white"
					data-testid="effect-playback-buffering"
				>
					{message}
				</div>
			) : null}
		</>
	);
}

export function EffectPlaybackControls({
	status,
	completed,
	total,
	generation,
	sessionId,
	error,
	warning,
	metrics,
	onPrepare,
	onCancel,
}: {
	status: "idle" | "preparing" | "ready" | "error";
	completed: number;
	total: number;
	generation: string;
	sessionId?: string;
	error?: string;
	warning?: string;
	metrics?: CanvasPlaybackPreparationMetrics;
	onPrepare: () => void;
	onCancel: () => void;
}) {
	const preparing = status === "preparing";
	return (
		<div
			className="flex flex-wrap items-center justify-center gap-2 px-2 py-1 text-xs text-muted-foreground"
			data-testid="effect-playback-status"
			data-status={status}
			data-completed={completed}
			data-total={total}
			data-generation={generation}
			data-session-id={sessionId}
			data-render-ms={metrics?.renderMs}
			data-encode-ms={metrics?.encodeMs}
			data-write-ms={metrics?.writeMs}
			data-wall-ms={metrics?.wallMs}
			data-preparation-inflight={metrics?.maxInFlightFrames}
			data-preparation-rgba-bytes={metrics?.maxReservedPixelBytes}
			data-preparation-png-bytes={metrics?.maxPendingPngBytes}
		>
			<span role="status">
				{preparing
					? `正在准备效果预览 ${completed}/${total}`
					: status === "ready"
						? "效果预览已就绪，可连续播放"
						: (error ?? "准备后可连续播放美颜美体效果")}
			</span>
			{warning ? (
				<span role="status" title={warning}>
					部分预览缓存暂时无法自动清理，可能额外占用磁盘空间。
				</span>
			) : null}
			<button
				type="button"
				className="rounded border px-2 py-1 text-foreground disabled:opacity-50"
				data-testid="prepare-effect-playback"
				disabled={preparing}
				onClick={onPrepare}
				onKeyDown={(event) => {
					if (event.key === "Escape") onCancel();
				}}
			>
				{status === "ready" ? "重新准备" : "准备效果预览"}
			</button>
			{preparing || status === "ready" ? (
				<button
					type="button"
					className="rounded border px-2 py-1 text-foreground"
					data-testid="cancel-effect-playback"
					onClick={onCancel}
					onKeyDown={(event) => {
						if (event.key === "Escape") onCancel();
					}}
				>
					{preparing ? "取消" : "关闭效果预览"}
				</button>
			) : null}
		</div>
	);
}
