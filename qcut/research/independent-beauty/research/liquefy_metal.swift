import Foundation
import MachO
import Metal

struct LocalPass: Decodable {
    let maskWidth: Int
    let maskHeight: Int
    let mask: String
    let vertices: String
    let indices: String
    let steps: String
    let stepCount: Int
    let intensity: Float
    let quadratic: Bool
}
struct Request: Decodable {
    let width: Int
    let height: Int
    let input: String
    let passes: [LocalPass]
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
struct Vertex { float position[2]; float original[2]; float mask[2]; };
struct Step { float start[2]; float end[2]; float action; float strength; float radius; };
struct Field { float4 position [[position]]; float2 original; float2 displaced; float2 mask; };
struct CoordinatePixel { float4 packed [[color(0)]]; float4 coverage [[color(1)]]; };
vertex Field localVertex(uint index [[vertex_id]], constant Vertex* vertices [[buffer(0)]],
                         constant Step* steps [[buffer(1)]], constant float* parameters [[buffer(2)]]) {
    Vertex v=vertices[index]; Field result;
    result.position=float4(v.position[0],-v.position[1],0.5,1);
    result.original=float2(v.original[0],v.original[1]);
    float2 dimensions=float2(parameters[0],parameters[1]);
    float2 coordinate=result.original*dimensions;
    for (uint i=0;i<uint(parameters[3]);i++) {
        Step step=steps[i];
        float2 start=float2(step.start[0],step.start[1]),end=float2(step.end[0],step.end[1]);
        float2 center=step.action==0?start:end, relative=coordinate-center;
        float distance=length(relative),weight=distance/step.radius;
        if (step.action==0) {
            coordinate-=((end-start)*clamp(1-weight,0.0,1.0))*step.strength;
        } else if (step.action==1) {
            float factor=parameters[4]>0?clamp(1-step.strength*(1-weight*weight),0.0,1.0)
                :1-step.strength*clamp(1-distance/(step.radius*1.2),0.0,1.0);
            coordinate=center+relative*factor;
        } else {
            coordinate=center+relative/clamp(1-step.strength*(1-weight*weight),0.0001,1.0);
        }
    }
    result.displaced=result.original+(coordinate/dimensions-result.original)*parameters[2];
    result.mask=float2(v.mask[0],v.mask[1]); return result;
}
float4 sampleCoordinates(texture2d<float,access::read> packed,float2 uv) {
    float2 grid=uv*512.0-0.5,weight=fract(grid);
    int2 lower=int2(floor(grid)),upper=clamp(lower+1,int2(0),int2(511));
    lower=clamp(lower,int2(0),int2(511));
    float4 a=packed.read(uint2(lower)),b=packed.read(uint2(lower.x,upper.y));
    float4 c=packed.read(uint2(upper.x,lower.y)),d=packed.read(uint2(upper));
    return (((a*(1-weight.x))*(1-weight.y)+(b*(1-weight.x))*weight.y)
                    +(c*weight.x)*(1-weight.y))+(d*weight.x)*weight.y;
}
fragment CoordinatePixel coordinateFragment(Field field [[stage_in]], texture2d<float,access::read> previousTexture [[texture(0)]],
                                  texture2d<float> mask [[texture(1)]]) {
    constexpr sampler linear(coord::normalized,address::clamp_to_edge,filter::linear);
    float amount=mask.sample(linear,field.mask).r;
    float2 coordinate=mix(field.original,field.displaced,amount);
    float4 channels=sampleCoordinates(previousTexture,coordinate);
    float2 previous=float2(channels.r+channels.g/255.0,channels.b+channels.a/255.0);
    float2 scaled=((previous+coordinate)-field.original)*255.0;
    float2 whole=floor(scaled);
    CoordinatePixel pixel;
    pixel.packed=float4(whole.x/255.0,scaled.x-whole.x,whole.y/255.0,scaled.y-whole.y);
    pixel.coverage=float4(1); return pixel;
}
struct PhotoField { float4 position [[position]]; float2 uv; };
vertex PhotoField photoVertex(uint index [[vertex_id]]) {
    const float2 positions[6]={float2(-1,-1),float2(1,-1),float2(1,1),float2(-1,-1),float2(1,1),float2(-1,1)};
    PhotoField field; field.position=float4(positions[index],0.5,1);field.uv=(positions[index]+1)*0.5;return field;
}
fragment CoordinatePixel transport(PhotoField field [[stage_in]],texture2d<float,access::read> packed [[texture(0)]],
                      texture2d<float> source [[texture(1)]]) {
    float2 uv=field.uv;
    float4 channels=sampleCoordinates(packed,uv);
    float2 delta=float2(channels.r+channels.g/255.0,channels.b+channels.a/255.0)-0.5;
    delta=sign(delta)*max(abs(delta)-1.0/65536.0,0.0);
    float2 coordinate=uv+delta; coordinate.y=1-coordinate.y;
    constexpr sampler linear(coord::normalized,address::clamp_to_edge,filter::linear);
    CoordinatePixel result; result.packed=source.sample(linear,coordinate);result.coverage=float4(1);return result;
}
"""

func run() throws {
    try require(CommandLine.arguments.count == 2, "one local render request required")
    let requestURL=URL(fileURLWithPath:CommandLine.arguments[1]).resolvingSymlinksInPath()
    let root=requestURL.deletingLastPathComponent()
    let requestSize=try FileManager.default.attributesOfItem(atPath:requestURL.path)[.size] as? NSNumber
    try require((requestSize?.intValue ?? Int.max)<=32768, "bounded local request required")
    let request=try JSONDecoder().decode(Request.self,from:Data(contentsOf:requestURL))
    try require((1...1280).contains(request.width) && (1...1280).contains(request.height), "bounded image dimensions required")
    try require((1...6).contains(request.passes.count), "one to six local passes required")
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
    pipelineDescriptor.colorAttachments[1].pixelFormat = .rgba8Unorm
    let coordinatePipeline=try device.makeRenderPipelineState(descriptor:pipelineDescriptor)
    let photoDescriptor=MTLRenderPipelineDescriptor()
    photoDescriptor.vertexFunction=library.makeFunction(name:"photoVertex")
    photoDescriptor.fragmentFunction=library.makeFunction(name:"transport")
    photoDescriptor.colorAttachments[0].pixelFormat = .rgba8Unorm
    photoDescriptor.colorAttachments[1].pixelFormat = .rgba8Unorm
    let transportPipeline=try device.makeRenderPipelineState(descriptor:photoDescriptor)
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
    let neutral=try texture(512,512,[.shaderRead])
    let neutralBytes=Data((0..<512*512*4).map { $0%2==0 ? UInt8(127) : UInt8(128) })
    neutralBytes.withUnsafeBytes { neutral.replace(region:MTLRegionMake2D(0,0,512,512),mipmapLevel:0,withBytes:$0.baseAddress!,bytesPerRow:512*4) }
    let output=try texture(request.width,request.height,[.renderTarget])
    let photoCoverage=try texture(request.width,request.height,[.renderTarget])
    guard let command=queue.makeCommandBuffer() else { throw RenderError(description:"Metal command unavailable") }
    var previous=neutral
    var coverages:[MTLTexture]=[]
    for local in request.passes {
        try require((1...1024).contains(local.maskWidth) && (1...1024).contains(local.maskHeight), "bounded mask dimensions required")
        try require((1...40).contains(local.stepCount) && local.intensity.isFinite && local.intensity>0 && local.intensity<=1.3,"bounded local steps required")
        let mask=try uploaded(local.mask,local.maskWidth,local.maskHeight)
        let packed=try texture(512,512,[.shaderRead,.renderTarget])
        let coverage=try texture(512,512,[.renderTarget])
        let vertices=try readBytes(local.vertices,2270*24,root),indices=try readBytes(local.indices,4472*6,root)
        let steps=try readBytes(local.steps,local.stepCount*28,root)
        try require(vertices.withUnsafeBytes { $0.bindMemory(to:Float.self).allSatisfy { $0.isFinite && abs($0)<=32768 } }, "finite local vertices required")
        try require(indices.withUnsafeBytes { $0.bindMemory(to:UInt16.self).allSatisfy { $0<2270 } }, "local index out of range")
        try require(steps.withUnsafeBytes { $0.bindMemory(to:Float.self).enumerated().allSatisfy {
            $0.element.isFinite && ($0.offset % 7 != 4 || [Float(0),1,2].contains($0.element)) && ($0.offset % 7 != 6 || $0.element>0)
        } },"invalid local deformation step")
        guard let vertexBuffer=vertices.withUnsafeBytes({ device.makeBuffer(bytes:$0.baseAddress!,length:$0.count,options:.storageModeShared) }),
              let indexBuffer=indices.withUnsafeBytes({ device.makeBuffer(bytes:$0.baseAddress!,length:$0.count,options:.storageModeShared) }),
              let stepBuffer=steps.withUnsafeBytes({ device.makeBuffer(bytes:$0.baseAddress!,length:$0.count,options:.storageModeShared) }) else { throw RenderError(description:"Metal buffers unavailable") }
        let pass=MTLRenderPassDescriptor();pass.colorAttachments[0].texture=packed
        pass.colorAttachments[0].loadAction = .clear;pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[1].texture=coverage
        pass.colorAttachments[1].loadAction = .clear;pass.colorAttachments[1].storeAction = .store
        guard let encoder=command.makeRenderCommandEncoder(descriptor:pass) else { throw RenderError(description:"Metal render encoder unavailable") }
        encoder.setRenderPipelineState(coordinatePipeline);encoder.setCullMode(.none)
        encoder.setVertexBuffer(vertexBuffer,offset:0,index:0)
        encoder.setFragmentTexture(previous,index:0);encoder.setFragmentTexture(mask,index:1)
        encoder.setVertexBuffer(stepBuffer,offset:0,index:1)
        var parameters:[Float]=[Float(request.width),Float(request.height),local.intensity,Float(local.stepCount),local.quadratic ? 1 : 0]
        encoder.setVertexBytes(&parameters,length:parameters.count*4,index:2)
        encoder.drawIndexedPrimitives(type:.triangle,indexCount:4472*3,indexType:.uint16,indexBuffer:indexBuffer,indexBufferOffset:0)
        encoder.endEncoding()
        previous=packed
        coverages.append(coverage)
    }
    let photoPass=MTLRenderPassDescriptor();photoPass.colorAttachments[0].texture=output
    photoPass.colorAttachments[0].loadAction = .clear;photoPass.colorAttachments[0].storeAction = .store
    photoPass.colorAttachments[1].texture=photoCoverage
    photoPass.colorAttachments[1].loadAction = .clear;photoPass.colorAttachments[1].storeAction = .store
    guard let photo=command.makeRenderCommandEncoder(descriptor:photoPass) else { throw RenderError(description:"Metal photo encoder unavailable") }
    photo.setRenderPipelineState(transportPipeline);photo.setCullMode(.none)
    photo.setFragmentTexture(previous,index:0);photo.setFragmentTexture(source,index:1)
    photo.drawPrimitives(type:.triangle,vertexStart:0,vertexCount:6)
    photo.endEncoding();command.commit();command.waitUntilCompleted()
    if let error=command.error { throw error }
    for coverage in coverages {
        var coveredPixels=Data(count:512*512*4)
        coveredPixels.withUnsafeMutableBytes { coverage.getBytes($0.baseAddress!,bytesPerRow:512*4,from:MTLRegionMake2D(0,0,512,512),mipmapLevel:0) }
        try require(coveredPixels.allSatisfy { $0==255 },"local support did not cover the coordinate texture")
    }
    var photoCoveredPixels=Data(count:request.width*request.height*4)
    photoCoveredPixels.withUnsafeMutableBytes { photoCoverage.getBytes($0.baseAddress!,bytesPerRow:request.width*4,from:MTLRegionMake2D(0,0,request.width,request.height),mipmapLevel:0) }
    try require(photoCoveredPixels.allSatisfy { $0==255 },"photo quad did not cover the output frame")
    var pixels=Data(count:request.width*request.height*4)
    pixels.withUnsafeMutableBytes { output.getBytes($0.baseAddress!,bytesPerRow:request.width*4,from:MTLRegionMake2D(0,0,request.width,request.height),mipmapLevel:0) }
    try pixels.write(to:outputURL)
    let names=(0..<_dyld_image_count()).map { String(cString:_dyld_get_image_name($0)) }
    let forbidden=["libcccreator.dylib","liblens.dylib","libAGFX.dylib","libbytenn.dylib"]
    let privateImages=names.filter { forbidden.contains(URL(fileURLWithPath:$0).lastPathComponent) }
    try require(privateImages.isEmpty,"independent local Metal process loaded private libraries")
    let receipt:[String:Any]=["gpu":device.name,"images":names,"private_native_images":privateImages,"pixelFormat":"RGBA8Unorm","coordinateTextureSize":512,"coveredCoordinatePixels":512*512,"coordinatePassCount":request.passes.count,"photoSamplePassCount":1,"coveredPhotoPixels":request.width*request.height,"photoTransport":"fullscreen-raster-fragment"]
    try JSONSerialization.data(withJSONObject:receipt,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:request.output+".json"))
}
do { try run() }
catch { FileHandle.standardError.write(Data("\(error)\n".utf8)); exit(1) }
