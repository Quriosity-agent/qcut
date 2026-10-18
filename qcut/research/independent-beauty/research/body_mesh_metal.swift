// QCut-owned Metal host for the body mesh warp: draws a triangle mesh whose vertices
// carry normalized device positions and source UVs, sampling the input photo with a
// linear, edge-clamped sampler into an RGBA8 target (no blending, no culling). The
// input rows arrive bottom-up, matching the mesh's y-up convention.
import Darwin
import Foundation
import Metal

struct Request: Decodable {
    let width: Int
    let height: Int
    let rgba: String
    let vertices: String
    let indices: String
    let output: String
    let resolutionMode: String?
    let sourceWidth: Int?
    let sourceHeight: Int?
    let sourcePrecision: String?
    let meshProfile: String?
}

struct Failure: Error, CustomStringConvertible { let description: String }

func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw Failure(description: message) }
}

let shaderSource = """
#include <metal_stdlib>
using namespace metal;
struct MeshInput { float2 point [[attribute(0)]]; float2 sourceUV [[attribute(1)]]; };
struct MeshVertex { float4 position [[position]]; float2 coordinate [[user(uv0)]]; };
vertex MeshVertex meshVertex(MeshInput input [[stage_in]]) {
    MeshVertex v;
    v.position = float4(input.point, 0.5f, 1.0f);
    v.coordinate = input.sourceUV;
    return v;
}
fragment float4 meshFragment(MeshVertex in [[stage_in]], texture2d<half> image [[texture(0)]], sampler sampling [[sampler(0)]]) {
    return float4(image.sample(sampling, in.coordinate));
}
"""

