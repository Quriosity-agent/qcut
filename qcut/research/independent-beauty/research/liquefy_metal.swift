import Foundation
import MachO
import Metal

struct Request: Decodable {
    let width: Int
    let height: Int
    let maskWidth: Int
    let maskHeight: Int
    let input: String
    let mask: String
    let vertices: String
    let indices: String
    let output: String
}
struct RenderError: Error, CustomStringConvertible {
    let description: String
}
func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw RenderError(description: message) }
}
func readBytes(_ path: String, _ count: Int, _ root: URL) throws -> Data {
    let url = URL(fileURLWithPath: path).resolvingSymlinksInPath()
    try require(url.deletingLastPathComponent() == root, "local render files must share the request directory")
    let size = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber
    try require(size?.intValue == count, "local render byte count mismatch")
    return try Data(contentsOf: url)
}
let shaderSource = """
#include <metal_stdlib>
using namespace metal;
struct Vertex { float position[2]; float original[2]; float displaced[2]; float mask[2]; };
struct Field { float4 position [[position]]; float2 original; float2 displaced; float2 mask; };
vertex Field localVertex(uint index [[vertex_id]], constant Vertex* vertices [[buffer(0)]]) {
    Vertex v=vertices[index]; Field result;
    result.position=float4(v.position[0],-v.position[1],0.5,1);
    result.original=float2(v.original[0],v.original[1]);
    result.displaced=float2(v.displaced[0],v.displaced[1]);
    result.mask=float2(v.mask[0],v.mask[1]); return result;
}
fragment float4 coordinateFragment(Field field [[stage_in]], texture2d<float> mask [[texture(0)]]) {
    constexpr sampler linear(coord::normalized,address::clamp_to_edge,filter::linear);
    float amount=mask.sample(linear,field.mask).r;
    float2 coordinate=(1-amount)*field.original+amount*field.displaced;
    float neutral=127.0/255.0+128.0/65025.0;
    float2 scaled=((neutral+coordinate)-field.original)*255.0;
    float2 whole=floor(scaled);
    return float4(whole.x/255.0,scaled.x-whole.x,whole.y/255.0,scaled.y-whole.y);
}
kernel void transport(texture2d<float,access::read> packed [[texture(0)]],
                      texture2d<float> source [[texture(1)]],
                      texture2d<float,access::write> output [[texture(2)]],
                      uint2 pixel [[thread_position_in_grid]]) {
    if (pixel.x>=output.get_width() || pixel.y>=output.get_height()) return;
    float2 dimensions=float2(output.get_width(),output.get_height());
    float2 uv=(float2(pixel)+0.5)/dimensions; uv.y=1-uv.y;
    float2 grid=uv*512.0-0.5, weight=fract(grid);
    int2 lower=int2(floor(grid)), upper=clamp(lower+1,int2(0),int2(511));
    lower=clamp(lower,int2(0),int2(511));
    float4 a=packed.read(uint2(lower)), b=packed.read(uint2(lower.x,upper.y));
    float4 c=packed.read(uint2(upper.x,lower.y)), d=packed.read(uint2(upper));
    float4 channels=(((a*(1-weight.x))*(1-weight.y)+(b*(1-weight.x))*weight.y)
                    +(c*weight.x)*(1-weight.y))+(d*weight.x)*weight.y;
    float2 delta=float2(channels.r+channels.g/255.0,channels.b+channels.a/255.0)-0.5;
    delta=sign(delta)*max(abs(delta)-1.0/65536.0,0.0);
    float2 coordinate=uv+delta; coordinate.y=1-coordinate.y;
    constexpr sampler linear(coord::normalized,address::clamp_to_edge,filter::linear);
    output.write(source.sample(linear,coordinate),pixel);
}
"""

