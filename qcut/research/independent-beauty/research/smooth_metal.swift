import Foundation
import MachO
import Metal

struct TextureSpec: Decodable { let path: String; let width: Int; let height: Int }
struct MeshSpec: Decodable { let vertices: String; let indices: String }
struct Request: Decodable {
    let source: TextureSpec
    let skin: TextureSpec
    let face: TextureSpec
    let cube: TextureSpec
    let mesh: MeshSpec?
    let strength: Float
    let output: String
    let stages: Bool
}
struct RenderError: Error, CustomStringConvertible { let description: String }
func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw RenderError(description: message) }
}

let shaderSource = """
#include <metal_stdlib>
using namespace metal;
struct Pixel { float4 position [[position]]; float2 uv; float2 skinUv; };
struct LinePixel { float4 position [[position]]; float2 uv; float4 pair1; float4 pair2; float4 pair3; float4 pair4; };
struct FrameInput { float3 position [[attribute(0)]]; float2 uv [[attribute(1)]]; };
struct Settings { float strength; float hasFace; float widthStep; float heightStep; };
vertex Pixel frameVertex(FrameInput input [[stage_in]]) {
    Pixel o; o.position=float4(input.position.xy,(input.position.z+1)*0.5,1);
    o.uv=input.uv; o.skinUv=float2(input.uv.x,1-input.uv.y); return o;
}
vertex LinePixel lineVertex(FrameInput input [[stage_in]],constant float2& direction [[buffer(0)]]) {
    LinePixel o; o.position=float4(input.position.xy,(input.position.z+1)*0.5,1); o.uv=input.uv;
    float2 step=direction*2.5f;
    o.pair1=float4(o.uv-step,o.uv+step);
    o.pair2=float4(o.uv-step*2,o.uv+step*2);
    o.pair3=float4(o.uv-step*3,o.uv+step*3);
    o.pair4=float4(o.uv-step*4,o.uv+step*4); return o;
}
vertex Pixel faceVertex(uint index [[vertex_id]],constant float4* vertices [[buffer(0)]],constant float2& scale [[buffer(1)]]) {
    float4 v=vertices[index]; Pixel o;
    o.position=float4(v.xy*scale+float2(-1,1),0.5,1); o.uv=v.zw; o.skinUv=v.zw; return o;
}
constexpr sampler sampleEdge(coord::normalized,address::clamp_to_edge,filter::linear);
fragment float4 facePixel(Pixel p [[stage_in]],texture2d<float> face [[texture(0)]]) {
    return float4(face.sample(sampleEdge,p.uv).rgb,1);
}
float2 hueAndValue(float3 c) {
    bool gFirst=c.g>=c.b;
    float hi=gFirst?c.g:c.b, lo=gFirst?c.b:c.g;
    bool rFirst=c.r>=hi;
    float maximum=rFirst?c.r:hi;
    float other=rFirst?hi:c.r;
    float base=rFirst?(gFirst?0.0f:-1.0f):(gFirst?-0.33333f:0.66667f);
    float hue=abs(base+(other-lo)/(6*(maximum-min(other,lo))+1e-10f));
    return float2(hue,maximum);
}
fragment float4 controlPixel(Pixel p [[stage_in]],constant Settings& u [[buffer(0)]],
    texture2d<float> source [[texture(0)]],texture2d<float> skin [[texture(1)]],texture2d<float> face [[texture(2)]]) {
    float2 sourceUv=float2(p.uv.x,1-p.uv.y);
    float alpha=skin.sample(sampleEdge,p.skinUv).a;
    if(u.hasFace==0)return float4(0,0,alpha,alpha*u.strength);
    float2 hsv=hueAndValue(source.sample(sampleEdge,sourceUv).rgb);
    float coverage=((hsv.x>=0.1f&&hsv.x<=0.89f)||hsv.y<=0.3f)?0.0f:1.0f;
    if(hsv.y>0.3f&&hsv.y<0.32f)coverage=min(coverage,(0.32f-hsv.y)*50);
    float3 mask=face.sample(sampleEdge,p.uv).rgb;
    float area=mask.g>=0.1f?mask.g:alpha;
    return float4(mask.r,mask.g,min(mask.b,coverage),area*u.strength);
}
float4 lineSample(texture2d<float> source,LinePixel p,bool vertical) {
    float2 centerUv=vertical?p.uv:float2(p.uv.x,1-p.uv.y);
    float4 center=source.sample(sampleEdge,centerUv);
    float3 total=center.rgb*0.18f;
    float mass=0.18f, greens=center.g;
    const float weights[4]={0.15f,0.12f,0.09f,0.05f};
    const float4 pairs[4]={p.pair1,p.pair2,p.pair3,p.pair4};
    for(uint radius=1;radius<=4;++radius) {
        for(uint side=0;side<2;++side) {
            float2 coordinate=side==0?pairs[radius-1].xy:pairs[radius-1].zw;
            if(!vertical)coordinate.y=1-coordinate.y;
            float3 c=source.sample(sampleEdge,coordinate).rgb;
            float w=weights[radius-1]*(1-min(distance(center.rgb,c)*5.2486386f,1.0f));
            mass+=w; total+=c*w; greens+=c.g;
        }
    }
    float3 color=center.rgb;
    if(mass>=0.5f)color=total/mass;
    else if(mass>=0.4f)color=mix(center.rgb,total/mass,(mass-0.4f)/0.1f);
    float alpha=greens*0.1111f;
    if(vertical) { float contrast=(center.g-alpha)*7.07f; alpha=min(contrast*contrast,1.0f); }
    return float4(color,alpha);
}
fragment float4 horizontalPixel(LinePixel p [[stage_in]],constant Settings& u [[buffer(0)]],
    texture2d<float> source [[texture(0)]],texture2d<float> control [[texture(1)]]) {
    if(control.sample(sampleEdge,p.uv).a<=0.1f)return source.sample(sampleEdge,float2(p.uv.x,1-p.uv.y));
    return lineSample(source,p,false);
}
fragment float4 verticalPixel(LinePixel p [[stage_in]],constant Settings& u [[buffer(0)]],
    texture2d<float> source [[texture(0)]],texture2d<float> control [[texture(1)]]) {
    if(control.sample(sampleEdge,p.uv).a<=0.1f)return source.sample(sampleEdge,p.uv);
    return lineSample(source,p,true);
}
float2 tileCoordinate(float blue,float2 rg) {
    float row=floor(blue/8), column=blue-row*8;
    return float2(column,row)*0.125f+0.0009765625f+rg*0.123046875f;
}
float3 brighten(float3 color,texture2d<float> cube) {
    float blue=color.b*63;
    return mix(cube.sample(sampleEdge,tileCoordinate(floor(blue),color.rg)).rgb,
               cube.sample(sampleEdge,tileCoordinate(ceil(blue),color.rg)).rgb,fract(blue));
}
fragment float4 correctionPixel(Pixel p [[stage_in]],texture2d<float> source [[texture(0)]],
    texture2d<float> filtered [[texture(1)]],texture2d<float> control [[texture(2)]],texture2d<float> cube [[texture(3)]]) {
    float4 original=source.sample(sampleEdge,float2(p.uv.x,1-p.uv.y)), blur=filtered.sample(sampleEdge,p.uv);
    float area=control.sample(sampleEdge,p.uv).b;
    float3 color=original.rgb;
    if(area>0.005f) {
        float contrast=length(max(blur.rgb-original.rgb,float3(0)))*28.86751f;
        if(contrast>0.5f&&contrast<5)color=mix(color,brighten(color,cube),area*(0.0889f*contrast+0.355f));
    }
    return float4(color,blur.a);
}
void includeColor(thread float4& sum,float3 center,texture2d<float> source,float2 coordinate,float factor) {
    float3 c=source.sample(sampleEdge,coordinate).rgb;
    float d=c.g-center.g, weight=1-min((d*d)*factor,1.0f);
    sum.rgb+=c*weight; sum.a+=weight;
}
fragment float4 broadPixel(Pixel p [[stage_in]],constant Settings& u [[buffer(0)]],
    texture2d<float> source [[texture(0)]],texture2d<float> control [[texture(1)]]) {
    float3 center=source.sample(sampleEdge,p.uv).rgb;
    if(control.sample(sampleEdge,p.uv).a<=0.1f)return float4(center,1);
    const float2 ring[4]={float2(5,0),float2(0,5),float2(3,4),float2(4,3)};
    float4 total=0;
    // Fixed sample coordinates must fold before RGBA8 rounding.
    #pragma clang loop unroll(full)
    for(uint radius=0;radius<3;++radius) {
        float2 unit=float2(u.widthStep,u.heightStep)*0.45f;
        float2 stepSize=radius<2?unit*0.6f:unit;
        float coordinateScale=radius==0?1.0f:radius==1?2.0f:4.0f;
        #pragma clang loop unroll(full)
        for(uint spoke=0;spoke<4;++spoke) {
            float2 delta=stepSize*(ring[spoke]*coordinateScale);
            includeColor(total,center,source,p.uv+delta,u.hasFace);
            if(spoke==0)includeColor(total,center,source,p.uv+float2(-delta.x,delta.y),u.hasFace);
            else if(spoke==1)includeColor(total,center,source,p.uv+float2(delta.x,-delta.y),u.hasFace);
            else {
                includeColor(total,center,source,p.uv+float2(-delta.x,delta.y),u.hasFace);
                includeColor(total,center,source,p.uv+float2(delta.x,-delta.y),u.hasFace);
                includeColor(total,center,source,p.uv-delta,u.hasFace);
            }
        }
    }
    total.rgb+=center; total.a+=1;
    return float4(total.rgb/total.a,1);
}
fragment float4 outputPixel(Pixel p [[stage_in]],texture2d<float> source [[texture(0)]],
    texture2d<float> corrected [[texture(1)]],texture2d<float> broad [[texture(2)]],
    texture2d<float> repeated [[texture(3)]],texture2d<float> control [[texture(4)]],texture2d<float> skin [[texture(5)]]) {
    float2 sourceUv=float2(p.uv.x,1-p.uv.y);
    float4 original=source.sample(sampleEdge,sourceUv), color=corrected.sample(sampleEdge,p.uv);
    float3 first=broad.sample(sampleEdge,p.uv).rgb, second=repeated.sample(sampleEdge,p.uv).rgb;
    float4 mask=control.sample(sampleEdge,p.uv);
    float alpha=skin.sample(sampleEdge,p.skinUv).a;
    float varianceGate=1-color.a/(color.a+0.5f);
    float area=(mask.g>=0.005f?mask.b:alpha)*alpha*varianceGate;
    float3 detail=(color.rgb-first)/2+0.5f;
    float3 even=clamp((second+detail*2)-1,0.0f,1.0f);
    even=mix(color.rgb,even,area);
    float extra=(mask.a>=0.6f?mask.a-0.3f:0.3f)*area;
    even=mix(even,second,extra);
    float amount=mask.a>=0.6f?1.0f:mask.a*1.67f;
    return float4(mix(original.rgb,even,amount),original.a);
}
"""

