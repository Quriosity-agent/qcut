import Foundation
import Metal

struct Request: Decodable {
    let kernel: String, params: [Int32], grid: [Int]
    let input: [Float], second: [Float], weights: [Float], bias: [Float]
    let outputCount: Int
}
struct ProbeError: Error { let message: String }
func run() throws {
    guard CommandLine.arguments.count == 3,let device=MTLCreateSystemDefaultDevice(),
        let queue=device.makeCommandQueue(),let command=queue.makeCommandBuffer() else {throw ProbeError(message:"Metal probe unavailable")}
    let request=try JSONDecoder().decode(Request.self,from:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[2])))
    guard request.params.count==11 && request.grid.count==3 && request.outputCount>0 && request.outputCount<=4096
        && ["conv","pointConv","pointConvFour","depth","pointwise","resize"].contains(request.kernel) else {throw ProbeError(message:"bounded probe required")}
    let source=try String(contentsOfFile:CommandLine.arguments[1],encoding:.utf8)
    let library=try device.makeLibrary(source:source,options:nil)
    let pipeline=try device.makeComputePipelineState(function:library.makeFunction(name:request.kernel)!)
    func buffer(_ values:[Float])->MTLBuffer {
        let half=values.isEmpty ? [Float16(0)] : values.map{Float16($0)}
        return half.withUnsafeBytes{device.makeBuffer(bytes:$0.baseAddress!,length:$0.count,options:.storageModeShared)!}
    }
    let input=buffer(request.input),weights=buffer(request.weights),bias=buffer(request.bias),second=buffer(request.second)
    let output=device.makeBuffer(length:request.outputCount*2,options:.storageModeShared)!
    memset(output.contents(),0,output.length)
    let encoder=command.makeComputeCommandEncoder()!
    encoder.setComputePipelineState(pipeline);encoder.setBuffer(input,offset:0,index:0);encoder.setBuffer(output,offset:0,index:1)
    request.params.withUnsafeBytes{encoder.setBytes($0.baseAddress!,length:$0.count,index:2)}
    encoder.setBuffer(request.kernel=="pointwise" ? second:weights,offset:0,index:3);encoder.setBuffer(bias,offset:0,index:4)
    encoder.dispatchThreads(MTLSize(width:request.grid[0],height:request.grid[1],depth:request.grid[2]),threadsPerThreadgroup:MTLSize(width:1,height:1,depth:1))
    encoder.endEncoding();command.commit();command.waitUntilCompleted();if let error=command.error{throw error}
    let values=output.contents().bindMemory(to:Float16.self,capacity:request.outputCount)
    let result=(0..<request.outputCount).map{Float(values[$0])}
    let data=try JSONSerialization.data(withJSONObject:result)
    FileHandle.standardOutput.write(data)
}
do{try run()}catch{fputs("\(error)\n",stderr);exit(1)}
