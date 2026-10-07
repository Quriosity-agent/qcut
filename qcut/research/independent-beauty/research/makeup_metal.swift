import Foundation
import MachO
import Metal

struct TextureSpec: Decodable {
    let path: String
    let width: Int
    let height: Int
}
struct PassSpec: Decodable {
    let name: String
    let vertices: String
    let indices: String
    let vertexCount: Int
    let indexCount: Int
    let textures: [TextureSpec]
    let modes: [UInt32]
    let pupil: Bool
    let cutoff: Bool
    let strength: Float
    let customColor: [Float]?
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
struct Vertex { float2 p; float2 uv; float weight; float padding[3]; };
struct Uniform { float2 projectionScale; float strength; uint mode0; uint mode1; uint layers; uint pupil; uint cutoff; float4 customColor; };
struct Varying { float4 p [[position]]; float2 base; float2 uv; float weight; };
vertex Varying vertexMain(uint index [[vertex_id]],constant Vertex* vertices [[buffer(0)]],constant Uniform& u [[buffer(1)]]) {
    Vertex v=vertices[index]; Varying o;
    float2 clip=fma(v.p,u.projectionScale,float2(-1,1));
    o.p=float4(clip,0.5,1); o.base=clip*0.5+0.5; o.uv=v.uv; o.weight=v.weight; return o;
}
float3 blend(float3 b,float3 p,uint mode) {
    if(mode==0)return p;
    if(mode==1)return b*p;
    if(mode==2)return 1-(1-b)*(1-p);
    return select(sqrt(b)*(2*p-1)+2*b*(1-p),2*b*p+b*b*(1-2*p),p<0.5);
}
float3 layer(float3 base,float4 pigment,float strength,uint mode) {
    pigment*=strength;
    float3 straight=clamp(pigment.rgb/max(pigment.a,1e-6f),0.0f,1.0f);
    return mix(base,blend(base,straight,mode),pigment.a);
}
fragment float4 fragmentMain(Varying v [[stage_in]],constant Uniform& u [[buffer(1)]],texture2d<float> base [[texture(0)]],texture2d<float> pigment0 [[texture(1)]],texture2d<float> pigment1 [[texture(2)]],texture2d<float> mask [[texture(3)]]) {
    constexpr sampler s(coord::normalized,address::clamp_to_edge,filter::linear);
    if(u.cutoff)return pigment0.sample(s,v.uv);
    float4 src=base.sample(s,float2(v.base.x,1-v.base.y));
    float4 pigment=pigment0.sample(s,v.uv);
    if(u.customColor.w!=0) pigment.rgb=u.customColor.rgb*pigment.a;
    float3 color=layer(src.rgb,pigment,u.strength,u.mode0);
    if(u.layers==2)color=layer(color,pigment1.sample(s,v.uv),u.strength,u.mode1);
    if(u.pupil)color=mix(src.rgb,color,v.weight*mask.sample(s,float2(v.base.x,1-v.base.y)).r);
    return float4(color,src.a);
}
"""

func run() throws {
    try require(CommandLine.arguments.count == 2, "one private render request required")
    let requestURL = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
    let root = requestURL.deletingLastPathComponent()
    let size = try FileManager.default.attributesOfItem(atPath: requestURL.path)[.size] as? NSNumber
    try require((size?.intValue ?? Int.max) <= 65536, "bounded render request required")
    let request = try JSONDecoder().decode(Request.self, from: Data(contentsOf: requestURL))
    try require((1...1280).contains(request.width) && (1...1280).contains(request.height), "bounded image dimensions required")
    let order = request.passes.map(\.name)
    let dynamicOrder = ["Stereo", "Blusher", "Brow", "Eyeline", "Eyeshadow", "Eyemazing", "Lip"]
    let dynamic = !order.isEmpty && order == dynamicOrder.filter { order.contains($0) }
    try require(order == ["Brow", "Eyeshadow", "Eyeline", "Eyemazing", "Eyelash", "Cutoff", "Pupil", "Stereo", "Blusher", "Lip"] || dynamic || order == ["Stereo"] || order == ["Eyeline"] || order == ["Eyemazing"], "pinned pigment layer order required")
    if dynamic {
        let dynamicModes: [String: [UInt32]] = ["Stereo": [3], "Blusher": [1, 0], "Brow": [1], "Eyeshadow": [1, 2], "Eyeline": [1], "Eyemazing": [1, 2], "Lip": [1]]
        for pass in request.passes {
            try require(pass.modes == dynamicModes[pass.name], "pinned dynamic pigment blend required")
        }
    }
    if order == ["Eyeline"] {
        try require(request.passes[0].modes == [1] && request.passes[0].textures.count == 1, "pinned single eyeliner blend required")
    }
    if order == ["Eyemazing"] {
        try require(request.passes[0].modes == [1, 2] && request.passes[0].textures.count == 2, "pinned single aegyo blend required")
    }
    let outputURL = URL(fileURLWithPath: request.output).resolvingSymlinksInPath()
    try require(outputURL.deletingLastPathComponent() == root, "private output prefix required")
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
        throw RenderError(description: "Metal device unavailable")
    }
    let library = try device.makeLibrary(source: shaderSource, options: nil)
    let descriptor = MTLRenderPipelineDescriptor()
    descriptor.vertexFunction = library.makeFunction(name: "vertexMain")
    descriptor.fragmentFunction = library.makeFunction(name: "fragmentMain")
    descriptor.colorAttachments[0].pixelFormat = .rgba8Unorm
    let pipeline = try device.makeRenderPipelineState(descriptor: descriptor)

    func texture(_ width: Int, _ height: Int) throws -> MTLTexture {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: width, height: height, mipmapped: false)
        descriptor.storageMode = .shared
        descriptor.usage = [.shaderRead, .renderTarget]
        guard let result = device.makeTexture(descriptor: descriptor) else { throw RenderError(description: "Metal texture allocation failed") }
        return result
    }
    func load(_ specification: TextureSpec) throws -> MTLTexture {
        try require((1...2048).contains(specification.width) && (1...2048).contains(specification.height), "bounded pigment dimensions required")
        let data = try readBytes(specification.path, specification.width*specification.height*4, root)
        let result = try texture(specification.width, specification.height)
        data.withUnsafeBytes { result.replace(region: MTLRegionMake2D(0, 0, specification.width, specification.height), mipmapLevel: 0, withBytes: $0.baseAddress!, bytesPerRow: specification.width*4) }
        return result
    }
    var current = try load(TextureSpec(path: request.input, width: request.width, height: request.height))
    var mask = try texture(request.width, request.height)
    for pass in request.passes {
        try require(pass.strength.isFinite && (0...1).contains(pass.strength), "finite unit pigment strength required")
        if let color = pass.customColor {
            try require(pass.name == "Lip" && color.count == 3 && color.allSatisfy { $0.isFinite && (0...1).contains($0) }, "bounded custom lip color required")
        }
        let expectedVertices = pass.name == "Pupil" ? 78 : ["Brow", "Stereo", "Blusher", "Lip"].contains(pass.name) ? 248 : 174
        let expectedIndices = expectedVertices == 78 ? 342 : expectedVertices == 248 ? 1113 : 1002
        try require(pass.vertexCount == expectedVertices && pass.indexCount == expectedIndices, "pinned pigment mesh cardinality required")
        try require(pass.pupil == (pass.name == "Pupil") && pass.cutoff == (pass.name == "Cutoff"), "pinned cutoff and pupil dispatch required")
        try require((1...2).contains(pass.textures.count) && pass.modes.count == pass.textures.count && pass.modes.allSatisfy { $0 <= 3 }, "bounded pigment blend modes required")
        let vertices = try readBytes(pass.vertices, pass.vertexCount*32, root)
        let indices = try readBytes(pass.indices, pass.indexCount*2, root)
        try require(vertices.withUnsafeBytes { bytes in bytes.bindMemory(to: Float.self).allSatisfy { $0.isFinite && abs($0) <= 32768 } }, "finite bounded pigment vertices required")
        try require(indices.withUnsafeBytes { bytes in bytes.bindMemory(to: UInt16.self).allSatisfy { Int($0) < pass.vertexCount } }, "pigment index out of range")
        guard let vertexBuffer = vertices.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared) }),
              let indexBuffer = indices.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared) }),
              let command = queue.makeCommandBuffer() else { throw RenderError(description: "Metal buffer allocation failed") }
        let target = try texture(request.width, request.height)
        if !pass.cutoff {
            guard let copy = command.makeBlitCommandEncoder() else { throw RenderError(description: "Metal copy encoder unavailable") }
            copy.copy(from: current, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0), sourceSize: MTLSize(width: request.width, height: request.height, depth: 1), to: target, destinationSlice: 0, destinationLevel: 0, destinationOrigin: MTLOrigin(x: 0, y: 0, z: 0))
            copy.endEncoding()
        }
        let render = MTLRenderPassDescriptor()
        render.colorAttachments[0].texture = target
        render.colorAttachments[0].loadAction = pass.cutoff ? .clear : .load
        render.colorAttachments[0].storeAction = .store
        render.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        guard let encoder = command.makeRenderCommandEncoder(descriptor: render) else { throw RenderError(description: "Metal render encoder unavailable") }
        encoder.setRenderPipelineState(pipeline)
        encoder.setCullMode(.none)
        encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
        let color = pass.customColor ?? [0, 0, 0]
        let uniforms: [UInt32] = [Float(2.0/Double(request.width)).bitPattern, Float(-2.0/Double(request.height)).bitPattern, pass.strength.bitPattern, pass.modes[0], pass.modes.count > 1 ? pass.modes[1] : 0, UInt32(pass.textures.count), pass.pupil ? 1 : 0, pass.cutoff ? 1 : 0, color[0].bitPattern, color[1].bitPattern, color[2].bitPattern, pass.customColor == nil ? 0 : Float(1).bitPattern]
        uniforms.withUnsafeBytes {
            encoder.setVertexBytes($0.baseAddress!, length: $0.count, index: 1)
            encoder.setFragmentBytes($0.baseAddress!, length: $0.count, index: 1)
        }
        encoder.setFragmentTexture(current, index: 0)
        encoder.setFragmentTexture(current, index: 2)
        encoder.setFragmentTexture(mask, index: 3)
        for (index, specification) in pass.textures.enumerated() { encoder.setFragmentTexture(try load(specification), index: index+1) }
        encoder.drawIndexedPrimitives(type: .triangle, indexCount: pass.indexCount, indexType: .uint16, indexBuffer: indexBuffer, indexBufferOffset: 0)
        encoder.endEncoding()
        command.commit()
        command.waitUntilCompleted()
        if let error = command.error { throw error }
        if pass.cutoff { mask = target; continue }
        current = target
    }
    var pixels = Data(count: request.width*request.height*4)
    pixels.withUnsafeMutableBytes { current.getBytes($0.baseAddress!, bytesPerRow: request.width*4, from: MTLRegionMake2D(0, 0, request.width, request.height), mipmapLevel: 0) }
    try pixels.write(to: outputURL)
    let imageNames = (0..<_dyld_image_count()).map { String(cString: _dyld_get_image_name($0)) }
    let forbidden = ["libcccreator.dylib", "liblens.dylib", "libAGFX.dylib", "libbytenn.dylib"]
    let privateImages = imageNames.filter { forbidden.contains(URL(fileURLWithPath: $0).lastPathComponent) }
    try require(privateImages.isEmpty, "independent Metal process loaded private effect libraries")
    let receipt: [String: Any] = ["gpu": device.name, "images": imageNames, "private_native_images": privateImages, "pixelFormat": "RGBA8Unorm", "layers": order]
    try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: request.output+".json"))
}

do { try run() }
catch { FileHandle.standardError.write(Data("\(error)\n".utf8)); exit(1) }
