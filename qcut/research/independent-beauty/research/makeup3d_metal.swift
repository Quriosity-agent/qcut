import Foundation
import MachO
import Metal

struct TextureSpec: Decodable { let path: String; let width: Int; let height: Int }
struct Request: Decodable { let width: Int; let height: Int; let input: String; let output: String; let vertices: String; let indices: String; let uniforms: String; let pigment: TextureSpec }
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
struct Vertex { float4 p [[attribute(0)]]; float2 uv [[attribute(1)]]; float3 normal [[attribute(2)]]; };
struct Uniform { float4x4 mvp; float4x4 model; float4 color; float4 light; float4 controls; };
struct Varying { float4 position [[position]]; float2 uv; float2 screen; float3 normal; float3 world; };
vertex Varying vertexMain(Vertex v [[stage_in]],constant Uniform& u [[buffer(1)]]) {
 Varying o;float4 p=v.p;
 o.position=u.mvp*p;o.world=(u.model*p).xyz;o.uv=v.uv;o.normal=v.normal;o.screen=(o.position.xy/o.position.w)*0.5+0.5;o.position.z=(o.position.z+o.position.w)*0.5;return o;
}
fragment float4 fragmentMain(Varying v [[stage_in]],constant Uniform& u [[buffer(1)]],texture2d<float> source [[texture(0)]],texture2d<float> pigment [[texture(1)]]) {
 constexpr sampler s(coord::normalized,address::clamp_to_edge,filter::linear);
 float4 src=source.sample(s,float2(v.screen.x,1-v.screen.y));if(all(v.normal==float3(0)))return src;
 float3 base=src.rgb;float4 tex=pigment.sample(s,v.uv);
 if(u.controls.w<0.5){float3 straight=clamp(tex.rgb/max(tex.a,0.0001f),0.0f,1.0f);return float4(mix(base,base*straight,tex.a*u.controls.z),src.a);}
 float3 view=fast::normalize(float3(0,0,10)-v.world);float3 normal=fast::normalize(float3x3(u.model[0].xyz,u.model[1].xyz,u.model[2].xyz)*v.normal);float3 light=fast::normalize(-u.light.xyz);float3 h=fast::normalize(light+view);
 float nov=fast::max(0.0f,dot(normal,view)),nol=fast::max(0.0f,dot(normal,light)),noh=fast::max(0.0f,dot(normal,h)),hov=fast::max(0.0f,dot(h,view));float rough=u.controls.x,metal=u.controls.y;float r2=rough*rough,r4=r2*r2;float d=fast::max(noh*noh*(r4-1)+1,0.001f);float D=r4/((3.1415927410125732f*d)*d);float k=(rough+1)*(rough+1)/8;float G=(nov/(nov*(1-k)+k+0.001f))*(nol/(nol*(1-k)+k+0.001f));float3 albedo=base*u.color.xyz;float3 F0=mix(float3(.04),albedo,float3(metal));float3 fresnel=F0+(1-F0)*pow(1-hov,5.0f);float3 diffuse=((albedo/3.1415927410125732f)*nol)*((1-metal)*(1-metal));float3 lc=(fresnel*(D*G)+diffuse)*u.color.xyz*u.color.w;float3 result=mix(base,fast::min(base/(1-lc),float3(1)),tex.r*u.controls.z);return float4(clamp(result,0.0f,1.0f),src.a);
}
"""

func run() throws {
    try require(CommandLine.arguments.count == 2, "one private classical makeup request required")
    let requestURL = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
    let root = requestURL.deletingLastPathComponent()
    let size = try FileManager.default.attributesOfItem(atPath: requestURL.path)[.size] as? NSNumber
    try require((size?.intValue ?? Int.max) <= 16384, "bounded face request required")
    let request = try JSONDecoder().decode(Request.self, from: Data(contentsOf: requestURL))
    try require((1...1280).contains(request.width) && (1...1280).contains(request.height), "bounded image dimensions required")
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
    pipelineDescriptor.depthAttachmentPixelFormat = .depth32Float
    let descriptor = MTLVertexDescriptor()
    for (index,format,offset) in [(0,MTLVertexFormat.float3,0),(1,.float2,12),(2,.float3,20)] {descriptor.attributes[index].format = format;descriptor.attributes[index].offset = offset;descriptor.attributes[index].bufferIndex = 0}
    descriptor.layouts[0].stride = 32;pipelineDescriptor.vertexDescriptor = descriptor
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
    let vertices = try readBytes(request.vertices, 1463*32, root)
    let indices = try readBytes(request.indices, 7128*2, root)
    let uniforms = try readBytes(request.uniforms, 44*4, root)
    try require((1...4096).contains(request.pigment.width) && (1...4096).contains(request.pigment.height), "bounded pigment dimensions required")
    try require(vertices.withUnsafeBytes {$0.bindMemory(to: Float.self).allSatisfy {$0.isFinite && abs($0) <= 32768}}, "bounded finite mesh required")
    try require(uniforms.withUnsafeBytes {$0.bindMemory(to: Float.self).allSatisfy {$0.isFinite && abs($0) <= 32768}}, "bounded finite camera required")
    try require(indices.withUnsafeBytes {$0.bindMemory(to: UInt16.self).allSatisfy {$0 < 1463}}, "bounded triangle indices required")
    let pigment = try readBytes(request.pigment.path, request.pigment.width*request.pigment.height*4, root)
    let td = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm,width: request.pigment.width,height: request.pigment.height,mipmapped: false)
    td.storageMode = .shared;td.usage = .shaderRead
    guard let paint = device.makeTexture(descriptor: td),let vertexBuffer = vertices.withUnsafeBytes({device.makeBuffer(bytes: $0.baseAddress!,length: $0.count,options: .storageModeShared)}),let indexBuffer = indices.withUnsafeBytes({device.makeBuffer(bytes: $0.baseAddress!,length: $0.count,options: .storageModeShared)}),let uniformBuffer = uniforms.withUnsafeBytes({device.makeBuffer(bytes: $0.baseAddress!,length: $0.count,options: .storageModeShared)}),let command = queue.makeCommandBuffer() else {throw RenderError(description: "Metal allocation failed")}
    pigment.withUnsafeBytes {paint.replace(region: MTLRegionMake2D(0,0,request.pigment.width,request.pigment.height),mipmapLevel: 0,withBytes: $0.baseAddress!,bytesPerRow: request.pigment.width*4)}
    let target = try texture()
    input.withUnsafeBytes {target.replace(region: MTLRegionMake2D(0,0,request.width,request.height),mipmapLevel: 0,withBytes: $0.baseAddress!,bytesPerRow: request.width*4)}
    let depthDescriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .depth32Float,width: request.width,height: request.height,mipmapped: false);depthDescriptor.usage = .renderTarget;depthDescriptor.storageMode = .private
    guard let depth = device.makeTexture(descriptor: depthDescriptor) else {throw RenderError(description: "Depth texture unavailable")}
    let depthStateDescriptor = MTLDepthStencilDescriptor();depthStateDescriptor.depthCompareFunction = .lessEqual;depthStateDescriptor.isDepthWriteEnabled = true;let depthState = device.makeDepthStencilState(descriptor: depthStateDescriptor)
    let render = MTLRenderPassDescriptor();render.depthAttachment.texture = depth;render.depthAttachment.loadAction = .clear;render.depthAttachment.storeAction = .dontCare;render.depthAttachment.clearDepth = 1;render.colorAttachments[0].texture = target;render.colorAttachments[0].loadAction = .load;render.colorAttachments[0].storeAction = .store
    guard let encoder = command.makeRenderCommandEncoder(descriptor: render) else {throw RenderError(description: "Metal encoder unavailable")}
    encoder.setRenderPipelineState(pipeline);encoder.setDepthStencilState(depthState);encoder.setFrontFacing(.counterClockwise);encoder.setCullMode(.back);encoder.setVertexBuffer(vertexBuffer,offset: 0,index: 0);encoder.setVertexBuffer(uniformBuffer,offset: 0,index: 1);encoder.setFragmentBuffer(uniformBuffer,offset: 0,index: 1);encoder.setFragmentTexture(current,index: 0);encoder.setFragmentTexture(paint,index: 1)
    encoder.drawIndexedPrimitives(type: .triangle,indexCount: 7128,indexType: .uint16,indexBuffer: indexBuffer,indexBufferOffset: 0);encoder.endEncoding();command.commit();command.waitUntilCompleted();if let error = command.error {throw error};current = target
    var pixels = Data(count: request.width*request.height*4)
    pixels.withUnsafeMutableBytes { current.getBytes($0.baseAddress!, bytesPerRow: request.width*4, from: MTLRegionMake2D(0, 0, request.width, request.height), mipmapLevel: 0) }
    try pixels.write(to: outputURL)
    let imageNames = (0..<_dyld_image_count()).map { String(cString: _dyld_get_image_name($0)) }
    let forbidden = ["libcccreator.dylib", "liblens.dylib", "libAGFX.dylib", "libbytenn.dylib"]
    let privateImages = imageNames.filter { forbidden.contains(URL(fileURLWithPath: $0).lastPathComponent) }
    try require(privateImages.isEmpty, "independent Metal process loaded private effect libraries")
    let receipt: [String: Any] = ["gpu": device.name, "images": imageNames, "private_native_images": privateImages, "pixelFormat": "RGBA8Unorm", "passes": ["Face3D"]]
    try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: request.output+".json"))
}
do { try run() }
catch { FileHandle.standardError.write(Data("\(error)\n".utf8)); exit(1) }
