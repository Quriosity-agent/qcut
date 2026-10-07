import Foundation
import MachO
import Metal

struct Request: Decodable {
  let width: Int
  let height: Int
  let affine: [Float]
}
struct CropError: Error, CustomStringConvertible { let description: String }
func require(_ condition: Bool, _ message: String) throws {
  if !condition { throw CropError(description: message) }
}
let source = """
#include <metal_stdlib>
using namespace metal;
struct V {float4 position [[position]];float2 uv;};
vertex V cropVertex(uint index [[vertex_id]]) {
 float2 xy[6]={float2(-1,-1),float2(-1,1),float2(1,1),float2(1,-1),float2(-1,-1),float2(1,1)};
 float2 uv[6]={float2(0,1),float2(0,0),float2(1,0),float2(1,1),float2(0,1),float2(1,0)};
 return {float4(xy[index],0,1),uv[index]};
}
fragment float4 cropFragment(V v [[stage_in]],constant float* affine [[buffer(0)]],texture2d<float> image [[texture(0)]]) {
 float3x3 matrix(float3(affine[0],affine[3],0),float3(affine[1],affine[4],0),float3(affine[2],affine[5],1));
 float2 uv=(matrix*float3(floor(v.position.xy)/512.0f,1)).xy;
 float2 coordinate=clamp(floor(uv*float2(image.get_width(),image.get_height())+.5f),float2(0),float2(image.get_width()-1,image.get_height()-1));
 return image.read(uint2(coordinate))*2.0f-1.0f;
}
"""

func run() throws {
  try require(CommandLine.arguments.count == 2, "one crop request required")
  let url = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
  let directory = url.deletingLastPathComponent()
  let data = try Data(contentsOf: url)
  try require(data.count <= 4096, "bounded crop request required")
  let request = try JSONDecoder().decode(Request.self, from: data)
  try require((16...1280).contains(request.width) && (16...1280).contains(request.height), "bounded image required")
  try require(request.affine.count == 6 && request.affine.allSatisfy { $0.isFinite && abs($0) <= 32768 }, "finite owned affine required")
  let pixels = try Data(contentsOf: directory.appendingPathComponent("input.rgba"))
  try require(pixels.count == request.width*request.height*4, "RGBA byte count mismatch")
  guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue(), let command = queue.makeCommandBuffer()
  else { throw CropError(description: "Metal unavailable") }
  let originalDescriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm, width: request.width, height: request.height, mipmapped: false)
  originalDescriptor.storageMode = .shared
  originalDescriptor.usage = .shaderRead
  let original = device.makeTexture(descriptor: originalDescriptor)!
  pixels.withUnsafeBytes {
    original.replace(region: MTLRegionMake2D(0, 0, request.width, request.height), mipmapLevel: 0, withBytes: $0.baseAddress!, bytesPerRow: request.width*4)
  }
  let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba32Float, width: 512, height: 512, mipmapped: false)
  descriptor.storageMode = .shared
  descriptor.usage = [.renderTarget, .shaderRead]
  let target = device.makeTexture(descriptor: descriptor)!
  let options = MTLCompileOptions()
  options.mathMode = .fast
  let library = try device.makeLibrary(source: source, options: options)
  let pipelineDescriptor = MTLRenderPipelineDescriptor()
  pipelineDescriptor.vertexFunction = library.makeFunction(name: "cropVertex")
  pipelineDescriptor.fragmentFunction = library.makeFunction(name: "cropFragment")
  pipelineDescriptor.colorAttachments[0].pixelFormat = .rgba32Float
  let pipeline = try device.makeRenderPipelineState(descriptor: pipelineDescriptor)
  let pass = MTLRenderPassDescriptor()
  pass.colorAttachments[0].texture = target
  pass.colorAttachments[0].loadAction = .clear
  pass.colorAttachments[0].storeAction = .store
  let encoder = command.makeRenderCommandEncoder(descriptor: pass)!
  encoder.setRenderPipelineState(pipeline)
  encoder.setFragmentTexture(original, index: 0)
  request.affine.withUnsafeBytes { encoder.setFragmentBytes($0.baseAddress!, length: $0.count, index: 0) }
  encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6)
  encoder.endEncoding()
  command.commit()
  command.waitUntilCompleted()
  if let error = command.error { throw error }
  var output = Data(count: 512*512*16)
  output.withUnsafeMutableBytes {
    target.getBytes($0.baseAddress!, bytesPerRow: 512*16, from: MTLRegionMake2D(0, 0, 512, 512), mipmapLevel: 0)
  }
  let images = (0..<_dyld_image_count()).map { String(cString: _dyld_get_image_name($0)) }
  let forbidden = ["libcccreator.dylib", "liblens.dylib", "libAGFX.dylib", "libbytenn.dylib"]
  let privateImages = images.filter { forbidden.contains(URL(fileURLWithPath: $0).lastPathComponent) }
  try require(privateImages.isEmpty, "private native image in independent crop")
  try output.write(to: directory.appendingPathComponent("crop.f32"))
  let receipt: [String: Any] = ["gpu": device.name, "private_native_images": privateImages,
    "images": images, "size": [512, 512], "channels": 4, "pixelFormat": "RGBA32Float",
    "warpMath": "fast", "sampling": "integer-destination, rounded-nearest-source"]
  try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]).write(to: directory.appendingPathComponent("gpu.json"))
}
do { try run() } catch {
  FileHandle.standardError.write(Data("\(error)\n".utf8))
  exit(1)
}
