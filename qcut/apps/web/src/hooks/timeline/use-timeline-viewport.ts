import { useEffect, useState, type RefObject } from "react";

export function useTimelineViewport({
	scrollContainerRef,
}: {
	scrollContainerRef: RefObject<HTMLDivElement | null>;
}) {
	const [viewport, setViewport] = useState({ scrollLeft: 0, width: 0 });
	useEffect(() => {
		const container = scrollContainerRef.current;
		if (!container) return;
		let frame: number | null = null;
		const measure = () => {
			frame = null;
			const scrollLeft = container.scrollLeft;
			const width = container.clientWidth;
			setViewport((previous) =>
				previous.scrollLeft === scrollLeft && previous.width === width
					? previous
					: { scrollLeft, width }
			);
		};
		const scheduleMeasure = () => {
			if (frame === null) frame = requestAnimationFrame(measure);
		};
		measure();
		container.addEventListener("scroll", scheduleMeasure, { passive: true });
		const observer = new ResizeObserver(scheduleMeasure);
		observer.observe(container);
		return () => {
			if (frame !== null) cancelAnimationFrame(frame);
			container.removeEventListener("scroll", scheduleMeasure);
			observer.disconnect();
		};
	}, [scrollContainerRef]);
	return viewport;
}
