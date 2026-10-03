#import <Foundation/Foundation.h>
#import <Metal/Metal.h>

#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <stdexcept>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

namespace {

constexpr size_t kMaximumBytes = 64U * 1024U * 1024U;
constexpr char kShaderSource[] = R"METAL(
#include <metal_stdlib>
using namespace metal;

constexpr sampler linear_clamp(coord::normalized, address::clamp_to_edge,
                              filter::linear);

inline float2 pixel_uv(uint2 pixel, uint2 size) {
    return (float2(pixel) + float2(0.5f)) / float2(size);
}

kernel void float_texture(texture2d<float, access::sample> source [[texture(0)]],
                          texture2d<float, access::write> output [[texture(1)]],
                          constant uint2& size [[buffer(0)]],
                          uint2 pixel [[thread_position_in_grid]]) {
    if (any(pixel >= size)) return;
    output.write(source.sample(linear_clamp, pixel_uv(pixel, size), level(0.0f)), pixel);
}

kernel void float_floor(texture2d<float, access::sample> source [[texture(0)]],
                        constant uint2& size [[buffer(0)]],
                        device uchar4* output [[buffer(1)]],
                        uint2 pixel [[thread_position_in_grid]]) {
    if (any(pixel >= size)) return;
    float4 value = source.sample(linear_clamp, pixel_uv(pixel, size), level(0.0f));
    output[pixel.y * size.x + pixel.x] = uchar4(floor(value * 255.0f));
}

kernel void float_round(texture2d<float, access::sample> source [[texture(0)]],
                        constant uint2& size [[buffer(0)]],
                        device uchar4* output [[buffer(1)]],
                        uint2 pixel [[thread_position_in_grid]]) {
    if (any(pixel >= size)) return;
    float4 value = source.sample(linear_clamp, pixel_uv(pixel, size), level(0.0f));
    output[pixel.y * size.x + pixel.x] = uchar4(floor(value * 255.0f + 0.5f));
}

kernel void half_texture(texture2d<half, access::sample> source [[texture(0)]],
                         texture2d<half, access::write> output [[texture(1)]],
                         constant uint2& size [[buffer(0)]],
                         uint2 pixel [[thread_position_in_grid]]) {
    if (any(pixel >= size)) return;
    half4 value = source.sample(linear_clamp, pixel_uv(pixel, size), level(0.0f));
    output.write(value, pixel);
}

kernel void half_truncate(texture2d<half, access::sample> source [[texture(0)]],
                          constant uint2& size [[buffer(0)]],
                          device uchar4* output [[buffer(1)]],
                          uint2 pixel [[thread_position_in_grid]]) {
    if (any(pixel >= size)) return;
    half4 value = source.sample(linear_clamp, pixel_uv(pixel, size), level(0.0f));
    output[pixel.y * size.x + pixel.x] = uchar4(value * half(255.0f));
}

kernel void float_raw(texture2d<float, access::sample> source [[texture(0)]],
                      constant uint2& size [[buffer(0)]],
                      device float4* output [[buffer(1)]],
                      uint2 pixel [[thread_position_in_grid]]) {
    if (any(pixel >= size)) return;
    output[pixel.y * size.x + pixel.x] =
        source.sample(linear_clamp, pixel_uv(pixel, size), level(0.0f));
}
)METAL";

struct Configuration {
    const char* input;
    const char* output;
    uint32_t width;
    uint32_t height;
    uint32_t outWidth;
    uint32_t outHeight;
    uint32_t mode;
    size_t inputBytes;
    size_t outputBytes;
};

[[noreturn]] void fail(const std::string& message) {
    throw std::runtime_error(message);
}

[[noreturn]] void systemFailure(const char* operation) {
    const int code = errno;
    fail(std::string(operation) + ": " + std::strerror(code));
}

uint32_t parseNumber(const char* text, uint32_t minimum, uint32_t maximum) {
    if (!text || !*text) fail("Empty numeric argument");
    uint32_t value = 0;
    for (const char* cursor = text; *cursor; ++cursor) {
        if (*cursor < '0' || *cursor > '9') fail("Numeric arguments must contain digits only");
        const uint32_t digit = static_cast<uint32_t>(*cursor - '0');
        if (value > maximum / 10 ||
            (value == maximum / 10 && digit > maximum % 10)) {
            fail("Numeric argument exceeds its bound");
        }
        value = value * 10 + digit;
    }
    if (value < minimum) fail("Numeric argument is below its bound");
    return value;
}

