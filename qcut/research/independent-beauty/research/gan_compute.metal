// Owned half-vector convolution, residual and resize arithmetic.
#include <metal_stdlib>
using namespace metal;

struct P {
    int iw, ih, ic, ow, oh, oc, k, s, pad, relu, op;
};

kernel void conv(
    device const half4* input [[buffer(0)]],
    device half4* output [[buffer(1)]],
    constant P& p [[buffer(2)]],
    device const half4x4* weight [[buffer(3)]],
    device const half4* bias [[buffer(4)]],
    uint3 q [[thread_position_in_grid]]) {
    if (q.x >= p.ow || q.y >= p.oh || q.z >= p.oc) return;
    float4 sum = float4(0);
    for (int block = 0; block < p.ic; block++) {
        for (int y = 0; y < p.k; y++) {
            for (int x = 0; x < p.k; x++) {
                int ix = int(q.x)*p.s-p.pad+x;
                int iy = int(q.y)*p.s-p.pad+y;
                if (ix < 0 || iy < 0 || ix >= p.iw || iy >= p.ih) continue;
                float4 value = float4(input[(block*p.ih+iy)*p.iw+ix]);
                float4x4 matrix = float4x4(weight[((q.z*p.ic+block)*p.k+y)*p.k+x]);
                sum += value*matrix;
            }
        }
    }
    // Bias placement changes cancellation at float32 precision.
    half4 value = half4(sum+float4(bias[q.z]));
    if (p.relu) value = max(value, half4(0));
    output[(q.z*p.oh+q.y)*p.ow+q.x] = value;
}

kernel void pointConv(
    device const half4* input [[buffer(0)]],
    device half4* output [[buffer(1)]],
    constant P& p [[buffer(2)]],
    device const half4x4* weight [[buffer(3)]],
    device const half4* bias [[buffer(4)]],
    uint3 q [[thread_position_in_grid]]) {
    int at = int(q.x);
    if (at >= p.ow*p.oh || q.y >= p.oc) return;
    float4 value = float4(bias[q.y]);
    for (int block = 0; block < p.ic; block++) {
        value += float4(input[block*p.iw*p.ih+at])*float4x4(weight[q.y*p.ic+block]);
    }
    half4 result = half4(value);
    if (p.relu) result = max(result, half4(0));
    output[q.y*p.ow*p.oh+at] = result;
}

kernel void pointConvFour(
    device const half4* input [[buffer(0)]],
    device half4* output [[buffer(1)]],
    constant P& p [[buffer(2)]],
    device const half4x4* weight [[buffer(3)]],
    device const half4* bias [[buffer(4)]],
    uint3 q [[thread_position_in_grid]]) {
    int at = int(q.x)*4;
    int count = min(p.ow*p.oh-at, 4);
    if (count <= 0 || q.y >= p.oc) return;
    float4 a = float4(bias[q.y]), b = a, c = a, d = a;
    for (int block = 0; block < p.ic; block++) {
        float4x4 matrix = float4x4(weight[q.y*p.ic+block]);
        int start = block*p.iw*p.ih+at;
        a += float4(input[start])*matrix;
        if (count > 1) b += float4(input[start+1])*matrix;
        if (count > 2) c += float4(input[start+2])*matrix;
        if (count > 3) d += float4(input[start+3])*matrix;
    }
    half4 va = half4(a), vb = half4(b), vc = half4(c), vd = half4(d);
    if (p.relu) {
        va = max(va, half4(0)); vb = max(vb, half4(0));
        vc = max(vc, half4(0)); vd = max(vd, half4(0));
    }
    int start = q.y*p.ow*p.oh+at;
    output[start] = va;
    if (count > 1) output[start+1] = vb;
    if (count > 2) output[start+2] = vc;
    if (count > 3) output[start+3] = vd;
}

kernel void depth(
    device const half4* input [[buffer(0)]],
    device half4* output [[buffer(1)]],
    constant P& p [[buffer(2)]],
    device const half4* weight [[buffer(3)]],
    device const half4* bias [[buffer(4)]],
    uint3 q [[thread_position_in_grid]]) {
    if (q.x >= p.ow || q.y >= p.oh || q.z >= p.oc) return;
    float4 sum = float4(bias[q.z]);
    for (int y = 0; y < p.k; y++) {
        for (int x = 0; x < p.k; x++) {
            int ix = int(q.x)*p.s-p.pad+x;
            int iy = int(q.y)*p.s-p.pad+y;
            if (ix < 0 || iy < 0 || ix >= p.iw || iy >= p.ih) continue;
            half4 a = input[(q.z*p.ih+iy)*p.iw+ix];
            half4 b = weight[(q.z*p.k+y)*p.k+x];
            sum += float4(a*b);
        }
    }
    half4 value = half4(sum);
    if (p.relu) value = max(value, half4(0));
    output[(q.z*p.oh+q.y)*p.ow+q.x] = value;
}

kernel void pointwise(
    device const half4* input [[buffer(0)]],
    device half4* output [[buffer(1)]],
    constant P& p [[buffer(2)]],
    device const half4* second [[buffer(3)]],
    uint3 q [[thread_position_in_grid]]) {
    if (q.x >= p.ow || q.y >= p.oh || q.z >= p.oc) return;
    int at = (q.z*p.oh+q.y)*p.ow+q.x;
    half4 a = input[at], value;
    if (p.op == 0) value = a+second[at];
    else if (p.op == 1) value = a*second[q.z];
    else if (p.op == 2) value = half4(1.0f/(1.0f+exp(-float4(a))));
    else value = half4(2.0f/(1.0f+exp(-2.0f*float4(a)))-1.0f);
    if (p.relu) value = max(value, half4(0));
    output[at] = value;
}

kernel void resize(
    device const half4* input [[buffer(0)]],
    device half4* output [[buffer(1)]],
    constant P& p [[buffer(2)]],
    uint3 q [[thread_position_in_grid]]) {
    if (q.x >= p.ow || q.y >= p.oh || q.z >= p.oc) return;
    half fx = (float(q.x)+.5f)*(float(p.iw)/float(p.ow))-.5f;
    half fy = (float(q.y)+.5f)*(float(p.ih)/float(p.oh))-.5f;
    int x = int(floor(fx)), y = int(floor(fy));
    fx -= x; fy -= y;
    if (x < 0) { x = 0; fx = 0; }
    else if (x >= p.iw-1) { x = p.iw-1; fx = 0; }
    if (y < 0) { y = 0; fy = 0; }
    else if (y >= p.ih-1) { y = p.ih-1; fy = 0; }
    half a = (1.0-fx)*(1.0-fy), b = (1.0-fx)*fy;
    half c = fx*(1.0-fy), d = fx*fy;
    int at = (q.z*p.ih+y)*p.iw+x;
    half4 value = input[at];
    if (fx == 0 && fy == 0) {}
    else if (fx == 0) value = a*value+b*input[at+p.iw];
    else if (fy == 0) value = a*value+c*input[at+1];
    else value = value*a+input[at+p.iw]*b+input[at+1]*c+input[at+p.iw+1]*d;
    output[(q.z*p.oh+q.y)*p.ow+q.x] = value;
}
