import Foundation
import MachO
import Metal

struct Request: Decodable {
  let width: Int
  let height: Int
  let targetWidth: Int
  let targetHeight: Int
}
struct FrameError: Error, CustomStringConvertible { let description: String }
func require(_ condition: Bool, _ message: String) throws {
  if !condition { throw FrameError(description: message) }
}
let shader = """
#include <metal_stdlib>
using namespace metal;
struct V {float4 position [[position]]; float2 uv;};
vertex V vertexMain(uint id [[vertex_id]]) {
  float2 p[4]={float2(-1,-1),float2(-1,1),float2(1,-1),float2(1,1)};
  float2 uv[4]={float2(0,1),float2(0,0),float2(1,1),float2(1,0)};
  V result; result.position=float4(p[id],0,1); result.uv=uv[id]; return result;
}
fragment float4 fragmentMain(V v [[stage_in]],texture2d<float> source [[texture(0)]]) {
  constexpr sampler s(coord::normalized,address::clamp_to_edge,filter::linear);
  return source.sample(s,v.uv);
}
"""
func run() throws {
  try require(CommandLine.arguments.count == 2, "one independent NH image request required")
  let path = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
  let root = path.deletingLastPathComponent()
  let data = try Data(contentsOf: path)
  try require(data.count <= 4096, "bounded NH image request required")
  let r = try JSONDecoder().decode(Request.self, from: data)
  try require((1...1280).contains(r.width) && (1...1280).contains(r.height)
    && (16...640).contains(r.targetWidth) && (16...640).contains(r.targetHeight),
    "bounded NH image dimensions required")
  let pixels = try Data(contentsOf: root.appendingPathComponent("input.rgba"))
  try require(pixels.count == r.width*r.height*4, "NH input byte count mismatch")
  guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue(),
    let command = queue.makeCommandBuffer() else { throw FrameError(description: "Metal unavailable") }
  func texture(_ width: Int, _ height: Int) throws -> MTLTexture {
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .rgba8Unorm,
      width: width, height: height, mipmapped: false)
    descriptor.storageMode = .shared
    descriptor.usage = [.shaderRead, .renderTarget]
    guard let result = device.makeTexture(descriptor: descriptor)
      else { throw FrameError(description: "NH texture allocation failed") }
    return result
  }
  let original = try texture(r.width, r.height)
  pixels.withUnsafeBytes {
    original.replace(region: MTLRegionMake2D(0,0,r.width,r.height), mipmapLevel: 0,
      withBytes: $0.baseAddress!, bytesPerRow: r.width*4)
  }
  let target = try texture(r.targetWidth, r.targetHeight)
  let options = MTLCompileOptions()
  options.mathMode = .safe
  let library = try device.makeLibrary(source: shader, options: options)
  let pipeline = MTLRenderPipelineDescriptor()
  pipeline.vertexFunction = library.makeFunction(name: "vertexMain")
  pipeline.fragmentFunction = library.makeFunction(name: "fragmentMain")
  pipeline.colorAttachments[0].pixelFormat = .rgba8Unorm
  let state = try device.makeRenderPipelineState(descriptor: pipeline)
  let pass = MTLRenderPassDescriptor()
  pass.colorAttachments[0].texture = target
  pass.colorAttachments[0].loadAction = .clear
  pass.colorAttachments[0].storeAction = .store
  guard let encoder = command.makeRenderCommandEncoder(descriptor: pass)
    else { throw FrameError(description: "NH encoder unavailable") }
  encoder.setRenderPipelineState(state)
  encoder.setFragmentTexture(original, index: 0)
  encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
  encoder.endEncoding()
  command.commit()
  command.waitUntilCompleted()
  if let error = command.error { throw error }
  var output = Data(count: r.targetWidth*r.targetHeight*4)
  output.withUnsafeMutableBytes {
    target.getBytes($0.baseAddress!, bytesPerRow: r.targetWidth*4,
      from: MTLRegionMake2D(0,0,r.targetWidth,r.targetHeight), mipmapLevel: 0)
  }
  let images = (0..<_dyld_image_count()).map { String(cString: _dyld_get_image_name($0)) }
  let forbidden = ["libcccreator.dylib", "liblens.dylib", "libAGFX.dylib", "libbytenn.dylib"]
  let privateImages = images.filter { forbidden.contains(URL(fileURLWithPath: $0).lastPathComponent) }
  try require(privateImages.isEmpty, "independent NH image host loaded private effect libraries")
  try output.write(to: root.appendingPathComponent("output.rgba"))
  let receipt: [String: Any] = ["gpu": device.name, "images": images,
    "private_native_images": privateImages, "pixelFormat": "RGBA8Unorm", "mipmapped": false]
  try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]).write(
    to: root.appendingPathComponent("output.rgba.json"))
}
do { try run() } catch {
  FileHandle.standardError.write(Data("\(error)\n".utf8))
  exit(1)
}