Configuration configuration(int argc, char* const argv[]) {
    if (argc != 8) fail("Usage: face_full_frame_metal INPUT OUTPUT WIDTH HEIGHT OUT_WIDTH OUT_HEIGHT MODE");
    if (!*argv[1] || !*argv[2]) fail("Input and output paths must be nonempty");
    Configuration result{argv[1], argv[2], parseNumber(argv[3], 1, 4096),
                         parseNumber(argv[4], 1, 4096), parseNumber(argv[5], 1, 4096),
                         parseNumber(argv[6], 1, 4096), parseNumber(argv[7], 0, 5), 0, 0};
    result.inputBytes = static_cast<size_t>(result.width) * result.height * 4;
    result.outputBytes = static_cast<size_t>(result.outWidth) * result.outHeight *
                         (result.mode == 5 ? 16 : 4);
    if (result.inputBytes > kMaximumBytes || result.outputBytes > kMaximumBytes) {
        fail("Input or output exceeds 64 MiB");
    }
    return result;
}

class FileDescriptor {
public:
    explicit FileDescriptor(int descriptor) : descriptor_(descriptor) {}
    FileDescriptor(const FileDescriptor&) = delete;
    FileDescriptor& operator=(const FileDescriptor&) = delete;
    ~FileDescriptor() { if (descriptor_ >= 0) ::close(descriptor_); }
    int get() const { return descriptor_; }
    void closeChecked() {
        const int descriptor = descriptor_;
        descriptor_ = -1;
        if (::close(descriptor) != 0) systemFailure("close");
    }

private:
    int descriptor_;
};

std::vector<uint8_t> readInput(const Configuration& config) {
    const int descriptor = ::open(config.input, O_RDONLY | O_CLOEXEC | O_NONBLOCK);
    if (descriptor < 0) systemFailure("open input");
    FileDescriptor input(descriptor);
    struct stat status{};
    if (::fstat(input.get(), &status) != 0) systemFailure("stat input");
    if (!S_ISREG(status.st_mode) || status.st_size < 0 ||
        static_cast<uint64_t>(status.st_size) != config.inputBytes) {
        fail("Input must be a regular file of exactly WIDTH * HEIGHT * 4 bytes");
    }
    std::vector<uint8_t> pixels(config.inputBytes);
    size_t offset = 0;
    while (offset < pixels.size()) {
        const ssize_t count = ::read(input.get(), pixels.data() + offset, pixels.size() - offset);
        if (count < 0 && errno == EINTR) continue;
        if (count < 0) systemFailure("read input");
        if (count == 0) fail("Input ended before the expected pixel count");
        offset += static_cast<size_t>(count);
    }
    uint8_t extra = 0;
    ssize_t count;
    do { count = ::read(input.get(), &extra, 1); } while (count < 0 && errno == EINTR);
    if (count < 0) systemFailure("read input tail");
    if (count != 0) fail("Input grew beyond the expected pixel count");
    input.closeChecked();
    return pixels;
}

class FreshOutput {
public:
    explicit FreshOutput(const char* path)
        : path_(path), descriptor_(::open(path, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600)) {
        if (descriptor_.get() < 0) systemFailure("create fresh output");
    }
    FreshOutput(const FreshOutput&) = delete;
    FreshOutput& operator=(const FreshOutput&) = delete;
    ~FreshOutput() { if (!complete_) ::unlink(path_.c_str()); }
    void save(const std::vector<uint8_t>& pixels) {
        size_t offset = 0;
        while (offset < pixels.size()) {
            const ssize_t count = ::write(descriptor_.get(), pixels.data() + offset, pixels.size() - offset);
            if (count < 0 && errno == EINTR) continue;
            if (count < 0) systemFailure("write output");
            if (count == 0) fail("Output write made no progress");
            offset += static_cast<size_t>(count);
        }
        if (::fsync(descriptor_.get()) != 0) systemFailure("sync output");
        struct stat status{};
        if (::fstat(descriptor_.get(), &status) != 0) systemFailure("stat output");
        if (status.st_size < 0 || static_cast<uint64_t>(status.st_size) != pixels.size()) {
            fail("Output byte count is incorrect");
        }
        descriptor_.closeChecked();
        complete_ = true;
    }

private:
    std::string path_;
    FileDescriptor descriptor_;
    bool complete_ = false;
};

void metalFailure(const char* operation, NSError* error) {
    fail(std::string(operation) + ": " +
         (error ? error.localizedDescription.UTF8String : "Metal returned nil without an error"));
}

id<MTLTexture> texture(id<MTLDevice> device, uint32_t width, uint32_t height,
                       MTLTextureUsage usage) {
    MTLTextureDescriptor* descriptor = [MTLTextureDescriptor
        texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm
        width:width height:height mipmapped:NO];
    descriptor.storageMode = MTLStorageModeShared;
    descriptor.usage = usage;
    id<MTLTexture> result = [device newTextureWithDescriptor:descriptor];
    if (!result) fail("Could not allocate the RGBA8Unorm texture");
    return result;
}

