// macOS CGVirtualDisplay helper for E2E tests.
//
// Creates a virtual display (macOS 14+ Sonoma) so Electron can render
// to a non-physical monitor without stealing user focus.
//
// The process stays alive (blocking on stdin) to keep the virtual display
// active. When the parent process closes stdin or kills this process,
// the CGVirtualDisplay is deallocated automatically.

import CoreGraphics
import Foundation

if #available(macOS 14.0, *) {
    let descriptor = CGVirtualDisplayDescriptor()
    descriptor.setWidth(1920)
    descriptor.setHeight(1080)
    descriptor.setPixelsPerInch(144)

    guard let display = CGVirtualDisplay(descriptor: descriptor) else {
        print("FALLBACK")
        exit(0)
    }

    let displayID = display.displayID
    print("DISPLAY_ID=\(displayID)")

    // Flush to ensure the parent process reads the output immediately
    fflush(stdout)

    // Block until stdin closes (parent controls lifetime)
    FileHandle.standardInput.readDataToEndOfFile()

    // CGVirtualDisplay is deallocated when this process exits
} else {
    print("FALLBACK")
    exit(0)
}
