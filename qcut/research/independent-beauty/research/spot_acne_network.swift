import Foundation
import MachO
import Metal

struct Weight: Decodable {
    let path: String, bias: String
    let kernel: Int, stride: Int, pad: Int, co: Int, ci: Int
    let depth: Bool
}
struct Params: Decodable { let relu: Bool? }
struct Step: Decodable { let op: String, output: String; let inputs: [String]; let params: Params }
struct Request: Decodable {
    let shapes: [String: [Int]], steps: [Step], weights: [String: Weight]
}
struct NetworkError: Error, CustomStringConvertible { let description: String }
func require(_ test: Bool, _ message: String) throws { if !test { throw NetworkError(description: message) } }
let inputKernel = """
#include <metal_stdlib>
using namespace metal;
kernel void input512(device const float4* input [[buffer(0)]],device half4* output [[buffer(1)]],uint q [[thread_position_in_grid]]){if(q<512*512)output[q]=half4(input[q]);}
"""

func run() throws {
    try require(CommandLine.arguments.count == 2, "one bounded spot network request required")
    let url = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
    let root = url.deletingLastPathComponent()
    func read(_ name: String, _ count: Int) throws -> Data {
        let file = root.appendingPathComponent(name).resolvingSymlinksInPath()
        let size = try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber
        try require(file.deletingLastPathComponent() == root && size?.intValue == count, "private network file and byte extent required")
        return try Data(contentsOf: file)
    }
    let size = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber
    try require((size?.intValue ?? Int.max) < 65536, "bounded network request required")
    let request = try JSONDecoder().decode(Request.self, from: Data(contentsOf: url))
    try require(request.steps.count == 66 && request.shapes.count == 66 && request.weights.count == 46,
                "bounded 65-layer spot topology required")
    try require(request.shapes["feature_0"] == [1,3,512,512] && request.shapes["feature_65"] == [1,4,512,512], "bounded spot endpoints required")
    for shape in request.shapes.values {
        try require(shape.count == 4 && shape[0] == 1 && (1...576).contains(shape[1]) && shape.dropFirst(2).allSatisfy{(1...512).contains($0)}, "bounded feature shape required")
    }
    let kernelURL = root.appendingPathComponent("kernels.metal")
    let kernels = try String(contentsOf: kernelURL, encoding: .utf8)
    try require(kernels.utf8.count <= 16384, "bounded owned kernel source required")
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue(), let command = queue.makeCommandBuffer() else {throw NetworkError(description:"Metal unavailable")}
    let library = try device.makeLibrary(source: kernels+inputKernel, options: nil)
    var pipelines: [String: MTLComputePipelineState] = [:]
    for name in ["conv","pointConv","pointConvFour","depth","pointwise","resize","input512"] {
        pipelines[name] = try device.makeComputePipelineState(function: library.makeFunction(name:name)!)
    }
    func load(_ name: String, _ count: Int) throws -> MTLBuffer {
        let bytes = try read(name,count)
        guard let buffer = bytes.withUnsafeBytes({ device.makeBuffer(bytes:$0.baseAddress!, length:$0.count, options:.storageModeShared) }) else {throw NetworkError(description:"Metal buffer allocation failed")}
        return buffer
    }
    func buffer(_ count: Int) throws -> MTLBuffer {
        guard let value = device.makeBuffer(length:count,options:.storageModeShared) else {throw NetworkError(description:"Metal buffer allocation failed")}
        return value
    }
    var values: [String: MTLBuffer] = [:]
    var retained: [MTLBuffer] = []
    let original = try load("crop.f32",512*512*16)
    let input = try buffer(512*512*8)
    let start = command.makeComputeCommandEncoder()!
    start.setComputePipelineState(pipelines["input512"]!)
    start.setBuffer(original,offset:0,index:0);start.setBuffer(input,offset:0,index:1)
    start.dispatchThreads(MTLSize(width:512*512,height:1,depth:1),threadsPerThreadgroup:MTLSize(width:128,height:1,depth:1));start.endEncoding()
    values["feature_0"] = input
    for (index, step) in request.steps.enumerated() {
        if index == 0 {try require(step.op == "DataV2" && step.inputs.isEmpty, "one network input required");continue}
        try require(["Convolution","DepthwiseSeparableConvolution","UpSampling","Eltwise","Tanh"].contains(step.op)
            && (1...2).contains(step.inputs.count) && step.inputs.allSatisfy{values[$0] != nil && request.shapes[$0] != nil}
            && request.shapes[step.output] != nil && values[step.output] == nil, "ordered spot features required")
        let a = request.shapes[step.inputs[0]]!, o = request.shapes[step.output]!
        let result = try buffer(((o[1]+3)/4)*o[2]*o[3]*8)
        let encoder = command.makeComputeCommandEncoder()!
        var params: [Int32] = [Int32(a[3]),Int32(a[2]),Int32((a[1]+3)/4),Int32(o[3]),Int32(o[2]),Int32((o[1]+3)/4),0,0,0,step.params.relu == true ? 1:0,0]
        let name: String
        if let weight = request.weights[String(index)] {
            try require(weight.co == o[1] && weight.ci == a[1] && (!weight.depth || weight.co == weight.ci)
                && [1,3].contains(weight.kernel) && [1,2].contains(weight.stride) && weight.pad == weight.kernel/2
                && (a[2]+2*weight.pad-weight.kernel)/weight.stride+1 == o[2]
                && (a[3]+2*weight.pad-weight.kernel)/weight.stride+1 == o[3], "compatible bounded convolution required")
            name = weight.depth ? "depth" : weight.kernel == 1 ? (o[2]*o[3]>=64 ? "pointConvFour":"pointConv") : "conv"
            params[6]=Int32(weight.kernel);params[7]=Int32(weight.stride);params[8]=Int32(weight.pad)
            let count = weight.depth ? ((o[1]+3)/4)*weight.kernel*weight.kernel*8 : ((o[1]+3)/4)*((a[1]+3)/4)*weight.kernel*weight.kernel*32
            let kernel = try load(weight.path,count), bias = try load(weight.bias,((o[1]+3)/4)*8)
            retained.append(contentsOf:[kernel,bias]);encoder.setBuffer(kernel,offset:0,index:3);encoder.setBuffer(bias,offset:0,index:4)
        } else if step.op == "UpSampling" {
            try require(a[1] == o[1] && o[2] == a[2]*2 && o[3] == a[3]*2,"twofold resize required")
            name = "resize"
        } else {
            try require(a == o, "elementwise feature extent required")
            name = "pointwise";params[10] = step.op == "Eltwise" ? 0:3
            if step.op == "Eltwise" {
                try require(step.inputs.count == 2 && request.shapes[step.inputs[1]] == a,"matching residual input required")
                encoder.setBuffer(values[step.inputs[1]],offset:0,index:3)
            }
        }
        encoder.setComputePipelineState(pipelines[name]!);encoder.setBuffer(values[step.inputs[0]],offset:0,index:0);encoder.setBuffer(result,offset:0,index:1)
        params.withUnsafeBytes{encoder.setBytes($0.baseAddress!,length:$0.count,index:2)}
        let grid = name == "pointConvFour" ? MTLSize(width:(o[2]*o[3]+3)/4,height:(o[1]+3)/4,depth:1)
            : name == "pointConv" ? MTLSize(width:o[2]*o[3],height:(o[1]+3)/4,depth:1)
            : MTLSize(width:o[3],height:o[2],depth:(o[1]+3)/4)
        encoder.dispatchThreads(grid,threadsPerThreadgroup:MTLSize(width:8,height:8,depth:1));encoder.endEncoding();values[step.output]=result
    }
    command.commit();command.waitUntilCompleted();if let error=command.error{throw error}
    let output=values["feature_65"]!
    let count=512*512*4
    let half=output.contents().bindMemory(to:Float16.self,capacity:count)
    let floats=(0..<count).map{Float(half[$0])}
    try floats.withUnsafeBytes{try Data($0).write(to:root.appendingPathComponent("network.f32"))}
    let images=(0..<_dyld_image_count()).map{String(cString:_dyld_get_image_name($0))}
    let forbidden=["libcccreator.dylib","liblens.dylib","libAGFX.dylib","libbytenn.dylib"]
    let privateImages=images.filter{forbidden.contains(URL(fileURLWithPath:$0).lastPathComponent)}
    try require(privateImages.isEmpty,"independent network loaded private effect libraries")
    let receipt: [String:Any]=["gpu":device.name,"private_native_images":privateImages,"images":images,"networkSteps":65,"featureStorage":"float16-vector4","accumulation":"float32"]
    try JSONSerialization.data(withJSONObject:receipt,options:[.prettyPrinted,.sortedKeys]).write(to:root.appendingPathComponent("gpu.json"))
}
do{try run()}catch{FileHandle.standardError.write(Data("\(error)\n".utf8));exit(1)}