std::vector<uint8_t> sample(const Configuration& config, const std::vector<uint8_t>& input) {
    id<MTLDevice> device = MTLCreateSystemDefaultDevice();
    if (!device) fail("No Metal device is available");
    MTLCompileOptions* options = [MTLCompileOptions new];
    if (@available(macOS 15.0, *)) {
        options.mathMode = MTLMathModeSafe;
        options.mathFloatingPointFunctions = MTLMathFloatingPointFunctionsPrecise;
    } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        options.fastMathEnabled = NO;
#pragma clang diagnostic pop
    }
    NSError* error = nil;
    id<MTLLibrary> library = [device newLibraryWithSource:[NSString stringWithUTF8String:kShaderSource]
                                                options:options error:&error];
    if (!library || error) metalFailure("compile embedded shader", error);
    NSString* const kernels[] = {@"float_texture", @"float_floor", @"float_round",
                                 @"half_texture", @"half_truncate", @"float_raw"};
    id<MTLFunction> function = [library newFunctionWithName:kernels[config.mode]];
    if (!function) fail("Could not find the diagnostic kernel");
    error = nil;
    id<MTLComputePipelineState> pipeline = [device newComputePipelineStateWithFunction:function error:&error];
    if (!pipeline || error) metalFailure("create compute pipeline", error);
    id<MTLTexture> source = texture(device, config.width, config.height, MTLTextureUsageShaderRead);
    [source replaceRegion:MTLRegionMake2D(0, 0, config.width, config.height) mipmapLevel:0
                withBytes:input.data() bytesPerRow:static_cast<size_t>(config.width) * 4];
    const bool textureOutput = config.mode == 0 || config.mode == 3;
    id<MTLTexture> outputTexture = nil;
    id<MTLBuffer> outputBuffer = nil;
    if (textureOutput) {
        outputTexture = texture(device, config.outWidth, config.outHeight, MTLTextureUsageShaderWrite);
    } else {
        outputBuffer = [device newBufferWithLength:config.outputBytes options:MTLResourceStorageModeShared];
        if (!outputBuffer || !outputBuffer.contents) fail("Could not allocate the output buffer");
    }
    id<MTLCommandQueue> queue = [device newCommandQueue];
    if (!queue) fail("Could not create a Metal command queue");
    id<MTLCommandBuffer> command = [queue commandBuffer];
    if (!command) fail("Could not create a Metal command buffer");
    id<MTLComputeCommandEncoder> encoder = [command computeCommandEncoder];
    if (!encoder) fail("Could not create a Metal command encoder");
    const uint32_t dimensions[] = {config.outWidth, config.outHeight};
    [encoder setComputePipelineState:pipeline];
    [encoder setTexture:source atIndex:0];
    [encoder setBytes:dimensions length:sizeof(dimensions) atIndex:0];
    if (textureOutput) [encoder setTexture:outputTexture atIndex:1];
    else [encoder setBuffer:outputBuffer offset:0 atIndex:1];
    const NSUInteger groupWidth = pipeline.threadExecutionWidth;
    if (groupWidth == 0 || pipeline.maxTotalThreadsPerThreadgroup < groupWidth) {
        [encoder endEncoding];
        fail("Invalid Metal pipeline threadgroup limits");
    }
    [encoder dispatchThreads:MTLSizeMake(config.outWidth, config.outHeight, 1)
       threadsPerThreadgroup:MTLSizeMake(groupWidth, 1, 1)];
    [encoder endEncoding];
    [command commit];
    [command waitUntilCompleted];
    if (command.status != MTLCommandBufferStatusCompleted || command.error) {
        metalFailure("Metal command did not complete successfully", command.error);
    }
    std::vector<uint8_t> output(config.outputBytes);
    if (textureOutput) {
        [outputTexture getBytes:output.data() bytesPerRow:static_cast<size_t>(config.outWidth) * 4
                     fromRegion:MTLRegionMake2D(0, 0, config.outWidth, config.outHeight) mipmapLevel:0];
    } else {
        std::memcpy(output.data(), outputBuffer.contents, output.size());
    }
    return output;
}

} // namespace

int main(int argc, char* argv[]) {
    @autoreleasepool {
        try {
            const Configuration config = configuration(argc, argv);
            const std::vector<uint8_t> input = readInput(config);
            FreshOutput output(config.output);
            output.save(sample(config, input));
            std::fprintf(stdout, "mode=%u width=%u height=%u bytes=%zu layout=%s\n",
                         config.mode, config.outWidth, config.outHeight, config.outputBytes,
                         config.mode == 5 ? "row-major-interleaved-RGBA-float32-native-endian" :
                                            "row-major-interleaved-RGBA-uint8");
            return 0;
        } catch (const std::exception& error) {
            std::fprintf(stderr, "face_full_frame_metal: %s\n", error.what());
            return 1;
        }
    }
}
