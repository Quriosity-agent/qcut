import Foundation
import MachO
import Metal

struct PassSpec: Decodable {
    let name: String
    let vertices: String
    let indices: String
    let vertexCount: Int
    let indexCount: Int
}
struct Request: Decodable {
    let width: Int
    let height: Int
    let input: String
    let output: String
    let passes: [PassSpec]
}
struct RenderError: Error, CustomStringConvertible {
    let description: String
}
func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw RenderError(description: message) }
}
func readBytes(_ path: String, _ count: Int, _ root: URL) throws -> Data {
    let url = URL(fileURLWithPath: path).resolvingSymlinksInPath()
    try require(url.deletingLastPathComponent() == root, "render files must share the request directory")
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    try require((attributes[.size] as? NSNumber)?.intValue == count, "render byte count mismatch")
    return try Data(contentsOf: url)
}
let shaderSource = """
#include <metal_stdlib>
using namespace metal;
struct Vertex { float position[3]; float uv[2]; };
struct Varying { float4 position [[position]]; float2 uv; };
vertex Varying vertexMain(uint index [[vertex_id]],constant Vertex* vertices [[buffer(0)]]) {
    Vertex v=vertices[index]; Varying o;
    o.position=float4(v.position[0],v.position[1],0.5,1);
    o.uv=float2(v.uv[0],v.uv[1]); return o;
}
fragment float4 fragmentMain(Varying v [[stage_in]],texture2d<float> source [[texture(0)]]) {
    constexpr sampler s(coord::normalized,address::clamp_to_edge,filter::linear);
    return source.sample(s,float2(v.uv.x,1-v.uv.y));
}
"""

func run() throws {
    try require(CommandLine.arguments.count == 2, "one private face render request required")
    let requestURL = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
    let root = requestURL.deletingLastPathComponent()
    let size = try FileManager.default.attributesOfItem(atPath: requestURL.path)[.size] as? NSNumber
    try require((size?.intValue ?? Int.max) <= 16384, "bounded face request required")
    let request = try JSONDecoder().decode(Request.self, from: Data(contentsOf: requestURL))
    try require((1...1280).contains(request.width) && (1...1280).contains(request.height), "bounded image dimensions required")
    let order = request.passes.map(\.name)
    try require(order == ["LinkedOrgans", "LocalWarp"] || order == ["Jawline"] || order == ["LinkedOrgans"], "pinned ordered face passes required")
    let outputURL = URL(fileURLWithPath: request.output).resolvingSymlinksInPath()
    try require(outputURL.deletingLastPathComponent() == root, "private output directory required")
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
        throw RenderError(description: "Metal device unavailable")
    }
    let library = try device.makeLibrary(source: shaderSource, options: nil)
    let pipelineDescriptor = MTLRenderPipelineDescriptor()
    pipelineDescriptor.vertexFunction = library.makeFunction(name: "vertexMain")
    pipelineDescriptor.fragmentFunction = library.makeFunction(name: "fragmentMain")
    pipelineDescriptor.colorAttachments[0].pixelFormat = .rgba8Unorm
    let pipeline = try device.makeRenderPipelineState(descriptor: pipelineDescriptor)
    func texture() throws -> MTLTexture {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: request.width, height: request.height, mipmapped: false)
        descriptor.storageMode = .shared
        descriptor.usage = [.shaderRead, .renderTarget]
        guard let result = device.makeTexture(descriptor: descriptor) else {
            throw RenderError(description: "Metal texture allocation failed")
        }
        return result
    }
    var current = try texture()
    let input = try readBytes(request.input, request.width*request.height*4, root)
    try require(input.enumerated().allSatisfy { $0.offset % 4 != 3 || $0.element == 255 }, "opaque input photo required")
    input.withUnsafeBytes { current.replace(region: MTLRegionMake2D(0, 0, request.width, request.height), mipmapLevel: 0, withBytes: $0.baseAddress!, bytesPerRow: request.width*4) }
    for pass in request.passes {
        let isLinkedOrgans = pass.name == "LinkedOrgans"
        let isJawline = pass.name == "Jawline"
        let vertexCount = isJawline ? 5625 : isLinkedOrgans ? 315 : 2270
        let indexCount = isJawline ? 33744 : isLinkedOrgans ? 1791 : 13416
        try require(pass.vertexCount == vertexCount && pass.indexCount == indexCount, "pinned face mesh cardinality required")
        let vertices = try readBytes(pass.vertices, pass.vertexCount*20, root)
        let indices = try readBytes(pass.indices, pass.indexCount*2, root)
        try require(vertices.withUnsafeBytes { $0.bindMemory(to: Float.self).allSatisfy { $0.isFinite && abs($0) <= 32768 } }, "finite bounded face vertices required")
        try require(indices.withUnsafeBytes { $0.bindMemory(to: UInt16.self).allSatisfy { Int($0) < pass.vertexCount } }, "face index out of range")
        guard let vertexBuffer = vertices.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared) }),
              let indexBuffer = indices.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared) }),
              let command = queue.makeCommandBuffer() else {
            throw RenderError(description: "Metal buffer allocation failed")
        }
        let target = try texture()
        let render = MTLRenderPassDescriptor()
        render.colorAttachments[0].texture = target
        render.colorAttachments[0].loadAction = .clear
        render.colorAttachments[0].storeAction = .store
        guard let encoder = command.makeRenderCommandEncoder(descriptor: render) else {
            throw RenderError(description: "Metal render encoder unavailable")
        }
        encoder.setRenderPipelineState(pipeline)
        encoder.setCullMode(.none)
        encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
        encoder.setFragmentTexture(current, index: 0)
        encoder.drawIndexedPrimitives(type: .triangle, indexCount: pass.indexCount, indexType: .uint16, indexBuffer: indexBuffer, indexBufferOffset: 0)
        encoder.endEncoding()
        command.commit()
        command.waitUntilCompleted()
        if let error = command.error { throw error }
        current = target
    }
    var pixels = Data(count: request.width*request.height*4)
    pixels.withUnsafeMutableBytes { current.getBytes($0.baseAddress!, bytesPerRow: request.width*4, from: MTLRegionMake2D(0, 0, request.width, request.height), mipmapLevel: 0) }
    try pixels.write(to: outputURL)
    let imageNames = (0..<_dyld_image_count()).map { String(cString: _dyld_get_image_name($0)) }
    let forbidden = ["libcccreator.dylib", "liblens.dylib", "libAGFX.dylib", "libbytenn.dylib"]
    let privateImages = imageNames.filter { forbidden.contains(URL(fileURLWithPath: $0).lastPathComponent) }
    try require(privateImages.isEmpty, "independent Metal process loaded private effect libraries")
    let receipt: [String: Any] = ["gpu": device.name, "images": imageNames, "private_native_images": privateImages, "pixelFormat": "RGBA8Unorm", "passes": order]
    try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: request.output+".json"))
}
do { try run() }
catch { FileHandle.standardError.write(Data("\(error)\n".utf8)); exit(1) }
