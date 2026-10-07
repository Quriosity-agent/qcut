import Foundation
import MachO
import Metal

struct Request: Decodable { let width: Int, height: Int; let mvp: [Float]; let intensity: Float }
struct CompositeError: Error, CustomStringConvertible { let description: String }
func require(_ test: Bool, _ message: String) throws { if !test { throw CompositeError(description: message) } }

let source = """
#include <metal_stdlib>
using namespace metal;
struct Camera { float4x4 matrix; };
struct Vertex { float4 position [[position]]; float2 uv; float2 screen; };
vertex Vertex faceVertex(uint id [[vertex_id]],constant Camera& camera [[buffer(0)]]) {
    float2 xy[4]={float2(-1,1),float2(-1,-1),float2(1,1),float2(1,-1)};
    float2 uv[4]={float2(0,0),float2(0,1),float2(1,0),float2(1,1)};
    Vertex v;v.position=camera.matrix*float4(xy[id],0,1);v.uv=uv[id];
    v.screen=v.position.xy/v.position.w*.5f+.5f;v.screen.y=1-v.screen.y;
    v.position.z=(v.position.z+v.position.w)*.5f;return v;
}
kernel void normalizeNetwork(device const float4* network [[buffer(0)]],texture2d<half,access::write> target [[texture(0)]],uint2 q [[thread_position_in_grid]]) {
    if(q.x<512&&q.y<512)target.write(fma(half4(network[q.y*512+q.x]),half4(.5h),half4(.5h)),q);
}
fragment float4 composite(Vertex v [[stage_in]],constant float& strength [[buffer(0)]],texture2d<float> original [[texture(0)]],texture2d<float> gan [[texture(1)]],texture2d<float> mask [[texture(2)]]) {
    constexpr sampler sm(coord::normalized,address::clamp_to_edge,filter::linear);
    float4 a=original.sample(sm,v.screen),b=gan.sample(sm,v.uv);
    return float4(mix(a.rgb,b.rgb,b.a*strength),a.a*mask.sample(sm,v.uv).r);
}
"""

