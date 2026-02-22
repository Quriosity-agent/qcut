/**
 * MediaPreviewModal — full-size image/video preview overlay.
 * Click on image/video thumbnails in ShotDetail to open.
 */

import { useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { DownloadIcon, XIcon } from "lucide-react";

interface MediaPreviewModalProps {
	url: string;
	type: "image" | "video";
	title: string;
	onClose: () => void;
}

export function MediaPreviewModal({
	url,
	type,
	title,
	onClose,
}: MediaPreviewModalProps) {
	const overlayRef = useRef<HTMLDivElement>(null);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
				return;
			}
			if (e.key === "Tab" && overlayRef.current) {
				const focusable = overlayRef.current.querySelectorAll<HTMLElement>(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
				);
				if (focusable.length === 0) return;
				const first = focusable[0];
				const last = focusable[focusable.length - 1];
				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		},
		[onClose]
	);

	useEffect(() => {
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);

	useEffect(() => {
		const focusable = overlayRef.current?.querySelectorAll<HTMLElement>(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		if (focusable && focusable.length > 0) focusable[0].focus();
	}, []);

	const handleDownload = async () => {
		const ext = type === "image" ? "png" : "mp4";
		const filename = `${title.replace(/\s+/g, "-").toLowerCase()}.${ext}`;
		const link = document.createElement("a");
		link.href = url;
		link.download = filename;
		link.click();
	};

	return (
		<div
			ref={overlayRef}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			role="dialog"
			aria-label={`Preview: ${title}`}
			aria-modal="true"
		>
			<div className="relative max-w-[90vw] max-h-[90vh]">
				{/* Header controls */}
				<div className="absolute -top-10 right-0 flex items-center gap-1.5">
					<Button
						variant="outline"
						size="sm"
						className="h-7 text-xs bg-background/80"
						onClick={handleDownload}
						aria-label={`Download ${type}`}
					>
						<DownloadIcon className="mr-1 h-3 w-3" />
						Download
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-7 w-7 p-0 bg-background/80"
						onClick={onClose}
						aria-label="Close preview"
					>
						<XIcon className="h-3.5 w-3.5" />
					</Button>
				</div>

				{/* Media content */}
				{type === "image" ? (
					<img
						src={url}
						alt={title}
						className="max-w-[90vw] max-h-[85vh] rounded-lg object-contain"
					/>
				) : (
					<video
						src={url}
						controls
						autoPlay
						className="max-w-[90vw] max-h-[85vh] rounded-lg"
						aria-label={title}
					/>
				)}
			</div>
		</div>
	);
}
