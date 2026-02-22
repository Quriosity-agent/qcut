/**
 * MediaPreviewModal — full-size image/video preview overlay.
 * Click on image/video thumbnails in ShotDetail to open.
 */

import { useEffect, useCallback } from "react";
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
	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		},
		[onClose]
	);

	useEffect(() => {
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);

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
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={() => {}}
			role="dialog"
			aria-label={`Preview: ${title}`}
		>
			<div className="relative max-w-[90vw] max-h-[90vh]">
				{/* Header controls */}
				<div className="absolute -top-10 right-0 flex items-center gap-1.5">
					<Button
						variant="outline"
						size="sm"
						className="h-7 text-xs bg-background/80"
						onClick={handleDownload}
					>
						<DownloadIcon className="mr-1 h-3 w-3" />
						Download
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-7 w-7 p-0 bg-background/80"
						onClick={onClose}
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
