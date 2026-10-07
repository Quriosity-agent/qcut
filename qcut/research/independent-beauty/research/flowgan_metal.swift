import Foundation
import MachO
import Metal

struct Weight: Decodable {
  let path: String
  let bias: String
  let kernel: Int
  let stride: Int
  let pad: Int
  let depth: Bool
  let co: Int
  let ci: Int
}
struct Params: Decodable { let relu: Bool? }
struct Step: Decodable {
  let op: String
  let inputs: [String]
  let output: String
  let params: Params
}
struct Request: Decodable {
  let shapes: [String: [Int]]
  let steps: [Step]
  let weights: [String: Weight]
  let source: String
  let width: Int
  let height: Int
  let affine: [Float]
  let mvp: [Float]
  let intensity: Float
  let controlVector: [Float]?
  let flowEnabled: Bool?
  let maskWidth: Int
  let maskHeight: Int
}
let source = """
  #include <metal_stdlib>
  using namespace metal;
  struct P {int iw,ih,ic,ow,oh,oc,k,s,pad,relu,op;};
  kernel void conv(device const half4* input [[buffer(0)]],device half4* output [[buffer(1)]],constant P& p [[buffer(2)]],device const half4x4* weight [[buffer(3)]],device const half4* bias [[buffer(4)]],uint3 q [[thread_position_in_grid]]) {
   if(q.x>=p.ow||q.y>=p.oh||q.z>=p.oc)return;
   float4 sum=float4(bias[q.z]);
   for(int block=0;block<p.ic;block++)for(int y=0;y<p.k;y++)for(int x=0;x<p.k;x++){
   int ix=int(q.x)*p.s-p.pad+x,iy=int(q.y)*p.s-p.pad+y;if(ix<0||iy<0||ix>=p.iw||iy>=p.ih)continue;
   float4 v=float4(input[(block*p.ih+iy)*p.iw+ix]);float4x4 w=float4x4(weight[((q.z*p.ic+block)*p.k+y)*p.k+x]);sum+=v*w;
   }
   half4 value=half4(sum);if(p.relu)value=max(value,half4(0));output[(q.z*p.oh+q.y)*p.ow+q.x]=value;
  }
  kernel void pointConv(device const half4* input [[buffer(0)]],device half4* output [[buffer(1)]],constant P& p [[buffer(2)]],device const half4x4* weight [[buffer(3)]],device const half4* bias [[buffer(4)]],uint3 q [[thread_position_in_grid]]) {
   int at=int(q.x);if(at>=p.ow*p.oh||q.y>=p.oc)return;float4 value=float4(bias[q.y]);for(int i=0;i<p.ic;i++)value+=float4(input[i*p.iw*p.ih+at])*float4x4(weight[q.y*p.ic+i]);half4 result=half4(value);if(p.relu)result=max(result,half4(0));output[q.y*p.ow*p.oh+at]=result;
  }
  kernel void pointConvFour(device const half4* input [[buffer(0)]],device half4* output [[buffer(1)]],constant P& p [[buffer(2)]],device const half4x4* weight [[buffer(3)]],device const half4* bias [[buffer(4)]],uint3 q [[thread_position_in_grid]]){
   int at=int(q.x)*4,count=min(p.ow*p.oh-at,4);if(count<=0||q.y>=p.oc)return;float4 a=float4(bias[q.y]),b=a,c=a,d=a;
   for(int i=0;i<p.ic;i++){float4x4 m=float4x4(weight[q.y*p.ic+i]);int start=i*p.iw*p.ih+at;a+=(float4(input[start])*m);if(count>1)b+=(float4(input[start+1])*m);if(count>2)c+=(float4(input[start+2])*m);if(count>3)d+=(float4(input[start+3])*m);}
   half4 va=half4(a),vb=half4(b),vc=half4(c),vd=half4(d);if(p.relu){va=max(va,half4(0));vb=max(vb,half4(0));vc=max(vc,half4(0));vd=max(vd,half4(0));}int start=q.y*p.ow*p.oh+at;output[start]=va;if(count>1)output[start+1]=vb;if(count>2)output[start+2]=vc;if(count>3)output[start+3]=vd;
  }

  kernel void depth(device const half4* input [[buffer(0)]],device half4* output [[buffer(1)]],constant P& p [[buffer(2)]],device const half4* weight [[buffer(3)]],device const half4* bias [[buffer(4)]],uint3 q [[thread_position_in_grid]]){
   if(q.x>=p.ow||q.y>=p.oh||q.z>=p.oc)return;float4 sum=float4(bias[q.z]);
   for(int y=0;y<p.k;y++)for(int x=0;x<p.k;x++){int ix=int(q.x)*p.s-p.pad+x,iy=int(q.y)*p.s-p.pad+y;if(ix<0||iy<0||ix>=p.iw||iy>=p.ih)continue;half4 a=input[(q.z*p.ih+iy)*p.iw+ix],b=weight[(q.z*p.k+y)*p.k+x];sum+=float4(a*b);}
   half4 value=half4(sum);if(p.relu)value=max(value,half4(0));output[(q.z*p.oh+q.y)*p.ow+q.x]=value;
  }
  kernel void pointwise(device const half4* input [[buffer(0)]],device half4* output [[buffer(1)]],constant P& p [[buffer(2)]],device const half4* second [[buffer(3)]],uint3 q [[thread_position_in_grid]]){
   if(q.x>=p.ow||q.y>=p.oh||q.z>=p.oc)return;int at=(q.z*p.oh+q.y)*p.ow+q.x;half4 a=input[at],v;
   if(p.op==0)v=a+second[at];else if(p.op==1)v=a*second[q.z];else if(p.op==2)v=half4(1.0f/(1.0f+exp(-float4(a))));else v=half4(2.0f/(1.0f+exp(-2.0f*float4(a)))-1.0f);if(p.relu)v=max(v,half4(0));output[at]=v;
  }
  kernel void resize(device const half4* input [[buffer(0)]],device half4* output [[buffer(1)]],constant P& p [[buffer(2)]],uint3 q [[thread_position_in_grid]]){
   if(q.x>=p.ow||q.y>=p.oh||q.z>=p.oc)return;
   half fx=(float(q.x)+.5f)*(float(p.iw)/float(p.ow))-.5f,fy=(float(q.y)+.5f)*(float(p.ih)/float(p.oh))-.5f;int x=int(floor(fx)),y=int(floor(fy));fx-=x;fy-=y;if(x<0){x=0;fx=0;}else if(x>=p.iw-1){x=p.iw-1;fx=0;}if(y<0){y=0;fy=0;}else if(y>=p.ih-1){y=p.ih-1;fy=0;}
   half a=(1.0-fx)*(1.0-fy),b=(1.0-fx)*fy,c=fx*(1.0-fy),d=fx*fy;int at=(q.z*p.ih+y)*p.iw+x;half4 v=input[at];if(fx==0&&fy==0){}else if(fx==0)v=a*v+b*input[at+p.iw];else if(fy==0)v=a*v+c*input[at+1];else v=v*a+input[at+p.iw]*b+input[at+1]*c+input[at+p.iw+1]*d;output[(q.z*p.oh+q.y)*p.ow+q.x]=v;
  }
  kernel void cropInput(texture2d<float,access::read> original [[texture(0)]],device half4* output [[buffer(0)]],uint2 q [[thread_position_in_grid]]){if(q.x>=320||q.y>=320)return;output[q.y*320+q.x]=half4(original.read(q));}
  kernel void quantize(device const half4* gan [[buffer(0)]],device const half4* flow [[buffer(1)]],texture2d<float,access::write> gt [[texture(0)]],texture2d<float,access::write> ft [[texture(1)]],uint2 q [[thread_position_in_grid]]){if(q.x>=320||q.y>=320)return;gt.write(float4(gan[q.y*320+q.x])*.5f+.5f,q);ft.write(float4(flow[q.y*320+q.x])*(-.04212f*4.0f)+.5f,q);}
  struct U{float4x4 mvp;};struct V{float4 p [[position]];float2 uv;};
  vertex V faceVertex(uint id [[vertex_id]],constant U& u [[buffer(0)]]){float2 xy[4]={float2(-1,1),float2(-1,-1),float2(1,1),float2(1,-1)};float2 uv[4]={float2(0,0),float2(0,1),float2(1,0),float2(1,1)};V v;v.p=u.mvp*float4(xy[id],0,1);v.p.z=0;v.uv=uv[id];return v;}
  vertex V warpVertex(uint id [[vertex_id]]){float2 xy[6]={float2(-1,-1),float2(-1,1),float2(1,1),float2(1,-1),float2(-1,-1),float2(1,1)};float2 uv[6]={float2(0,1),float2(0,0),float2(1,0),float2(1,1),float2(0,1),float2(1,0)};V v;v.p=float4(xy[id],0,1);v.uv=uv[id];return v;}
  fragment float4 warpFragment(V v [[stage_in]],constant float* a [[buffer(0)]],texture2d<float> original [[texture(0)]]){constexpr sampler sm(coord::normalized,address::clamp_to_edge,filter::linear);float3x3 m(float3(a[0],a[3],0),float3(a[1],a[4],0),float3(a[2],a[5],1));float2 uv=(m*float3(v.uv,1)).xy;return original.sample(sm,uv)*2.0f-1.0f;}

  fragment float4 composite(V v [[stage_in]],constant U& u [[buffer(0)]],texture2d<float> gt [[texture(0)]],texture2d<float> ft [[texture(1)]],texture2d<float> mask [[texture(2)]],texture2d<float> source [[texture(3)]]){constexpr sampler sm(coord::normalized,address::clamp_to_edge,filter::linear);float weight=mask.sample(sm,v.uv).r;float2 uv=clamp(v.uv+(ft.sample(sm,v.uv).xy-.5f)*.125f*weight,0.0f,1.0f);float4 pos=u.mvp*(float4(uv*2-1,0,1)*float4(1,-1,1,1));float2 suv=pos.xy*.5f+.5f;suv.y=1-suv.y;float4 a=source.sample(sm,suv),b=gt.sample(sm,uv);return float4(mix(a.rgb,b.rgb,b.a*weight),a.a*weight);}
  // Separate entry point keeps the established displacement shader's GPU arithmetic intact.
  fragment float4 compositeStatic(V v [[stage_in]],constant U& u [[buffer(0)]],texture2d<float> gt [[texture(0)]],texture2d<float> ft [[texture(1)]],texture2d<float> mask [[texture(2)]],texture2d<float> source [[texture(3)]]){constexpr sampler sm(coord::normalized,address::clamp_to_edge,filter::linear);float weight=mask.sample(sm,v.uv).r;float2 uv=v.uv;float4 pos=u.mvp*(float4(uv*2-1,0,1)*float4(1,-1,1,1));float2 suv=pos.xy*.5f+.5f;suv.y=1-suv.y;float4 a=source.sample(sm,suv),b=gt.sample(sm,uv);return float4(mix(a.rgb,b.rgb,b.a*weight),a.a*weight);}

  """

