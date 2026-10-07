import Foundation
import MachO
import Metal

struct TextureSpec: Decodable {
    let path: String
    let width: Int
    let height: Int
}
struct Request: Decodable {
    let textures: [TextureSpec]
    let strength: Float
    let output: String
}
struct RenderError: Error, CustomStringConvertible {
    let description: String
}
func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw RenderError(description: message) }
}

let shaderSource = """
#include <metal_stdlib>
using namespace metal;
struct FragmentInput { float4 position [[position]]; float2 uv; };
vertex FragmentInput fullFrame(uint index [[vertex_id]]) {
    const float2 corners[4] = {float2(-1,-1),float2(1,-1),float2(-1,1),float2(1,1)};
    FragmentInput result;
    result.position = float4(corners[index],0.5,1);
    result.uv = corners[index]*0.5+0.5;
    return result;
}
float2 cubeAddress(float blueSlice, float2 redGreen) {
    float row = floor(blueSlice/8.0f);
    float column = blueSlice-row*8.0f;
    return float2(column,row)/8.0f+1.0f/1024.0f+redGreen*(63.0f/512.0f);
}
fragment float4 whiten(FragmentInput input [[stage_in]],
                       constant float& strength [[buffer(0)]],
                       texture2d<float> source [[texture(0)]],
                       texture2d<float> cube [[texture(1)]],
                       texture2d<float> skin [[texture(2)]]) {
    constexpr sampler linearEdge(coord::normalized,address::clamp_to_edge,filter::linear);
    float4 original = source.sample(linearEdge,float2(input.uv.x,1.0f-input.uv.y));
    float blue = original.b*63.0f;
    float3 lower = cube.sample(linearEdge,cubeAddress(floor(blue),original.rg)).rgb;
    float3 upper = cube.sample(linearEdge,cubeAddress(ceil(blue),original.rg)).rgb;
    float3 mapped = mix(lower,upper,fract(blue));
    float3 filtered = mix(original.rgb,mapped,strength);
    float coverage = skin.sample(linearEdge,float2(input.uv.x,1.0f-input.uv.y)).a;
    return float4(mix(original.rgb,filtered,coverage),original.a);
}
"""

func run() throws {
    try require(CommandLine.arguments.count == 2, "one whitening render request required")
    let requestURL = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
    let root = requestURL.deletingLastPathComponent()
    let size = try FileManager.default.attributesOfItem(atPath: requestURL.path)[.size] as? NSNumber
    try require((size?.intValue ?? Int.max) <= 4096, "bounded whitening render request required")
    let request = try JSONDecoder().decode(Request.self, from: Data(contentsOf: requestURL))
    try require(request.textures.count == 3, "source, color cube and skin texture required")
    try require(request.strength.isFinite && (0...1).contains(request.strength), "finite unit whitening strength required")
    let source = request.textures[0]
    try require((1...1280).contains(source.width) && (1...1280).contains(source.height), "bounded source dimensions required")
    try require(request.textures[1].width == 512 && request.textures[1].height == 512, "512-square color cube required")
    try require((1...512).contains(request.textures[2].width) && (1...512).contains(request.textures[2].height), "bounded skin dimensions required")
    let outputURL = URL(fileURLWithPath: request.output).resolvingSymlinksInPath()
    try require(outputURL.deletingLastPathComponent() == root, "render files must share the request directory")
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
        throw RenderError(description: "Metal device unavailable")
    }
    func texture(_ width: Int, _ height: Int) throws -> MTLTexture {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: width, height: height, mipmapped: false)
        descriptor.storageMode = .shared
        descriptor.usage = [.shaderRead,.renderTarget]
        guard let result = device.makeTexture(descriptor: descriptor) else {
            throw RenderError(description: "Metal texture allocation failed")
        }
        return result
    }
    var textures: [MTLTexture] = []
    for specification in request.textures {
        let path = URL(fileURLWithPath: specification.path).resolvingSymlinksInPath()
        try require(path.deletingLastPathComponent() == root, "render files must share the request directory")
        let size = try FileManager.default.attributesOfItem(atPath: path.path)[.size] as? NSNumber
        try require(size?.intValue == specification.width*specification.height*4, "texture byte count mismatch")
        let data = try Data(contentsOf: path)
        let image = try texture(specification.width,specification.height)
        data.withUnsafeBytes { image.replace(region: MTLRegionMake2D(0,0,specification.width,specification.height), mipmapLevel: 0, withBytes: $0.baseAddress!, bytesPerRow: specification.width*4) }
        textures.append(image)
    }
    let target = try texture(source.width,source.height)
    let library = try device.makeLibrary(source: shaderSource, options: nil)
    let pipelineDescription = MTLRenderPipelineDescriptor()
    pipelineDescription.vertexFunction = library.makeFunction(name: "fullFrame")
    pipelineDescription.fragmentFunction = library.makeFunction(name: "whiten")
    pipelineDescription.colorAttachments[0].pixelFormat = .rgba8Unorm
    let pipeline = try device.makeRenderPipelineState(descriptor: pipelineDescription)
    guard let command = queue.makeCommandBuffer() else { throw RenderError(description: "Metal command buffer unavailable") }
    let render = MTLRenderPassDescriptor()
    render.colorAttachments[0].texture = target
    render.colorAttachments[0].loadAction = .clear
    render.colorAttachments[0].storeAction = .store
    guard let encoder = command.makeRenderCommandEncoder(descriptor: render) else { throw RenderError(description: "Metal render encoder unavailable") }
    encoder.setRenderPipelineState(pipeline)
    encoder.setCullMode(.none)
    for (index,image) in textures.enumerated() { encoder.setFragmentTexture(image,index: index) }
    var strength = request.strength
    encoder.setFragmentBytes(&strength,length: MemoryLayout<Float>.size,index: 0)
    encoder.drawPrimitives(type: .triangleStrip,vertexStart: 0,vertexCount: 4)
    encoder.endEncoding()
    command.commit()
    command.waitUntilCompleted()
    if let error = command.error { throw error }
    var pixels = Data(count: source.width*source.height*4)
    pixels.withUnsafeMutableBytes { target.getBytes($0.baseAddress!,bytesPerRow: source.width*4,from: MTLRegionMake2D(0,0,source.width,source.height),mipmapLevel: 0) }
    try pixels.write(to: outputURL)
    let images = (0..<_dyld_image_count()).map { String(cString: _dyld_get_image_name($0)) }
    let forbidden = ["libcccreator", "liblens", "libAGFX", "libbytenn", "/runtime/Frameworks/", "/JianyingPro.app/"]
    let privateImages = images.filter { path in forbidden.contains { path.contains($0) } }
    try require(privateImages.isEmpty, "independent Metal process loaded private effect libraries")
    let receipt: [String: Any] = ["gpu": device.name,"images": images,"private_native_images": privateImages,
        "pixelFormat": "RGBA8Unorm","vertexUv": "v=1-at-image-top","sourceRows": "image-top-to-bottom",
        "maskCoordinate": "native-u,1-native-v","lutInterpolation": "64-cube-trilinear"]
    try JSONSerialization.data(withJSONObject: receipt,options: [.prettyPrinted,.sortedKeys]).write(to: URL(fileURLWithPath: request.output+".json"))
}

do { try run() }
catch { FileHandle.standardError.write(Data("\(error)\n".utf8)); exit(1) }