func run() throws {
    try require(CommandLine.arguments.count == 2, "one local render request required")
    let requestURL=URL(fileURLWithPath:CommandLine.arguments[1]).resolvingSymlinksInPath()
    let root=requestURL.deletingLastPathComponent()
    let requestSize=try FileManager.default.attributesOfItem(atPath:requestURL.path)[.size] as? NSNumber
    try require((requestSize?.intValue ?? Int.max)<=16384, "bounded local request required")
    let request=try JSONDecoder().decode(Request.self,from:Data(contentsOf:requestURL))
    try require((1...1280).contains(request.width) && (1...1280).contains(request.height), "bounded image dimensions required")
    try require((1...1024).contains(request.maskWidth) && (1...1024).contains(request.maskHeight), "bounded mask dimensions required")
    let outputURL=URL(fileURLWithPath:request.output).resolvingSymlinksInPath()
    try require(outputURL.deletingLastPathComponent()==root, "private output directory required")
    guard let device=MTLCreateSystemDefaultDevice(),let queue=device.makeCommandQueue() else {
        throw RenderError(description:"Metal device unavailable")
    }
    let library=try device.makeLibrary(source:shaderSource,options:nil)
    let pipelineDescriptor=MTLRenderPipelineDescriptor()
    pipelineDescriptor.vertexFunction=library.makeFunction(name:"localVertex")
    pipelineDescriptor.fragmentFunction=library.makeFunction(name:"coordinateFragment")
    pipelineDescriptor.colorAttachments[0].pixelFormat = .rgba8Unorm
    let coordinatePipeline=try device.makeRenderPipelineState(descriptor:pipelineDescriptor)
    let transportPipeline=try device.makeComputePipelineState(function:library.makeFunction(name:"transport")!)
    func texture(_ width:Int,_ height:Int,_ usage:MTLTextureUsage) throws -> MTLTexture {
        let descriptor=MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.rgba8Unorm,width:width,height:height,mipmapped:false)
        descriptor.storageMode = .shared; descriptor.usage=usage
        guard let texture=device.makeTexture(descriptor:descriptor) else { throw RenderError(description:"Metal texture unavailable") }
        return texture
    }
    func uploaded(_ path:String,_ width:Int,_ height:Int) throws -> MTLTexture {
        let data=try readBytes(path,width*height*4,root),result=try texture(width,height,[.shaderRead])
        data.withUnsafeBytes { result.replace(region:MTLRegionMake2D(0,0,width,height),mipmapLevel:0,withBytes:$0.baseAddress!,bytesPerRow:width*4) }
        return result
    }
    let source=try uploaded(request.input,request.width,request.height)
    let mask=try uploaded(request.mask,request.maskWidth,request.maskHeight)
    let packed=try texture(512,512,[.shaderRead,.renderTarget])
    let output=try texture(request.width,request.height,[.shaderWrite])
    let vertices=try readBytes(request.vertices,2270*32,root),indices=try readBytes(request.indices,4472*6,root)
    try require(vertices.withUnsafeBytes { $0.bindMemory(to:Float.self).allSatisfy { $0.isFinite && abs($0)<=32768 } }, "finite local vertices required")
    try require(indices.withUnsafeBytes { $0.bindMemory(to:UInt16.self).allSatisfy { $0<2270 } }, "local index out of range")
    guard let vertexBuffer=vertices.withUnsafeBytes({ device.makeBuffer(bytes:$0.baseAddress!,length:$0.count,options:.storageModeShared) }),
          let indexBuffer=indices.withUnsafeBytes({ device.makeBuffer(bytes:$0.baseAddress!,length:$0.count,options:.storageModeShared) }),
          let command=queue.makeCommandBuffer() else { throw RenderError(description:"Metal buffers unavailable") }
    let pass=MTLRenderPassDescriptor();pass.colorAttachments[0].texture=packed
    pass.colorAttachments[0].loadAction = .clear;pass.colorAttachments[0].storeAction = .store
    guard let encoder=command.makeRenderCommandEncoder(descriptor:pass) else { throw RenderError(description:"Metal render encoder unavailable") }
    encoder.setRenderPipelineState(coordinatePipeline);encoder.setCullMode(.none)
    encoder.setVertexBuffer(vertexBuffer,offset:0,index:0);encoder.setFragmentTexture(mask,index:0)
    encoder.drawIndexedPrimitives(type:.triangle,indexCount:4472*3,indexType:.uint16,indexBuffer:indexBuffer,indexBufferOffset:0)
    encoder.endEncoding()
    guard let compute=command.makeComputeCommandEncoder() else { throw RenderError(description:"Metal compute encoder unavailable") }
    compute.setComputePipelineState(transportPipeline)
    compute.setTexture(packed,index:0);compute.setTexture(source,index:1);compute.setTexture(output,index:2)
    compute.dispatchThreads(MTLSize(width:request.width,height:request.height,depth:1),threadsPerThreadgroup:MTLSize(width:16,height:16,depth:1))
    compute.endEncoding();command.commit();command.waitUntilCompleted()
    if let error=command.error { throw error }
    var pixels=Data(count:request.width*request.height*4)
    pixels.withUnsafeMutableBytes { output.getBytes($0.baseAddress!,bytesPerRow:request.width*4,from:MTLRegionMake2D(0,0,request.width,request.height),mipmapLevel:0) }
    try pixels.write(to:outputURL)
    let names=(0..<_dyld_image_count()).map { String(cString:_dyld_get_image_name($0)) }
    let forbidden=["libcccreator.dylib","liblens.dylib","libAGFX.dylib","libbytenn.dylib"]
    let privateImages=names.filter { forbidden.contains(URL(fileURLWithPath:$0).lastPathComponent) }
    try require(privateImages.isEmpty,"independent local Metal process loaded private libraries")
    let receipt:[String:Any]=["gpu":device.name,"private_native_images":privateImages,"pixelFormat":"RGBA8Unorm","coordinateTextureSize":512]
    try JSONSerialization.data(withJSONObject:receipt,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:request.output+".json"))
}
do { try run() }
catch { FileHandle.standardError.write(Data("\(error)\n".utf8)); exit(1) }