struct RenderError: Error, CustomStringConvertible { let description: String }
func require(_ condition: Bool, _ message: String) throws {
  if !condition { throw RenderError(description: message) }
}
func run() throws {
  try require(CommandLine.arguments.count == 2, "one private FlowGAN request required")
  let url = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
  let root = url.deletingLastPathComponent()
  let size = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber
  try require((size?.intValue ?? Int.max) <= 65536, "bounded FlowGAN request required")
  let r = try JSONDecoder().decode(Request.self, from: Data(contentsOf: url))
  try require(
    (1...1280).contains(r.width) && (1...1280).contains(r.height),
    "bounded source dimensions required")
  try require(r.maskWidth == 320 && r.maskHeight == 320, "bounded mask required")
  try require(
    r.affine.count == 6 && r.mvp.count == 16
      && (r.affine + r.mvp).allSatisfy { $0.isFinite && abs($0) <= 32768 }, "finite camera required"
  )
  try require(
    r.intensity.isFinite && r.intensity > 0 && r.intensity <= 1, "active strength required")
  let controlVector = r.controlVector ?? [0, 0, r.intensity]
  try require(
    controlVector.count == 3 && controlVector.allSatisfy { $0.isFinite && $0 >= 0 && $0 <= 1 },
    "three normalized controls required")
  let flowEnabled = r.flowEnabled ?? true
  try require(
    r.steps.count == 86 && r.shapes.count == 86 && r.weights.count == 53, "bounded network required"
  )
  for shape in r.shapes.values {
    try require(
      shape.count == 4 && shape[0] == 1 && (1...320).contains(shape[1])
        && (1...320).contains(shape[2]) && (1...320).contains(shape[3]),
      "bounded feature dimensions required")
  }
  try require(
    r.shapes["data0"] == [1, 3, 320, 320] && r.shapes["data1"] == [1, 3, 1, 1]
      && r.shapes["Tanh_126"] == [1, 4, 320, 320] && r.shapes["Tanh_127"] == [1, 2, 320, 320],
    "bounded network endpoints required")
  guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue(),
    let cmd = queue.makeCommandBuffer()
  else { throw RenderError(description: "Metal unavailable") }
  func read(_ name: String, _ count: Int) throws -> Data {
    let file = root.appendingPathComponent(name).resolvingSymlinksInPath()
    try require(file.deletingLastPathComponent() == root, "private render directory required")
    let size = try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber
    try require(size?.intValue == count, "render byte count mismatch")
    return try Data(contentsOf: file)
  }
  let lib = try device.makeLibrary(source: source, options: nil)
  var pipes: [String: MTLComputePipelineState] = [:]
  for name in [
    "conv", "pointConv", "pointConvFour", "depth", "pointwise", "resize", "cropInput", "quantize",
  ] { pipes[name] = try device.makeComputePipelineState(function: lib.makeFunction(name: name)!) }
  var values: [String: MTLBuffer] = [:]
  var retained: [MTLBuffer] = []
  func load(_ name: String, _ count: Int) throws -> MTLBuffer {
    let data = try read(name, count)
    guard
      let result = data.withUnsafeBytes({
        device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared)
      })
    else { throw RenderError(description: "Metal buffer allocation failed") }
    return result
  }

  func texture(_ w: Int, _ h: Int, _ bytes: Data? = nil) -> MTLTexture {
    let d = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .rgba8Unorm, width: w, height: h, mipmapped: false)
    d.storageMode = .shared
    d.usage = [.shaderRead, .shaderWrite, .renderTarget]
    let t = device.makeTexture(descriptor: d)!
    if let b = bytes {
      b.withUnsafeBytes {
        t.replace(
          region: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0, withBytes: $0.baseAddress!,
          bytesPerRow: w * 4)
      }
    }
    return t
  }

  let original = try read(r.source, r.width * r.height * 4)
  let sourceTex = texture(r.width, r.height, original)
  let crop = device.makeBuffer(length: 320 * 320 * 8, options: .storageModeShared)!
  let wd = MTLTextureDescriptor.texture2DDescriptor(
    pixelFormat: .rgba32Float, width: 320, height: 320, mipmapped: false)
  wd.storageMode = .shared
  wd.usage = [.shaderRead, .renderTarget]
  let warpTex = device.makeTexture(descriptor: wd)!
  let warpOptions = MTLCompileOptions()
  warpOptions.mathMode = .safe
  let warpLibrary = try device.makeLibrary(source: source, options: warpOptions)
  let wp = MTLRenderPipelineDescriptor()
  wp.vertexFunction = warpLibrary.makeFunction(name: "warpVertex")
  wp.fragmentFunction = warpLibrary.makeFunction(name: "warpFragment")
  wp.colorAttachments[0].pixelFormat = .rgba32Float
  let wpipe = try device.makeRenderPipelineState(descriptor: wp)
  let wpass = MTLRenderPassDescriptor()
  wpass.colorAttachments[0].texture = warpTex
  wpass.colorAttachments[0].loadAction = .clear
  wpass.colorAttachments[0].storeAction = .store
  let ew = cmd.makeRenderCommandEncoder(descriptor: wpass)!
  ew.setRenderPipelineState(wpipe)
  ew.setFragmentTexture(sourceTex, index: 0)
  r.affine.withUnsafeBytes { ew.setFragmentBytes($0.baseAddress!, length: $0.count, index: 0) }
  ew.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6)
  ew.endEncoding()
  let ec = cmd.makeComputeCommandEncoder()!
  ec.setComputePipelineState(pipes["cropInput"]!)
  ec.setTexture(warpTex, index: 0)
  ec.setBuffer(crop, offset: 0, index: 0)
  ec.dispatchThreads(
    MTLSize(width: 320, height: 320, depth: 1),
    threadsPerThreadgroup: MTLSize(width: 8, height: 8, depth: 1))
  ec.endEncoding()
  values["data0"] = crop
  let latent: [Float16] = controlVector.map { Float16($0) } + [0]
  values["data1"] = latent.withUnsafeBytes {
    device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared)!
  }

  for (i, s) in r.steps.enumerated() {
    if s.op == "DataV2" { continue }
    try require(
      [
        "Convolution", "DepthwiseSeparableConvolution", "UpSampling", "Upsample", "Eltwise",
        "SEScale", "Sigmoid", "Tanh",
      ].contains(s.op) && (1...2).contains(s.inputs.count)
        && s.inputs.allSatisfy { values[$0] != nil && r.shapes[$0] != nil }
        && r.shapes[s.output] != nil && values[s.output] == nil, "ordered network required")
    let a = r.shapes[s.inputs[0]]!
    let o = r.shapes[s.output]!
    try require(
      s.op == "Convolution" || s.op == "DepthwiseSeparableConvolution" || a[1] == o[1],
      "compatible feature channels required")
    let out = device.makeBuffer(
      length: ((o[1] + 3) / 4) * o[2] * o[3] * 8, options: .storageModeShared)!
    let enc = cmd.makeComputeCommandEncoder()!
    var p: [Int32] = [
      Int32(a[3]), Int32(a[2]), Int32((a[1] + 3) / 4), Int32(o[3]), Int32(o[2]),
      Int32((o[1] + 3) / 4), 0, 0, 0, s.params.relu == true ? 1 : 0, 0,
    ]
    let name: String
    if let w = r.weights[String(i)] {
      try require(
        w.co == o[1] && w.ci == a[1] && (!w.depth || a[1] == o[1]),
        "compatible convolution channels required")
      try require(
        (a[2] + 2 * w.pad - w.kernel) / w.stride + 1 == o[2]
          && (a[3] + 2 * w.pad - w.kernel) / w.stride + 1 == o[3],
        "compatible convolution dimensions required")
      name =
        w.depth
        ? "depth" : w.kernel == 1 ? (o[2] * o[3] >= 64 ? "pointConvFour" : "pointConv") : "conv"
      p[6] = Int32(w.kernel)
      p[7] = Int32(w.stride)
      p[8] = Int32(w.pad)
      try require(
        [1, 3].contains(w.kernel) && [1, 2].contains(w.stride) && (0...1).contains(w.pad),
        "bounded convolution required")
      let count =
        w.depth
        ? ((o[1] + 3) / 4) * w.kernel * w.kernel * 8
        : ((o[1] + 3) / 4) * ((a[1] + 3) / 4) * w.kernel * w.kernel * 32
      let weight = try load(w.path, count)
      let bias = try load(w.bias, ((o[1] + 3) / 4) * 8)
      retained.append(contentsOf: [weight, bias])
      enc.setBuffer(weight, offset: 0, index: 3)
      enc.setBuffer(bias, offset: 0, index: 4)
    } else if s.op == "UpSampling" || s.op == "Upsample" {
      name = "resize"
    } else {
      name = "pointwise"
      p[10] = s.op == "Eltwise" ? 0 : s.op == "SEScale" ? 1 : s.op == "Sigmoid" ? 2 : 3
      try require(a[2] == o[2] && a[3] == o[3], "compatible pointwise dimensions required")
      if s.inputs.count == 2 {
        let b = r.shapes[s.inputs[1]]!
        try require(
          s.op == "Eltwise" ? b == a : s.op == "SEScale" && b[1] == a[1] && b[2] == 1 && b[3] == 1,
          "compatible binary operands required")
        enc.setBuffer(values[s.inputs[1]], offset: 0, index: 3)
      } else {
        enc.setBuffer(values[s.inputs[0]], offset: 0, index: 3)
      }
    }
    enc.setComputePipelineState(pipes[name]!)
    enc.setBuffer(values[s.inputs[0]], offset: 0, index: 0)
    enc.setBuffer(out, offset: 0, index: 1)
    p.withUnsafeBytes { enc.setBytes($0.baseAddress!, length: $0.count, index: 2) }
    let grid =
      name == "pointConvFour"
      ? MTLSize(width: (o[2] * o[3] + 3) / 4, height: (o[1] + 3) / 4, depth: 1)
      : name == "pointConv"
        ? MTLSize(width: o[2] * o[3], height: (o[1] + 3) / 4, depth: 1)
        : MTLSize(width: o[3], height: o[2], depth: (o[1] + 3) / 4)
    enc.dispatchThreads(grid, threadsPerThreadgroup: MTLSize(width: 8, height: 8, depth: 1))
    enc.endEncoding()
    values[s.output] = out
  }
  cmd.commit()
  cmd.waitUntilCompleted()
  if let e = cmd.error { throw e }
  let ganTex = texture(320, 320)
  let flowTex = texture(320, 320)
  let maskTex = texture(r.maskWidth, r.maskHeight, try read("mask.rgba", 320 * 320 * 4))
  let target = texture(r.width, r.height, original)
  let second = queue.makeCommandBuffer()!
  let eq = second.makeComputeCommandEncoder()!
  eq.setComputePipelineState(pipes["quantize"]!)
  eq.setBuffer(values["Tanh_126"], offset: 0, index: 0)
  eq.setBuffer(values["Tanh_127"], offset: 0, index: 1)
  eq.setTexture(ganTex, index: 0)
  eq.setTexture(flowTex, index: 1)
  eq.dispatchThreads(
    MTLSize(width: 320, height: 320, depth: 1),
    threadsPerThreadgroup: MTLSize(width: 8, height: 8, depth: 1))
  eq.endEncoding()
  let pd = MTLRenderPipelineDescriptor()
  pd.vertexFunction = lib.makeFunction(name: "faceVertex")
  pd.fragmentFunction = lib.makeFunction(name: flowEnabled ? "composite" : "compositeStatic")
  pd.colorAttachments[0].pixelFormat = .rgba8Unorm
  pd.colorAttachments[0].isBlendingEnabled = true
  pd.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
  pd.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
  pd.colorAttachments[0].sourceAlphaBlendFactor = .one
  pd.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
  let rp = try device.makeRenderPipelineState(descriptor: pd)
  let pass = MTLRenderPassDescriptor()
  pass.colorAttachments[0].texture = target
  pass.colorAttachments[0].loadAction = .load
  pass.colorAttachments[0].storeAction = .store
  let er = second.makeRenderCommandEncoder(descriptor: pass)!
  er.setRenderPipelineState(rp)
  r.mvp.withUnsafeBytes {
    er.setVertexBytes($0.baseAddress!, length: $0.count, index: 0)
    er.setFragmentBytes($0.baseAddress!, length: $0.count, index: 0)
  }
  for (i, t) in [ganTex, flowTex, maskTex, sourceTex].enumerated() {
    er.setFragmentTexture(t, index: i)
  }
  er.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
  er.endEncoding()
  second.commit()
  second.waitUntilCompleted()
  if let e = second.error { throw e }

  var pixels = Data(count: r.width * r.height * 4)
  pixels.withUnsafeMutableBytes {
    target.getBytes(
      $0.baseAddress!, bytesPerRow: r.width * 4, from: MTLRegionMake2D(0, 0, r.width, r.height),
      mipmapLevel: 0)
  }
  let images = (0..<_dyld_image_count()).map { String(cString: _dyld_get_image_name($0)) }
  let forbidden = ["libcccreator.dylib", "liblens.dylib", "libAGFX.dylib", "libbytenn.dylib"]
  let privateImages = images.filter {
    forbidden.contains(URL(fileURLWithPath: $0).lastPathComponent)
  }
  try require(privateImages.isEmpty, "independent FlowGAN loaded private effect libraries")
  try pixels.write(to: root.appendingPathComponent("output.rgba"))
  let receipt: [String: Any] = [
    "gpu": device.name, "images": images, "private_native_images": privateImages,
    "pixelFormat": "RGBA8Unorm", "steps": 84, "warpMath": "safe",
    "controlVectorFloat16": latent.prefix(3).map { Float($0) }, "flowEnabled": flowEnabled,
  ]
  try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]).write(
    to: root.appendingPathComponent("output.rgba.json"))
}
do { try run() } catch {
  FileHandle.standardError.write(Data("\(error)\n".utf8))
  exit(1)
}