func run() throws {
    try require(CommandLine.arguments.count == 2,"one smoothing request required")
    let requestURL=URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
    let root=requestURL.deletingLastPathComponent()
    let size=try FileManager.default.attributesOfItem(atPath: requestURL.path)[.size] as? NSNumber
    try require((size?.intValue ?? Int.max)<=8192,"bounded smoothing request required")
    let request=try JSONDecoder().decode(Request.self,from: Data(contentsOf: requestURL))
    let width=request.source.width, height=request.source.height
    try require((1...1280).contains(width)&&(1...1280).contains(height),"bounded source dimensions required")
    try require(request.strength.isFinite&&(0...1).contains(request.strength),"unit smoothing strength required")
    try require(request.cube.width==512&&request.cube.height==512,"512-square smoothing cube required")
    try require(request.face.width==256&&request.face.height==256,"256-square face mask required")
    try require((1...512).contains(request.skin.width)&&(1...512).contains(request.skin.height),"bounded skin texture required")
    let output=URL(fileURLWithPath: request.output).resolvingSymlinksInPath()
    try require(output.deletingLastPathComponent()==root,"private output prefix required")
    guard let device=MTLCreateSystemDefaultDevice(),let queue=device.makeCommandQueue() else {
        throw RenderError(description:"Metal device unavailable")
    }
    func bytes(_ path: String,_ count: Int) throws -> Data {
        let file=URL(fileURLWithPath:path).resolvingSymlinksInPath()
        try require(file.deletingLastPathComponent()==root,"render files must share request directory")
        let size=try FileManager.default.attributesOfItem(atPath:file.path)[.size] as? NSNumber
        try require(size?.intValue==count,"render byte count mismatch")
        return try Data(contentsOf:file)
    }
    func texture(_ w: Int,_ h: Int) throws -> MTLTexture {
        let d=MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.rgba8Unorm,width:w,height:h,mipmapped:false)
        d.storageMode = .shared; d.usage=[.shaderRead,.renderTarget]
        guard let t=device.makeTexture(descriptor:d) else {throw RenderError(description:"texture allocation failed")}
        return t
    }
    func load(_ spec: TextureSpec) throws -> MTLTexture {
        let t=try texture(spec.width,spec.height), data=try bytes(spec.path,spec.width*spec.height*4)
        data.withUnsafeBytes {t.replace(region:MTLRegionMake2D(0,0,spec.width,spec.height),mipmapLevel:0,withBytes:$0.baseAddress!,bytesPerRow:spec.width*4)}
        return t
    }
    let source=try load(request.source),skin=try load(request.skin),face=try load(request.face),cube=try load(request.cube)
    let reducedWidth=max(1,Int(Double(width)*0.45)),reducedHeight=max(1,Int(Double(height)*0.45))
    let library=try device.makeLibrary(source:shaderSource,options:nil)
    func pipeline(_ name: String,_ vertex: String="frameVertex") throws -> MTLRenderPipelineState {
        let d=MTLRenderPipelineDescriptor(); d.vertexFunction=library.makeFunction(name:vertex)
        d.fragmentFunction=library.makeFunction(name:name); d.colorAttachments[0].pixelFormat = .rgba8Unorm
        if vertex != "faceVertex" {
            let layout=MTLVertexDescriptor()
            layout.attributes[0].format = .float3; layout.attributes[0].offset=0; layout.attributes[0].bufferIndex=30
            layout.attributes[1].format = .float2; layout.attributes[1].offset=12; layout.attributes[1].bufferIndex=30
            layout.layouts[30].stride=20; d.vertexDescriptor=layout
        }
        return try device.makeRenderPipelineState(descriptor:d)
    }
    func read(_ image: MTLTexture,_ path: String,_ rowsAreBottomToTop: Bool = true) throws {
        var data=Data(count:image.width*image.height*4)
        data.withUnsafeMutableBytes {image.getBytes($0.baseAddress!,bytesPerRow:image.width*4,from:MTLRegionMake2D(0,0,image.width,image.height),mipmapLevel:0)}
        var imageRows=Data(count:data.count)
        imageRows.withUnsafeMutableBytes {destination in data.withUnsafeBytes {source in
            let rowBytes=image.width*4
            for y in 0..<image.height {
                memcpy(destination.baseAddress!.advanced(by:y*rowBytes),
                    source.baseAddress!.advanced(by:(rowsAreBottomToTop ? image.height-1-y : y)*rowBytes),rowBytes)
            }
        }}
        try imageRows.write(to:URL(fileURLWithPath:path))
    }
    var stageNames:[String]=[]
    func draw(_ name: String,_ target: MTLTexture,_ inputs: [MTLTexture],_ settings: [Float],_ mesh: MeshSpec?=nil) throws {
        guard let command=queue.makeCommandBuffer() else {throw RenderError(description:"command allocation failed")}
        let render=MTLRenderPassDescriptor(); render.colorAttachments[0].texture=target
        render.colorAttachments[0].loadAction = .clear; render.colorAttachments[0].storeAction = .store
        render.colorAttachments[0].clearColor = MTLClearColor(red:0,green:0,blue:0,alpha:0)
        guard let encoder=command.makeRenderCommandEncoder(descriptor:render) else {throw RenderError(description:"encoder allocation failed")}
        let isLine=name=="horizontalPixel" || name=="verticalPixel"
        encoder.setRenderPipelineState(try pipeline(name,mesh != nil ? "faceVertex":isLine ? "lineVertex":"frameVertex")); encoder.setCullMode(.none)
        let isOutput=name=="outputPixel"
        // Mirroring the final raster and flipping its bytes changes UNORM rounding.
        encoder.setViewport(MTLViewport(originX:0,originY:isOutput ? 0:Double(target.height),width:Double(target.width),height:isOutput ? Double(target.height):-Double(target.height),znear:0,zfar:1))
        if isLine {
            let direction:[Float]=name=="horizontalPixel" ? [settings[2],0]:[0,settings[3]]
            direction.withUnsafeBytes {encoder.setVertexBytes($0.baseAddress!,length:$0.count,index:0)}
        }
        for (i,t) in inputs.enumerated() {encoder.setFragmentTexture(t,index:i)}
        settings.withUnsafeBytes {encoder.setFragmentBytes($0.baseAddress!,length:$0.count,index:0)}
        if let mesh {
            let vertexData=try bytes(mesh.vertices,145*16),indexData=try bytes(mesh.indices,768*2)
            try require(vertexData.withUnsafeBytes {$0.bindMemory(to:Float.self).allSatisfy {$0.isFinite&&abs($0)<=32768}},"finite bounded face vertices required")
            try require(indexData.withUnsafeBytes {$0.bindMemory(to:UInt16.self).allSatisfy {$0<145}},"face index out of range")
            guard let vb=vertexData.withUnsafeBytes({device.makeBuffer(bytes:$0.baseAddress!,length:$0.count,options:.storageModeShared)}),
                  let ib=indexData.withUnsafeBytes({device.makeBuffer(bytes:$0.baseAddress!,length:$0.count,options:.storageModeShared)}) else {throw RenderError(description:"face buffer allocation failed")}
            encoder.setVertexBuffer(vb,offset:0,index:0)
            [Float(2/Double(width)),Float(-2/Double(height))].withUnsafeBytes {encoder.setVertexBytes($0.baseAddress!,length:$0.count,index:1)}
            encoder.drawIndexedPrimitives(type:.triangle,indexCount:768,indexType:.uint16,indexBuffer:ib,indexBufferOffset:0)
        } else {
            // Attribute UVs preserve offset rounding before interpolation.
            let frame:[Float]=[-1,-1,0,0,0,3,-1,0,2,0,-1,3,0,0,2]
            frame.withUnsafeBytes {encoder.setVertexBytes($0.baseAddress!,length:$0.count,index:30)}
            encoder.drawPrimitives(type:.triangle,vertexStart:0,vertexCount:3)
        }
        encoder.endEncoding(); command.commit(); command.waitUntilCompleted()
        if let error=command.error {throw error}
        try require(command.status == .completed,"GPU smoothing pass did not complete")
        stageNames.append(name)
        if request.stages {try read(target,request.output+"."+String(stageNames.count)+"."+name+".rgba",!isOutput)}
    }
    let mask=try texture(reducedWidth,reducedHeight)
    let u:[Float]=[request.strength,request.mesh == nil ? 0:1,1/Float(reducedWidth),1/Float(reducedHeight)]
    if let mesh=request.mesh {try draw("facePixel",mask,[face],u,mesh)}
    let control=try texture(reducedWidth,reducedHeight)
    try draw("controlPixel",control,[source,skin,mask],u)
    let horizontal=try texture(reducedWidth,reducedHeight)
    try draw("horizontalPixel",horizontal,[source,control],u)
    let vertical=try texture(reducedWidth,reducedHeight)
    try draw("verticalPixel",vertical,[horizontal,control],u)
    let corrected=try texture(width,height)
    try draw("correctionPixel",corrected,[source,vertical,control,cube],u)
    let broad=try texture(reducedWidth,reducedHeight),repeated=try texture(reducedWidth,reducedHeight)
    var first=u; first[1]=50
    var second=u; second[1]=25
    try draw("broadPixel",broad,[corrected,control],first)
    try draw("broadPixel",repeated,[broad,control],second)
    let result=try texture(width,height)
    try draw("outputPixel",result,[source,corrected,broad,repeated,control,skin],u)
    try read(result,output.path,false)
    let images=(0..<_dyld_image_count()).map {String(cString:_dyld_get_image_name($0))}
    let forbidden=["libcccreator","liblens","libAGFX","libbytenn","/runtime/Frameworks/","/JianyingPro.app/"]
    let privateImages=images.filter {path in forbidden.contains {path.contains($0)}}
    try require(privateImages.isEmpty,"independent smoothing loaded private effect libraries")
    let receipt:[String:Any]=["gpu":device.name,"private_native_images":privateImages,"images":images,
        "stages":stageNames,"reducedSize":[reducedWidth,reducedHeight],"hasFace":request.mesh != nil,
        "pixelFormat":"RGBA8Unorm","skinCoordinate":"source-u,source-v-top-zero",
        "skinReflectionStage":"vertex-before-interpolation",
        "framebufferRows":"intermediates-bottom-to-top,final-top-to-bottom","outputRows":"image-top-to-bottom",
        "outputViewport":"positive-height",
        "broadSampling":"compile-time-fixed-36-neighbors",
        "lineOffsetStage":"vertex-before-interpolation","originalReflectionStage":"fragment-after-interpolation"]
    try JSONSerialization.data(withJSONObject:receipt,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:request.output+".json"))
}
do {try run()}
catch {FileHandle.standardError.write(Data("\(error)\n".utf8));exit(1)}
