import CoreGraphics
import CoreVideo
import Foundation
import ImageIO
import Vision

struct MaskRequest: Decodable {
    let image: String
    let output: String
}

struct MaskFailure: Error, CustomStringConvertible {
    let description: String
}

func run() throws {
    guard CommandLine.arguments.count == 2 else {
        throw MaskFailure(description: "request.json argument required")
    }
    let requestURL = URL(fileURLWithPath: CommandLine.arguments[1])
    let input = try JSONDecoder().decode(MaskRequest.self, from: Data(contentsOf: requestURL))
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: input.image) as CFURL, nil),
          CGImageSourceGetCount(source) == 1,
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
          image.width >= 32, image.height >= 32,
          image.width <= 4096, image.height <= 4096,
          image.width * image.height <= 8_294_400 else {
        throw MaskFailure(description: "bounded upright photo required")
    }
    let request = VNGeneratePersonSegmentationRequest()
    request.revision = VNGeneratePersonSegmentationRequestRevision1
    request.qualityLevel = .accurate
    request.outputPixelFormat = kCVPixelFormatType_OneComponent8
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    try handler.perform([request])
    guard let pixelBuffer = request.results?.first?.pixelBuffer,
          CVPixelBufferGetPixelFormatType(pixelBuffer) == kCVPixelFormatType_OneComponent8 else {
        throw MaskFailure(description: "Vision returned no person mask")
    }
    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    guard width > 0, height > 0, width <= 4096, height <= 4096,
          width * height <= 8_294_400,
          CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly) == kCVReturnSuccess else {
        throw MaskFailure(description: "Vision returned an invalid pixel buffer")
    }
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else {
        throw MaskFailure(description: "Vision mask has no pixel data")
    }
    let stride = CVPixelBufferGetBytesPerRow(pixelBuffer)
    guard stride >= width else {
        throw MaskFailure(description: "Vision mask row stride is invalid")
    }
    var bytes = Data(capacity: width * height)
    for row in 0..<height {
        bytes.append(base.advanced(by: row * stride).assumingMemoryBound(to: UInt8.self), count: width)
    }
    try bytes.write(to: URL(fileURLWithPath: input.output), options: .withoutOverwriting)
    let result: [String: Any] = [
        "width": width, "height": height, "requestRevision": request.revision,
        "quality": "accurate", "orientation": "top-left", "framework": "Apple Vision"
    ]
    let resultData = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    FileHandle.standardOutput.write(resultData)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

do {
    try run()
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
