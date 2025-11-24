// Location: apps/web/src/lib/export-errors.ts

/**
 * Reasons why an export cannot be completed.
 * Each reason maps to a specific timeline configuration that is unsupported.
 */
export type UnsupportedReason =
  | "image-elements"
  | "overlapping-videos"
  | "blob-urls"
  | "no-video-elements";

/**
 * Error messages and suggestions for each unsupported case.
 */
export const UNSUPPORTED_ERRORS: Record<
  UnsupportedReason,
  { message: string; suggestion: string }
> = {
  "image-elements": {
    message: "Image elements are not currently supported in export.",
    suggestion:
      "Remove image elements from your timeline, or convert them to video clips using an external tool.",
  },
  "overlapping-videos": {
    message: "Overlapping videos are not currently supported in export.",
    suggestion:
      "Arrange your videos sequentially without overlaps, or trim clips so they don't overlap in time.",
  },
  "blob-urls": {
    message: "Some media files could not be accessed for export.",
    suggestion:
      "Re-import the media files from your local disk. Temporary or generated files may need to be saved first.",
  },
  "no-video-elements": {
    message: "No video elements found in timeline.",
    suggestion:
      "Add at least one video clip to your timeline before exporting.",
  },
};

/**
 * Custom error class for unsupported export configurations.
 * Provides user-friendly messages and actionable suggestions.
 */
export class ExportUnsupportedError extends Error {
  readonly reason: UnsupportedReason;
  readonly userMessage: string;
  readonly suggestion: string;

  constructor(reason: UnsupportedReason) {
    const errorInfo = UNSUPPORTED_ERRORS[reason];
    super(errorInfo.message);
    this.name = "ExportUnsupportedError";
    this.reason = reason;
    this.userMessage = errorInfo.message;
    this.suggestion = errorInfo.suggestion;
  }
}
