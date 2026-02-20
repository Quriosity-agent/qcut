"use client";

import { useEffect, useState, type RefObject } from "react";
import type { PreviewDimensions } from "./types";

interface UsePreviewSizingParams {
	containerRef: RefObject<HTMLDivElement | null>;
	canvasSize: { width: number; height: number };
	isExpanded: boolean;
}

/** Computes preview dimensions that fit within the container while preserving the canvas aspect ratio. */
export function usePreviewSizing({
	containerRef,
	canvasSize,
	isExpanded,
}: UsePreviewSizingParams): PreviewDimensions {
	const [previewDimensions, setPreviewDimensions] = useState<PreviewDimensions>(
		{
			width: 0,
			height: 0,
		}
	);

	useEffect(() => {
		const updatePreviewSize = () => {
			try {
				const containerElement = containerRef.current;
				if (!containerElement) {
					return;
				}

				let availableWidth = 0;
				let availableHeight = 0;

				if (isExpanded) {
					const controlsHeight = 80;
					const marginSpace = 24;
					availableWidth = window.innerWidth - marginSpace;
					availableHeight = window.innerHeight - controlsHeight - marginSpace;
				}

				if (!isExpanded) {
					const containerRect = containerElement.getBoundingClientRect();
					const computedStyle = getComputedStyle(containerElement);
					const paddingTop = Number.parseFloat(computedStyle.paddingTop);
					const paddingBottom = Number.parseFloat(computedStyle.paddingBottom);
					const paddingLeft = Number.parseFloat(computedStyle.paddingLeft);
					const paddingRight = Number.parseFloat(computedStyle.paddingRight);
					const gap = Number.parseFloat(computedStyle.gap) || 16;
					const toolbar = containerElement.querySelector("[data-toolbar]");
					const toolbarHeight = toolbar
						? toolbar.getBoundingClientRect().height
						: 0;

					availableWidth = containerRect.width - paddingLeft - paddingRight;
					availableHeight =
						containerRect.height -
						paddingTop -
						paddingBottom -
						toolbarHeight -
						(toolbarHeight > 0 ? gap : 0);
				}

				if (
					availableWidth <= 0 ||
					availableHeight <= 0 ||
					canvasSize.width <= 0 ||
					canvasSize.height <= 0
				) {
					return;
				}

				const targetRatio = canvasSize.width / canvasSize.height;
				const containerRatio = availableWidth / availableHeight;

				let width = 0;
				let height = 0;

				if (containerRatio > targetRatio) {
					height = availableHeight * (isExpanded ? 0.95 : 1);
					width = height * targetRatio;
				} else {
					width = availableWidth * (isExpanded ? 0.95 : 1);
					height = width / targetRatio;
				}

				setPreviewDimensions({ width, height });
			} catch {
				// keep last good dimensions if transient layout reads fail
			}
		};

		const resizeObserver = new ResizeObserver(() => {
			updatePreviewSize();
		});

		updatePreviewSize();

		if (!containerRef.current) {
			const retryTimeout = window.setTimeout(() => {
				updatePreviewSize();
				// Attach observers after retry if ref is now available
				if (containerRef.current) {
					resizeObserver.observe(containerRef.current);
				}
			}, 100);

			if (isExpanded) {
				window.addEventListener("resize", updatePreviewSize);
			}

			return () => {
				window.clearTimeout(retryTimeout);
				resizeObserver.disconnect();
				if (isExpanded) {
					window.removeEventListener("resize", updatePreviewSize);
				}
			};
		}

		resizeObserver.observe(containerRef.current);

		if (isExpanded) {
			window.addEventListener("resize", updatePreviewSize);
		}

		return () => {
			resizeObserver.disconnect();
			if (isExpanded) {
				window.removeEventListener("resize", updatePreviewSize);
			}
		};
	}, [containerRef, canvasSize.width, canvasSize.height, isExpanded]);

	return previewDimensions;
}