func run() throws {
    try require(CommandLine.arguments.count == 2,"one bounded composite request required")
    let url=URL(fileURLWithPath:CommandLine.arguments[1]).resolvingSymlinksInPath(),root=url.deletingLastPathComponent()
    let size=try FileManager.default.attributesOfItem(atPath:url.path)[.size] as? NSNumber
    try require((size?.intValue ?? Int.max)<4096,"bounded request required")
    let request=try JSONDecoder().decode(Request.self,from:Data(contentsOf:url))
    try require((1...1280).contains(request.width) && (1...1280).contains(request.height)
        && request.mvp.count == 16 && request.mvp.allSatisfy{$0.isFinite && abs($0)<=32768}
        && request.intensity.isFinite && request.intensity>0 && request.intensity<=1,"bounded composite parameters required")
    func read(_ name: String,_ count: Int) throws -> Data {
        let file=root.appendingPathComponent(name).resolvingSymlinksInPath()
        let extent=try FileManager.default.attributesOfItem(atPath:file.path)[.size] as? NSNumber
        try require(file.deletingLastPathComponent()==root && extent?.intValue==count,"private file extent required")
        return try Data(contentsOf:file)
    }
    guard let device=MTLCreateSystemDefaultDevice(),let queue=device.makeCommandQueue(),let command=queue.makeCommandBuffer() else {throw CompositeError(description:"Metal unavailable")}
    let library=try device.makeLibrary(source:source,options:nil)
    func texture(_ w:Int,_ h:Int,_ bytes:Data?=nil)->MTLTexture {
        let descriptor=MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.rgba8Unorm,width:w,height:h,mipmapped:false)
        descriptor.storageMode = .shared;descriptor.usage=[.shaderRead,.shaderWrite,.renderTarget]
        let result=device.makeTexture(descriptor:descriptor)!
        if let bytes=bytes { bytes.withUnsafeBytes{result.replace(region:MTLRegionMake2D(0,0,w,h),mipmapLevel:0,withBytes:$0.baseAddress!,bytesPerRow:w*4)} }
        return result
    }
    let original=try read("source.rgba",request.width*request.height*4)
    let input=texture(request.width,request.height,original),target=texture(request.width,request.height,original)
    let gan=texture(512,512),mask=texture(320,320,try read("mask.rgba",320*320*4))
    let network=try read("network.f32",512*512*16)
    let buffer=network.withUnsafeBytes{device.makeBuffer(bytes:$0.baseAddress!,length:$0.count,options:.storageModeShared)}!
    let normalize=try device.makeComputePipelineState(function:library.makeFunction(name:"normalizeNetwork")!)
    let compute=command.makeComputeCommandEncoder()!
    compute.setComputePipelineState(normalize);compute.setBuffer(buffer,offset:0,index:0);compute.setTexture(gan,index:0)
    compute.dispatchThreads(MTLSize(width:512,height:512,depth:1),threadsPerThreadgroup:MTLSize(width:8,height:8,depth:1));compute.endEncoding()
    let descriptor=MTLRenderPipelineDescriptor()
    descriptor.vertexFunction=library.makeFunction(name:"faceVertex");descriptor.fragmentFunction=library.makeFunction(name:"composite")
    let attachment=descriptor.colorAttachments[0]!
    attachment.pixelFormat = .rgba8Unorm;attachment.isBlendingEnabled=true
    attachment.sourceRGBBlendFactor = .sourceAlpha;attachment.destinationRGBBlendFactor = .oneMinusSourceAlpha
    attachment.sourceAlphaBlendFactor = .one;attachment.destinationAlphaBlendFactor = .oneMinusSourceAlpha
    let pipeline=try device.makeRenderPipelineState(descriptor:descriptor)
    let pass=MTLRenderPassDescriptor();pass.colorAttachments[0].texture=target
    pass.colorAttachments[0].loadAction = .load;pass.colorAttachments[0].storeAction = .store
    let render=command.makeRenderCommandEncoder(descriptor:pass)!
    render.setRenderPipelineState(pipeline)
    request.mvp.withUnsafeBytes{render.setVertexBytes($0.baseAddress!,length:$0.count,index:0)}
    var strength=request.intensity
    render.setFragmentBytes(&strength,length:MemoryLayout<Float>.size,index:0)
    for (index,texture) in [input,gan,mask].enumerated(){render.setFragmentTexture(texture,index:index)}
    render.drawPrimitives(type:.triangleStrip,vertexStart:0,vertexCount:4);render.endEncoding()
    command.commit();command.waitUntilCompleted();if let error=command.error{throw error}
    var output=Data(count:request.width*request.height*4)
    output.withUnsafeMutableBytes{target.getBytes($0.baseAddress!,bytesPerRow:request.width*4,from:MTLRegionMake2D(0,0,request.width,request.height),mipmapLevel:0)}
    let images=(0..<_dyld_image_count()).map{String(cString:_dyld_get_image_name($0))}
    let forbidden=["libcccreator.dylib","liblens.dylib","libAGFX.dylib","libbytenn.dylib"]
    let privateImages=images.filter{forbidden.contains(URL(fileURLWithPath:$0).lastPathComponent)}
    try require(privateImages.isEmpty,"independent composite loaded private effect libraries")
    try output.write(to:root.appendingPathComponent("output.rgba"))
    let receipt:[String:Any]=["gpu":device.name,"images":images,"private_native_images":privateImages,
        "pixelFormat":"RGBA8Unorm","networkNormalization":"half-fma","screenUv":"vertex-interpolated"]
    try JSONSerialization.data(withJSONObject:receipt,options:[.sortedKeys]).write(to:root.appendingPathComponent("gpu.json"))
}
do { try run() } catch { fputs("\(error)\n",stderr);exit(1) }