func run() throws {
    try require(CommandLine.arguments.count == 2, "request.json argument required")
    let request = try JSONDecoder().decode(Request.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
    let sourceWidth = request.sourceWidth ?? request.width
    let sourceHeight = request.sourceHeight ?? request.height
    let precision = request.sourcePrecision ?? "half"
    let profile = request.meshProfile ?? "body"
    let vertexLimit = profile == "manual-zoom" ? 63001 : 4096
    let triangleLimit = profile == "manual-zoom" ? 125000 : 4096
    try require(request.width > 0 && request.height > 0 && request.width <= 4096 && request.height <= 4096, "bounded image required")
    try require(sourceWidth > 0 && sourceHeight > 0 && sourceWidth <= 4096 && sourceHeight <= 4096, "bounded source required")
    try require(precision == "half" || precision == "float", "explicit texture precision required")
    try require(profile == "body" || profile == "manual-zoom", "explicit mesh profile required")
    try require(profile != "manual-zoom" || precision == "float", "manual zoom requires float sampling")
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
        throw Failure(description: "Metal unavailable")
    }
    let rgba = try Data(contentsOf: URL(fileURLWithPath: request.rgba))
    let vertices = try Data(contentsOf: URL(fileURLWithPath: request.vertices))
    let indices = try Data(contentsOf: URL(fileURLWithPath: request.indices))
    try require(rgba.count == sourceWidth * sourceHeight * 4 && vertices.count % 20 == 0 && indices.count % 12 == 0
                && vertices.count >= 60 && vertices.count / 20 <= vertexLimit
                && indices.count >= 12 && indices.count / 12 <= triangleLimit, "input byte geometry invalid")
    let finiteVertices = vertices.withUnsafeBytes { bytes in
        stride(from: 0, to: bytes.count, by: 4).allSatisfy { offset in
            let value = bytes.loadUnaligned(fromByteOffset: offset, as: Float.self)
            return value.isFinite && abs(value) <= 32768
        }
    }
    let validIndices = indices.withUnsafeBytes { bytes in
        stride(from: 0, to: bytes.count, by: 4).allSatisfy { offset in
            bytes.loadUnaligned(fromByteOffset: offset, as: UInt32.self) < vertices.count / 20
        }
    }
    try require(finiteVertices && validIndices, "bounded finite indexed mesh required")
    let options = MTLCompileOptions()
    options.mathMode = .fast
    var source = precision == "float" ? shaderSource.replacingOccurrences(of: "texture2d<half>", with: "texture2d<float>") : shaderSource
    if profile == "manual-zoom" {
        source = source.replacingOccurrences(
            of: "return float4(image.sample(sampling, in.coordinate));",
            with: "float2 domain = step(float2(0), in.coordinate) - step(float2(1), in.coordinate); return float4(image.sample(sampling, in.coordinate)) * (domain.x * domain.y);"
        )
    }
    let library = try device.makeLibrary(source: source, options: options)
    let pipeline = MTLRenderPipelineDescriptor()
    pipeline.vertexFunction = library.makeFunction(name: "meshVertex")
    pipeline.fragmentFunction = library.makeFunction(name: "meshFragment")
    let layout = MTLVertexDescriptor()
    layout.attributes[0].format = .float2
    layout.attributes[0].offset = 0
    layout.attributes[0].bufferIndex = 0
    layout.attributes[1].format = .float2
    layout.attributes[1].offset = 12
    layout.attributes[1].bufferIndex = 0
    layout.layouts[0].stride = 20
    pipeline.vertexDescriptor = layout
    pipeline.colorAttachments[0].pixelFormat = .rgba8Unorm
    pipeline.colorAttachments[0].isBlendingEnabled = false
    let state = try device.makeRenderPipelineState(descriptor: pipeline)
    func texture(_ usage: MTLTextureUsage, width: Int, height: Int) throws -> MTLTexture {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: width,
                                                                  height: height, mipmapped: false)
        descriptor.storageMode = .shared
        descriptor.usage = usage
        guard let made = device.makeTexture(descriptor: descriptor) else { throw Failure(description: "texture allocation failed") }
        return made
    }
    let input = try texture(.shaderRead, width: sourceWidth, height: sourceHeight)
    let output = try texture(.renderTarget, width: request.width, height: request.height)
    rgba.withUnsafeBytes {
        input.replace(region: MTLRegionMake2D(0, 0, sourceWidth, sourceHeight), mipmapLevel: 0,
                      withBytes: $0.baseAddress!, bytesPerRow: sourceWidth * 4)
    }
    let samplerDescriptor = MTLSamplerDescriptor()
    samplerDescriptor.minFilter = .linear
    samplerDescriptor.magFilter = .linear
    samplerDescriptor.mipFilter = .notMipmapped
    samplerDescriptor.sAddressMode = .clampToEdge
    samplerDescriptor.tAddressMode = .clampToEdge
    samplerDescriptor.normalizedCoordinates = true
    guard let sampler = device.makeSamplerState(descriptor: samplerDescriptor),
          let vertexBuffer = vertices.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: vertices.count, options: .storageModeShared) }),
          let indexBuffer = indices.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: indices.count, options: .storageModeShared) })
    else { throw Failure(description: "Metal buffer allocation failed") }
    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = output
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0)
    guard let command = queue.makeCommandBuffer(), let encoder = command.makeRenderCommandEncoder(descriptor: pass) else {
        throw Failure(description: "Metal command encoding failed")
    }
    encoder.setRenderPipelineState(state)
    encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
    encoder.setFragmentTexture(input, index: 0)
    encoder.setFragmentSamplerState(sampler, index: 0)
    encoder.setCullMode(.none)
    encoder.drawIndexedPrimitives(type: .triangle, indexCount: indices.count / 4, indexType: .uint32,
                                  indexBuffer: indexBuffer, indexBufferOffset: 0)
    encoder.endEncoding()
    command.commit()
    command.waitUntilCompleted()
    if let error = command.error { throw error }
    var result = Data(count: request.width * request.height * 4)
    result.withUnsafeMutableBytes {
        output.getBytes($0.baseAddress!, bytesPerRow: request.width * 4,
                        from: MTLRegionMake2D(0, 0, request.width, request.height), mipmapLevel: 0)
    }
    try result.write(to: URL(fileURLWithPath: request.output))
    let images = (0..<_dyld_image_count()).map { String(cString: _dyld_get_image_name($0)) }
    let forbidden = ["libcccreator", "libbytenn", "liblens", "libAGFX"]
    var receipt: [String: Any] = [
        "gpu": device.name, "width": request.width, "height": request.height, "format": "RGBA8Unorm",
        "sampling": "linear", "address": "clamp", "blending": false, "pixelBytes": result.count,
        "sourcePrecision": precision, "meshProfile": profile,
        "vertexCount": vertices.count / 20, "triangleCount": indices.count / 12,
        "privateNativeImages": images.filter { path in forbidden.contains { path.contains($0) } },
    ]
    if request.resolutionMode == "original" {
        receipt["resolutionMode"] = "original"
        receipt["sourceFrameSize"] = [sourceWidth, sourceHeight]
        receipt["sourceRgbaBytes"] = rgba.count
        receipt["maxSourceEdge"] = 4096
    }
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]))
}

do { try run() } catch { fputs("\(error)\n", stderr); exit(1) }
