// src/shaders.ts
var EVAL_WGSL = (
  /* wgsl */
  `
struct EvalU { t: f32, g0: f32, span: f32, n: u32 };
@group(0) @binding(0) var<uniform> U: EvalU;
@group(0) @binding(1) var<storage, read> hdr: array<u32>;
@group(0) @binding(2) var<storage, read> knots: array<f32>;
@group(0) @binding(3) var<storage, read_write> world: array<vec4f>;

var<private> BSP: bool = false;                  // v6 (hdr word 2 bit 31): clamped cubic B-spline instead of the hat basis
struct BW { s0: u32, p: u32, w: vec4f };
fn knv(i: i32, p: i32, K: i32) -> f32 { return clamp(f32(i - p) / f32(K - p), 0.0, 1.0); }
fn bspl(K: u32) -> BW {                         // local support (NURBS book A2.2), = web/src/bspline.ts bsplineLocal
  let p = i32(min(3u, K - 1u));
  let Ki = i32(K);
  let u = clamp((U.t - U.g0) / U.span, 0.0, 1.0);
  var s = Ki - 1;
  if (u < 1.0) { s = min(Ki - 1, p + i32(floor(u * f32(Ki - p)))); }
  var N = array<f32, 4>(1.0, 0.0, 0.0, 0.0);
  var le = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  var ri = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  for (var j = 1; j <= p; j++) {
    le[j] = u - knv(s + 1 - j, p, Ki);
    ri[j] = knv(s + j, p, Ki) - u;
    var saved = 0.0;
    for (var r = 0; r < j; r++) {
      let temp = N[r] / (ri[r + 1] + le[j - r]);
      N[r] = saved + ri[r + 1] * temp;
      saved = le[j - r] * temp;
    }
    N[j] = saved;
  }
  return BW(u32(s - p), u32(p), vec4f(N[0], N[1], N[2], N[3]));
}
fn seg(K: u32) -> vec2f {                       // (segment j, weight of knot j+1)
  if (K <= 1u) { return vec2f(0.0, 0.0); }
  let km1 = f32(K - 1u);
  let tau = clamp((U.t - U.g0) * km1 / U.span, 0.0, km1);
  let j = min(floor(tau), km1 - 1.0);
  return vec2f(j, tau - j);
}
fn ev1(off: u32, K: u32) -> f32 {
  if (BSP) {
    let b = bspl(K); var acc = 0.0;
    for (var r = 0u; r <= b.p; r++) { acc += b.w[r] * knots[off + b.s0 + r]; }
    return acc;
  }
  let s = seg(K); let a = off + u32(s.x);
  if (K <= 1u) { return knots[a]; }
  return mix(knots[a], knots[a + 1u], s.y);
}
fn ev3(off: u32, K: u32) -> vec3f {
  if (BSP) {
    let b = bspl(K); var acc = vec3f(0.0);
    for (var r = 0u; r <= b.p; r++) { let a = off + (b.s0 + r) * 3u; acc += b.w[r] * vec3f(knots[a], knots[a + 1u], knots[a + 2u]); }
    return acc;
  }
  let s = seg(K); let a = off + u32(s.x) * 3u;
  let A = vec3f(knots[a], knots[a + 1u], knots[a + 2u]);
  if (K <= 1u) { return A; }
  return mix(A, vec3f(knots[a + 3u], knots[a + 4u], knots[a + 5u]), s.y);
}
fn ev4(off: u32, K: u32) -> vec4f {
  if (BSP) {
    let b = bspl(K); var acc = vec4f(0.0);
    for (var r = 0u; r <= b.p; r++) { let a = off + (b.s0 + r) * 4u; acc += b.w[r] * vec4f(knots[a], knots[a + 1u], knots[a + 2u], knots[a + 3u]); }
    return acc;
  }
  let s = seg(K); let a = off + u32(s.x) * 4u;
  let A = vec4f(knots[a], knots[a + 1u], knots[a + 2u], knots[a + 3u]);
  if (K <= 1u) { return A; }
  return mix(A, vec4f(knots[a + 4u], knots[a + 5u], knots[a + 6u], knots[a + 7u]), s.y);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= U.n) { return; }
  let h = i * 8u;
  let fi = floor(U.t);
  let alive = f32(hdr[h]) <= fi && fi < f32(hdr[h + 1u]);
  if (!alive) { world[i * 4u] = vec4f(0.0); return; }
  let kp = hdr[h + 2u];
  BSP = (kp >> 31u) != 0u;
  let p = ev3(hdr[h + 3u], kp & 63u);           // 6 bit K per group (mesh streams: K up to 33)
  var q = ev4(hdr[h + 4u], (kp >> 6u) & 63u);
  q = q / max(length(q), 1e-12);                // nlerp
  let s = ev3(hdr[h + 5u], (kp >> 12u) & 63u);
  let o = ev1(hdr[h + 6u], (kp >> 18u) & 63u);
  let d = ev3(hdr[h + 7u], (kp >> 24u) & 63u);
  world[i * 4u] = vec4f(p, 1.0);
  world[i * 4u + 1u] = q;
  world[i * 4u + 2u] = vec4f(s, o);
  world[i * 4u + 3u] = vec4f(d, 0.0);
}
`
);
var EVALQ_WGSL = (
  /* wgsl */
  `
@group(0) @binding(0) var<uniform> H: array<vec4f, 16>;
@group(0) @binding(1) var<storage, read> qd: array<u32>;
@group(0) @binding(2) var<storage, read_write> world: array<vec4f>;
@group(0) @binding(3) var<storage, read> p16: array<u32>;      // 16-bit positions (flag 4), else a dummy

fn hf(k: u32) -> f32 { return H[k >> 2u][k & 3u]; }
fn dq(k: u32, q: f32) -> f32 { return hf(4u + k) + q * hf(18u + k); }
fn u8at(w: u32, b: u32) -> f32 { return f32((w >> (8u * b)) & 255u); }
fn i8at(w: u32, b: u32) -> f32 { return f32(extractBits(bitcast<i32>(w), 8u * b, 8u)); }
fn qmul(a: vec4f, b: vec4f) -> vec4f {          // Hamilton product, wxyz
  return vec4f(a.x * b.x - a.y * b.y - a.z * b.z - a.w * b.w, a.x * b.y + a.y * b.x + a.z * b.w - a.w * b.z,
               a.x * b.z - a.y * b.w + a.z * b.x + a.w * b.y, a.x * b.w + a.y * b.z - a.z * b.y + a.w * b.x);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let n = bitcast<u32>(H[0].z);
  if (i >= n) { return; }
  let w0 = qd[i * 4u]; let w1 = qd[i * 4u + 1u]; let w2 = qd[i * 4u + 2u]; let w3 = qd[i * 4u + 3u];
  var p = vec3f(dq(0u, f32(w0 & 1023u)), dq(1u, f32((w0 >> 10u) & 1023u)), dq(2u, f32((w0 >> 20u) & 1023u)));
  if ((bitcast<u32>(H[0].w) & 4u) != 0u) {
    let a = p16[i * 2u]; let b = p16[i * 2u + 1u];
    p = vec3f(dq(0u, f32(a & 65535u)), dq(1u, f32(a >> 16u)), dq(2u, f32(b & 65535u)));
  }
  var q = vec4f(dq(3u, i8at(w1, 0u)), dq(4u, i8at(w1, 1u)), dq(5u, i8at(w1, 2u)), dq(6u, i8at(w1, 3u)));
  q = q / max(length(q), 1e-12);
  var s = vec3f(dq(7u, u8at(w2, 0u)), dq(8u, u8at(w2, 1u)), dq(9u, u8at(w2, 2u)));
  let o = dq(10u, u8at(w2, 3u));
  let d = vec3f(dq(11u, u8at(w3, 0u)), dq(12u, u8at(w3, 1u)), dq(13u, u8at(w3, 2u)));
  if ((bitcast<u32>(H[0].w) & 1u) != 0u) {
    p = vec3f(dot(H[8], vec4f(p, 1.0)), dot(H[9], vec4f(p, 1.0)), dot(H[10], vec4f(p, 1.0)));
    q = qmul(H[11], q);
    s = s + vec3f(H[12].x);
  }
  world[i * 4u] = vec4f(p, 1.0);
  world[i * 4u + 1u] = q;
  world[i * 4u + 2u] = vec4f(s, o);
  world[i * 4u + 3u] = vec4f(d, 0.0);
}
`
);
var PROJECT_WGSL = (
  /* wgsl */
  `
struct Cam { view: mat4x4f, campos: vec4f, intr: vec4f, size: vec4f, n: u32, n2: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> C: Cam;
@group(0) @binding(1) var<storage, read> world: array<vec4f>;
@group(0) @binding(2) var<storage, read> sn: array<u32>;
@group(0) @binding(3) var<storage, read> snq: array<f32>;      // 45 offsets, 45 scales
@group(0) @binding(4) var<storage, read_write> splat2d: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> keys: array<u32>;
@group(0) @binding(6) var<storage, read_write> vals: array<u32>;
@group(0) @binding(7) var<storage, read_write> counter: array<atomic<u32>>;   // drawIndirect args

fn shn(i: u32, k: u32) -> f32 {                 // dequantised SN scalar k of splat i
  let w = sn[i * 12u + (k >> 2u)];
  let b = f32((w >> ((k & 3u) * 8u)) & 255u);
  return snq[k] + b * snq[45u + k];
}
fn shc(i: u32, c: u32) -> vec3f {               // coefficient c (1..15) of splat i
  let k = (c - 1u) * 3u;
  return vec3f(shn(i, k), shn(i, k + 1u), shn(i, k + 2u));
}

fn sh_color(i: u32, dc: vec3f, dir: vec3f) -> vec3f {
  let x = dir.x; let y = dir.y; let z = dir.z;
  var r = 0.28209479177387814 * dc;
  if (C.p0 != 0u) { return max(r + 0.5, vec3f(0.0)); }    // SH0-only source (.splq): no higher bands
  r += 0.4886025119029199 * (-y * shc(i, 1u) + z * shc(i, 2u) - x * shc(i, 3u));
  let xx = x * x; let yy = y * y; let zz = z * z; let xy = x * y; let yz = y * z; let xz = x * z;
  r += 1.0925484305920792 * xy * shc(i, 4u) + -1.0925484305920792 * yz * shc(i, 5u)
     + 0.31539156525252005 * (2.0 * zz - xx - yy) * shc(i, 6u) + -1.0925484305920792 * xz * shc(i, 7u)
     + 0.5462742152960396 * (xx - yy) * shc(i, 8u);
  r += -0.5900435899266435 * y * (3.0 * xx - yy) * shc(i, 9u) + 2.890611442640554 * xy * z * shc(i, 10u)
     + -0.4570457994644658 * y * (4.0 * zz - xx - yy) * shc(i, 11u)
     + 0.3731763325901154 * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * shc(i, 12u)
     + -0.4570457994644658 * x * (4.0 * zz - xx - yy) * shc(i, 13u) + 1.445305721320277 * z * (xx - yy) * shc(i, 14u)
     + -0.5900435899266435 * x * (xx - 3.0 * yy) * shc(i, 15u);
  return max(r + 0.5, vec3f(0.0));
}

// C.p1: 0 own sort; 1 sort shared with later eyes (no screen cull); 2 splat2d only, reuse the shared order
fn hide(i: u32) { splat2d[i * 3u] = vec4f(0.0); }

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= C.n2) { return; }
  let own = C.p1 != 2u;
  if (own) {
    vals[i] = i;
    keys[i] = 0xffffffffu;
  }
  if (i >= C.n) { return; }
  let w0 = world[i * 4u];
  if (w0.w == 0.0) { return; }                   // not alive at t
  let p = w0.xyz;
  let mc = (C.view * vec4f(p, 1.0)).xyz;
  let z = mc.z;
  if (z < C.size.z || z > 1e10) { if (!own) { hide(i); } return; }   // C.size.z = near plane per scene (P13)
  let q = world[i * 4u + 1u];
  let so = world[i * 4u + 2u];
  let s = exp(so.xyz);
  let qw = q.x; let qx = q.y; let qy = q.z; let qz = q.w;
  // rotation columns (gsplat normalized_quat_to_rotmat, wxyz)
  let r0 = vec3f(1.0 - 2.0 * (qy * qy + qz * qz), 2.0 * (qx * qy + qw * qz), 2.0 * (qx * qz - qw * qy));
  let r1 = vec3f(2.0 * (qx * qy - qw * qz), 1.0 - 2.0 * (qx * qx + qz * qz), 2.0 * (qy * qz + qw * qx));
  let r2 = vec3f(2.0 * (qx * qz + qw * qy), 2.0 * (qy * qz - qw * qx), 1.0 - 2.0 * (qx * qx + qy * qy));
  let sig = s.x * s.x * mat3x3f(r0 * r0.x, r0 * r0.y, r0 * r0.z)
          + s.y * s.y * mat3x3f(r1 * r1.x, r1 * r1.y, r1 * r1.z)
          + s.z * s.z * mat3x3f(r2 * r2.x, r2 * r2.y, r2 * r2.z);
  let W = mat3x3f(C.view[0].xyz, C.view[1].xyz, C.view[2].xyz);
  let cc = W * sig * transpose(W);
  let fx = C.intr.x; let fy = C.intr.y; let cx = C.intr.z; let cy = C.intr.w;
  let Wd = C.size.x; let Hd = C.size.y;
  let tfx = 0.5 * Wd / fx; let tfy = 0.5 * Hd / fy;
  let lxp = (Wd - cx) / fx + 0.3 * tfx; let lxn = cx / fx + 0.3 * tfx;
  let lyp = (Hd - cy) / fy + 0.3 * tfy; let lyn = cy / fy + 0.3 * tfy;
  let tx = z * min(lxp, max(-lxn, mc.x / z));
  let ty = z * min(lyp, max(-lyn, mc.y / z));
  let j0 = vec3f(fx / z, 0.0, -fx * tx / (z * z));
  let j1 = vec3f(0.0, fy / z, -fy * ty / (z * z));
  let a = dot(j0, cc * j0) + 0.3;
  let b = dot(j0, cc * j1);
  let c = dot(j1, cc * j1) + 0.3;
  let det = a * c - b * b;
  let op = 1.0 / (1.0 + exp(-so.w));
  if (det <= 0.0 || op < 1.0 / 255.0) { if (!own) { hide(i); } return; }
  let conic = vec3f(c / det, -b / det, a / det);
  let mean2 = vec2f(fx * mc.x / z + cx, fy * mc.y / z + cy);
  let bm = 0.5 * (a + c);
  let v1 = bm + sqrt(max(0.01, bm * bm - det));
  // beyond sqrt(2 ln(255 op)) sigma the fragment's alpha is under 1/255 and discarded
  let rad = ceil(min(3.0, sqrt(2.0 * log(255.0 * op))) * sqrt(v1));
  let off = rad <= 0.0 || mean2.x + rad <= 0.0 || mean2.x - rad >= Wd || mean2.y + rad <= 0.0 || mean2.y - rad >= Hd;
  if (off && C.p1 != 1u) { if (!own) { hide(i); } return; }
  let col = sh_color(i, world[i * 4u + 3u].xyz, normalize(p - C.campos.xyz));
  splat2d[i * 3u] = vec4f(mean2, z, rad);
  splat2d[i * 3u + 1u] = vec4f(conic, op);
  splat2d[i * 3u + 2u] = vec4f(col, 0.0);
  if (!own) { return; }
  keys[i] = bitcast<u32>(z);
  atomicAdd(&counter[1], 1u);
}
`
);
var SORT_WGSL = (
  /* wgsl */
  `
struct SortU { k: u32, j: u32, mode: u32, p: u32 };
@group(0) @binding(0) var<uniform> S: SortU;
@group(0) @binding(1) var<storage, read_write> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> vals: array<u32>;

@compute @workgroup_size(256)
fn global_step(@builtin(global_invocation_id) gid: vec3u) {
  let t = gid.x;
  let j = S.j;
  let i = 2u * j * (t / j) + (t % j);
  let l = i + j;
  if (l >= arrayLength(&keys)) { return; }
  let asc = (i & S.k) == 0u;
  let ki = keys[i]; let kl = keys[l];
  if ((ki > kl) == asc && ki != kl) {
    keys[i] = kl; keys[l] = ki;
    let vi = vals[i]; vals[i] = vals[l]; vals[l] = vi;
  }
}

var<workgroup> sk: array<u32, 512>;
var<workgroup> sv: array<u32, 512>;

fn lstep(t: u32, base: u32, k: u32, j: u32) {
  let i = 2u * j * (t / j) + (t % j);
  let l = i + j;
  let asc = ((base + i) & k) == 0u;
  let ki = sk[i]; let kl = sk[l];
  if ((ki > kl) == asc && ki != kl) {
    sk[i] = kl; sk[l] = ki;
    let vi = sv[i]; sv[i] = sv[l]; sv[l] = vi;
  }
}

// mode 0: full bitonic sort of every 512-block (k = 2..512); mode 1: finish merge stage S.k for j = 256..1
@compute @workgroup_size(256)
fn local_sort(@builtin(local_invocation_id) lid: vec3u, @builtin(workgroup_id) wid: vec3u) {
  let t = lid.x;
  let base = wid.x * 512u;
  sk[t] = keys[base + t]; sk[t + 256u] = keys[base + t + 256u];
  sv[t] = vals[base + t]; sv[t + 256u] = vals[base + t + 256u];
  workgroupBarrier();
  if (S.mode == 0u) {
    for (var k = 2u; k <= 512u; k = k * 2u) {
      for (var j = k / 2u; j > 0u; j = j / 2u) {
        lstep(t, base, k, j);
        workgroupBarrier();
      }
    }
  } else {
    for (var j = 256u; j > 0u; j = j / 2u) {
      lstep(t, base, S.k, j);
      workgroupBarrier();
    }
  }
  keys[base + t] = sk[t]; keys[base + t + 256u] = sk[t + 256u];
  vals[base + t] = sv[t]; vals[base + t + 256u] = sv[t + 256u];
}
`
);
var RASTER_WGSL = (
  /* wgsl */
  `
struct Cam { view: mat4x4f, campos: vec4f, intr: vec4f, size: vec4f, n: u32, n2: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> C: Cam;
@group(0) @binding(1) var<storage, read> splat2d: array<vec4f>;
@group(0) @binding(2) var<storage, read> vals: array<u32>;

// Real-world depth (WebXR depth-sensing, matchDepthView false); see Occlusion in xr.ts.
// params: rawValueToMeters, kind (0 off, 1 float32, 2 uint16), depth size
// extra: near, margin (metres), far, w 1 = texels are hardware depth 0..1 between near and far (Quest), 0 = metres from near
// dbg.x 1: occluded fragments are tinted red instead of dropped
struct Occ { F: mat4x4f, zrow: vec4f, params: vec4f, extra: vec4f, dbg: vec4f };
@group(1) @binding(0) var<uniform> O: Occ;
@group(1) @binding(1) var depth_f32: texture_2d<f32>;
@group(1) @binding(2) var depth_u16: texture_2d<u32>;

fn real_occludes(px: vec2f, z: f32) -> bool {
  let kind = O.params.y;
  if (kind < 0.5) { return false; }
  let w = vec4f(px * z, z, 1.0);
  let h = O.F * w;
  if (h.w <= 0.0) { return false; }
  let uv = h.xy / h.w;
  if (any(uv < vec2f(0.0)) || any(uv >= vec2f(1.0))) { return false; }
  let t = vec2i(uv * O.params.zw);
  var raw: f32;
  if (kind > 1.5) { raw = f32(textureLoad(depth_u16, t, 0).r); } else { raw = textureLoad(depth_f32, t, 0).r; }
  let dist = -dot(O.zrow, w);
  if (O.extra.w > 0.5) {
    let n = O.extra.x; let f = O.extra.z;
    let d = select(raw, raw / 65535.0, kind > 1.5);
    if (d <= 0.0 || d >= 1.0) { return false; }
    return n * f / (f - d * (f - n)) + O.extra.y < dist;
  }
  let meters = raw * O.params.x;
  return meters > 0.0 && meters + O.extra.y < dist - O.extra.x;
}

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) d: vec2f,
  @location(1) conic: vec3f,
  @location(2) col: vec4f,
  @location(3) @interpolate(flat) z: f32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let idx = vals[ii];
  let a = splat2d[idx * 3u];
  let b = splat2d[idx * 3u + 1u];
  let c = splat2d[idx * 3u + 2u];
  let corner = vec2f(f32(vi & 1u) * 2.0 - 1.0, f32((vi >> 1u) & 1u) * 2.0 - 1.0);
  let px = a.xy + corner * a.w;
  var o: VOut;
  o.pos = vec4f(px.x / C.size.x * 2.0 - 1.0, 1.0 - px.y / C.size.y * 2.0, 0.0, 1.0);
  o.d = corner * a.w;
  o.conic = b.xyz;
  o.col = vec4f(c.xyz, b.w);
  o.z = a.z;
  return o;
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let d = v.d;
  let sigma = 0.5 * (v.conic.x * d.x * d.x + v.conic.z * d.y * d.y) + v.conic.y * d.x * d.y;
  if (sigma < 0.0) { discard; }
  let alpha = min(0.999, v.col.w * exp(-sigma));
  if (alpha < 1.0 / 255.0) { discard; }
  if (real_occludes(v.pos.xy, v.z)) {
    if (O.dbg.x < 0.5) { discard; }
    return vec4f(alpha, 0.0, 0.0, alpha);
  }
  return vec4f(v.col.rgb * alpha, alpha);
}
`
);
var BLIT_WGSL = (
  /* wgsl */
  `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> bg: vec4f;    // background behind the premultiplied splats (a=0 -> transparent)
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment
fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let c = textureLoad(src, vec2i(p.xy), 0);
  let rgb = clamp(c.rgb + (1.0 - c.a) * bg.rgb * bg.a, vec3f(0.0), vec3f(1.0));
  let a = clamp(c.a + (1.0 - c.a) * bg.a, 0.0, 1.0);
  return vec4f(rgb, a);
}
`
);
var BLIT_XR_WGSL = (
  /* wgsl */
  `
// gain: linear rgb gain, w contrast; grade: x saturation, y on (recolor.ts)
// hud: x fps, y splats in thousands, z on, w digit height in px \u2014 a seven-segment readout inside the
// headset (DOM overlays are not visible in immersive-ar), below the centre of each eye.
// rs (P40 Quest render scale): xy = splat-target size / eye viewport size, z = 1 when they differ (bilinear upscale)
struct BlitU { origin: vec2f, flags: vec2f, gain: vec4f, grade: vec4f, hud: vec4f, rs: vec4f }; // flags.x keepAlpha, flags.y encodeSrgb
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> U: BlitU;

fn lin2srgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

// segments a b c d e f g = bits 0..6; u, v in [0, 1] inside one digit cell (v down)
fn segOn(bits: u32, u: f32, v: f32) -> bool {
  let t = 0.16;
  let top = v < t; let bot = v > 1.0 - t; let mid = abs(v - 0.5) < t * 0.5;
  let left = u < t; let right = u > 1.0 - t; let inner = u >= t * 0.5 && u <= 1.0 - t * 0.5;
  let upper = v <= 0.5; let lower = v >= 0.5;
  return ((bits & 1u) != 0u && top && inner) || ((bits & 2u) != 0u && right && upper) ||
         ((bits & 4u) != 0u && right && lower) || ((bits & 8u) != 0u && bot && inner) ||
         ((bits & 16u) != 0u && left && lower) || ((bits & 32u) != 0u && left && upper) ||
         ((bits & 64u) != 0u && mid && inner);
}

/** 0 outside the readout, 1 background, 2 lit segment */
fn hudAt(p: vec2f, dims: vec2f) -> u32 {
  var digs = array<u32, 10>(0x3Fu, 0x06u, 0x5Bu, 0x4Fu, 0x66u, 0x6Du, 0x7Du, 0x07u, 0x7Fu, 0x6Fu);
  let dh = U.hud.w; let dw = dh * 0.55; let gap = dh * 0.25; let cell = dw + gap;
  let boxw = 7.0 * cell;
  let q = p - vec2f(dims.x * 0.5 - boxw * 0.5, dims.y * 0.66);
  if (q.x < -gap || q.y < -gap || q.x > boxw + gap || q.y > dh + gap) { return 0u; }
  let ci = i32(floor(q.x / cell));
  let u = (q.x - f32(ci) * cell) / dw; let v = q.y / dh;
  if (ci < 0 || ci > 6 || ci == 3 || u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) { return 1u; }
  var n = u32(max(U.hud.x, 0.0) + 0.5); var pos = 2 - ci;
  if (ci > 3) { n = u32(max(U.hud.y, 0.0) + 0.5); pos = 6 - ci; }
  n = min(n, 999u);
  var p10 = 1u;
  for (var k = 0; k < pos; k++) { p10 = p10 * 10u; }
  if (n < p10 && pos > 0) { return 1u; }
  return select(1u, 2u, segOn(digs[(n / p10) % 10u], u, v));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let dims = vec2i(textureDimensions(src));
  var texel = clamp(vec2i(p.xy) - vec2i(U.origin), vec2i(0), dims - vec2i(1));
  var hdims = vec2f(dims);
  var c = textureLoad(src, texel, 0);
  if (U.rs.z > 0.5) {                            // splats rendered below the eye resolution: bilinear upscale
    let q = p.xy - U.origin;
    let f = q * U.rs.xy - vec2f(0.5);
    let i0 = vec2i(floor(f)); let w = f - floor(f); let mx = dims - vec2i(1);
    let c00 = textureLoad(src, clamp(i0, vec2i(0), mx), 0);
    let c10 = textureLoad(src, clamp(i0 + vec2i(1, 0), vec2i(0), mx), 0);
    let c01 = textureLoad(src, clamp(i0 + vec2i(0, 1), vec2i(0), mx), 0);
    let c11 = textureLoad(src, clamp(i0 + vec2i(1, 1), vec2i(0), mx), 0);
    c = mix(mix(c00, c10, w.x), mix(c01, c11, w.x), w.y);
    texel = vec2i(q);
    hdims = vec2f(dims) / U.rs.xy;
  }
  var rgb = clamp(c.rgb, vec3f(0.0), vec3f(1.0));
  if (U.grade.y > 0.5 && c.a > 1e-4) {
    var x = clamp(c.rgb / c.a, vec3f(0.0), vec3f(1.0));
    x = pow(min(pow(x, vec3f(2.2)) * U.gain.rgb, vec3f(1.0)), vec3f(1.0 / 2.2));
    x = (x - 0.5) * U.gain.w + 0.5;
    x = mix(vec3f(dot(x, vec3f(0.2126, 0.7152, 0.0722))), x, U.grade.x);
    rgb = clamp(x, vec3f(0.0), vec3f(1.0)) * clamp(c.a, 0.0, 1.0);
  }
  var a = select(1.0, clamp(c.a, 0.0, 1.0), U.flags.x > 0.5);
  if (U.hud.z > 0.5) {
    let h = hudAt(vec2f(texel), hdims);
    if (h > 0u) {
      // lit: green >= 70 fps, amber >= 55, red below
      let lit = select(select(vec3f(0.9, 0.1, 0.1), vec3f(0.9, 0.6, 0.05), U.hud.x >= 55.0), vec3f(0.1, 0.85, 0.2), U.hud.x >= 70.0);
      rgb = select(vec3f(0.01), lit, h == 2u);
      a = 0.9;
    }
  }
  if (U.flags.y > 0.5) { rgb = lin2srgb(rgb); }
  return vec4f(rgb, a);
}
`
);
var DIFF_WGSL = (
  /* wgsl */
  `
struct DiffU { ox: f32, oy: f32, dw: f32, dh: f32, refW: f32, refH: f32, gain: f32, pad: f32 };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var refTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> U: DiffU;
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment
fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let c = clamp(textureLoad(src, vec2i(p.xy), 0).rgb, vec3f(0.0), vec3f(1.0));
  let u = (p.xy - vec2f(U.ox, U.oy)) / vec2f(U.dw, U.dh);
  var g = vec3f(0.0);
  if (u.x >= 0.0 && u.y >= 0.0 && u.x < 1.0 && u.y < 1.0) {
    g = textureLoad(refTex, vec2i(u * vec2f(U.refW, U.refH)), 0).rgb;
  }
  return vec4f(clamp(abs(c - g) * U.gain, vec3f(0.0), vec3f(1.0)), 1.0);
}
`
);

// src/splq.ts
var SPLQ_HDR = 256;
var SPLQ_FLAG_SN = 2;
var SPLQ_FLAG_P16 = 4;
function splqSnWords(fr) {
  if (!fr.sn) return null;
  const out = new Uint8Array(fr.n * 48), m = fr.snM, st = fr.snStride, src = fr.sn;
  for (let i = 0; i < fr.n; i++) out.set(src.subarray(i * st, i * st + m), i * 48);
  return new Uint32Array(out.buffer);
}

// src/i18n.ts
var nav = typeof navigator === "undefined" ? void 0 : navigator;
var forced = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("lang");
var LANG = forced === "de" || forced === "en" ? forced : (nav?.languages?.[0] ?? nav?.language ?? "en").toLowerCase().startsWith("de") ? "de" : "en";
var tr = (de, en) => LANG === "de" ? de : en;
function localizeDom(root = document) {
  document.documentElement.lang = LANG;
  if (LANG !== "de") return;
  root.querySelectorAll("[data-de]").forEach((el) => {
    el.textContent = el.dataset.de;
  });
  root.querySelectorAll("[data-de-title]").forEach((el) => {
    el.title = el.dataset.deTitle;
  });
  const t = document.querySelector("title");
  if (t?.dataset.de) document.title = t.dataset.de;
}

// src/recolor.ts
var LUMA = [0.2126, 0.7152, 0.0722];
var MINKOWSKI = 4;
var CLIPPED = 0.98;
var WB_T = [0.35, 0, -0.4];
var WB_G = [-0.08, 0.22, -0.04];
var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
var toLinear = (v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
function imageStats(rgba, scale = 1, premultiplied = false, step = 1) {
  let w = 0, wIllum = 0, logY = 0, chroma = 0, y1 = 0, y2 = 0;
  const p = [0, 0, 0];
  for (let i = 0; i + 3 < rgba.length; i += 4 * step) {
    const a = premultiplied ? rgba[i + 3] * scale : 1;
    if (a < 0.5) continue;
    const k = scale / a;
    const c = [clamp(rgba[i] * k, 0, 1), clamp(rgba[i + 1] * k, 0, 1), clamp(rgba[i + 2] * k, 0, 1)];
    const yd = c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
    chroma += a * (Math.abs(c[0] - yd) + Math.abs(c[1] - yd) + Math.abs(c[2] - yd)) / 3;
    y1 += a * yd;
    y2 += a * yd * yd;
    const l = [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])];
    logY += a * Math.log(l[0] * LUMA[0] + l[1] * LUMA[1] + l[2] * LUMA[2] + 1e-3);
    w += a;
    if (Math.max(c[0], c[1], c[2]) >= CLIPPED) continue;
    for (let j = 0; j < 3; j++) p[j] += a * l[j] ** MINKOWSKI;
    wIllum += a;
  }
  if (w <= 0) return null;
  const e = wIllum > 0 ? p.map((v) => (v / wIllum) ** (1 / MINKOWSKI)) : [1, 1, 1];
  const ey = e[0] * LUMA[0] + e[1] * LUMA[1] + e[2] * LUMA[2];
  const mean = y1 / w;
  return {
    illum: ey > 1e-6 ? e.map((v) => v / ey) : [1, 1, 1],
    logY: logY / w,
    chroma: chroma / w,
    spread: Math.sqrt(Math.max(0, y2 / w - mean * mean))
  };
}
function estimateGrade(room, content, strength) {
  const ref = content ?? { illum: [1, 1, 1], logY: room.logY, chroma: room.chroma, spread: room.spread };
  const lr = room.illum.map((v, i) => Math.log(Math.max(v, 1e-4) / Math.max(ref.illum[i], 1e-4)));
  const a = lr[0] - lr[1], b = lr[2] - lr[1];
  const tr2 = WB_T[0] - WB_T[1], gr = WB_G[0] - WB_G[1];
  const tb = WB_T[2] - WB_T[1], gb = WB_G[2] - WB_G[1];
  const det = tr2 * gb - gr * tb;
  const s = clamp(strength, 0, 1);
  const ratio = (num, den, lo, hi) => 1 + (clamp(den > 1e-4 ? num / den : 1, lo, hi) - 1) * s;
  return {
    exposure: s * clamp((room.logY - ref.logY) / Math.LN2, -2, 2),
    temperature: s * clamp((a * gb - gr * b) / det, -1, 1),
    tint: s * clamp((tr2 * b - a * tb) / det, -1, 1),
    saturation: ratio(room.chroma, ref.chroma, 0.5, 1.5),
    contrast: ratio(room.spread, ref.spread, 0.7, 1.3)
  };
}
function gradeGain(g) {
  const e = 2 ** g.exposure;
  const t = clamp(g.temperature, -1, 1);
  const n = clamp(g.tint, -1, 1);
  return [
    e * (1 + t * WB_T[0]) * (1 + n * WB_G[0]),
    e * (1 + n * WB_G[1]),
    e * (1 + t * WB_T[2]) * (1 + n * WB_G[2])
  ];
}
function describeGrade(g) {
  const sg = (v) => (v >= 0 ? "+" : "") + v.toFixed(2);
  return `${tr("Bel", "Exp")} ${sg(g.exposure)} \xB7 Temp ${sg(g.temperature)} \xB7 Tint ${sg(g.tint)} \xB7 ${tr("S\xE4tt", "Sat")} ${g.saturation.toFixed(2)} \xB7 ${tr("Kontr", "Contr")} ${g.contrast.toFixed(2)}`;
}
var SETTLE_MS = 700;
var SAMPLE_W = 160;
var MIN_SPREAD = 0.02;
function withTimeout(p, ms, what, onLate) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      reject(new Error(`${what} timed out after ${ms}ms`));
    }, ms);
    p.then(
      (v) => {
        if (done) {
          onLate?.(v);
          return;
        }
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}
var stopStream = (s) => s.getTracks().forEach((t) => t.stop());
async function captureRoom(timeoutMs = 5e3) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera access (getUserMedia)");
  const stream = await withTimeout(
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 640 } }, audio: false }),
    timeoutMs,
    "getUserMedia",
    stopStream
  );
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await withTimeout(video.play(), timeoutMs, "camera play");
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const vw = video.videoWidth || 4, vh = video.videoHeight || 3;
    const w = SAMPLE_W, h = Math.max(1, Math.round(SAMPLE_W * vh / vw));
    const ctx = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(video, 0, 0, w, h);
    const stats = imageStats(ctx.getImageData(0, 0, w, h).data, 1 / 255);
    if (!stats || stats.spread < MIN_SPREAD) throw new Error("camera frame is blank");
    return stats;
  } finally {
    stopStream(stream);
  }
}

// src/renderer.ts
var renderCfg = { near: 0.01 };
var isQ = (g) => g.q === true;
var ST = GPUBufferUsage.STORAGE;
var CD = GPUBufferUsage.COPY_DST;
var CS = GPUBufferUsage.COPY_SRC;
var PASSES = ["eval", "project", "sort", "raster", "blit"];
function nextPow2(n) {
  let p = 512;
  while (p < n) p *= 2;
  return p;
}
var Renderer = class {
  device;
  format;
  bytes = /* @__PURE__ */ new Map();
  // live GPU allocations by name
  peakBytes = 0;
  evalPipe;
  evalqPipe;
  projPipe;
  dummySn;
  dummySnq;
  sortGlobal;
  sortLocal;
  rasterPipe;
  blitPipe;
  diffPipe = null;
  evalU;
  camU;
  indirect;
  bgU;
  diffU = null;
  sortU = null;
  sortSteps = [];
  cap = 0;
  n2 = 0;
  world;
  splat2d;
  keys;
  vals;
  target = null;
  targetSize = [0, 0];
  xrTargets = [];
  xrBlitPipe = null;
  xrBlitFormat = null;
  xrBlitU = null;
  xrBlitData = new Float32Array(20);
  /** P40 (Quest): sort only every `sortEvery`-th frame of the same section; frames in between reuse the last order
   *  (the order of slowly moving splats barely changes between 72 Hz frames). 1 = sort every frame (default). */
  sortEvery = 1;
  sortAge = 0;
  sortSrc = null;
  sortN = -1;
  reuseOrder(g) {
    const n = isQ(g) ? g.n : g.ps.n;
    if (this.sortEvery > 1 && this.sortSrc === g && this.sortN === n && this.sortAge < this.sortEvery - 1) {
      this.sortAge++;
      return true;
    }
    this.sortSrc = g;
    this.sortN = n;
    this.sortAge = 0;
    return false;
  }
  evalScratch = new ArrayBuffer(16);
  evalF = new Float32Array(this.evalScratch);
  evalI = new Uint32Array(this.evalScratch);
  camScratch = new ArrayBuffer(128);
  camF = new Float32Array(this.camScratch);
  camI = new Uint32Array(this.camScratch);
  indirectReset = new Uint32Array([4, 0, 0, 0]);
  views = /* @__PURE__ */ new WeakMap();
  blitBGs = /* @__PURE__ */ new WeakMap();
  occLayout;
  occFloat;
  occUint;
  occOff;
  occSlots = [];
  ts = null;
  lastTimings = null;
  timingsLog = [];
  visibleBuf;
  constructor(device, format, timestamps) {
    this.device = device;
    this.format = format;
    const mod = (code) => device.createShaderModule({ code });
    const cp = (code, entryPoint = "main") => device.createComputePipeline({ layout: "auto", compute: { module: mod(code), entryPoint } });
    this.evalPipe = cp(EVAL_WGSL);
    this.evalqPipe = cp(EVALQ_WGSL);
    this.projPipe = cp(PROJECT_WGSL);
    const sm = mod(SORT_WGSL);
    this.sortGlobal = device.createComputePipeline({ layout: "auto", compute: { module: sm, entryPoint: "global_step" } });
    this.sortLocal = device.createComputePipeline({ layout: "auto", compute: { module: sm, entryPoint: "local_sort" } });
    const rm = mod(RASTER_WGSL);
    const blend = { srcFactor: "one-minus-dst-alpha", dstFactor: "one", operation: "add" };
    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    const rasterBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: V, buffer: { type: "uniform" } },
      { binding: 1, visibility: V, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: V, buffer: { type: "read-only-storage" } }
    ] });
    this.occLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: F, buffer: { type: "uniform" } },
      { binding: 1, visibility: F, texture: { sampleType: "unfilterable-float" } },
      { binding: 2, visibility: F, texture: { sampleType: "uint" } }
    ] });
    const tex1 = (format2) => device.createTexture({ size: [1, 1], format: format2, usage: GPUTextureUsage.TEXTURE_BINDING });
    this.occFloat = tex1("r32float");
    this.occUint = tex1("r16uint");
    this.occOff = this.occSlot(-1).bg;
    this.rasterPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [rasterBGL, this.occLayout] }),
      vertex: { module: rm, entryPoint: "vs" },
      fragment: { module: rm, entryPoint: "fs", targets: [{ format: "rgba16float", blend: { color: blend, alpha: blend } }] },
      primitive: { topology: "triangle-strip" }
    });
    const bm = mod(BLIT_WGSL);
    this.blitPipe = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: bm, entryPoint: "vs" },
      fragment: { module: bm, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" }
    });
    this.bgU = this.buf("bgU", 16, GPUBufferUsage.UNIFORM | CD);
    this.evalU = this.buf("evalU", 16, GPUBufferUsage.UNIFORM | CD);
    this.camU = this.buf("camU", 128, GPUBufferUsage.UNIFORM | CD);
    this.indirect = this.buf("indirect", 16, GPUBufferUsage.INDIRECT | ST | CD | CS);
    this.visibleBuf = this.buf("visibleRead", 16, GPUBufferUsage.MAP_READ | CD);
    this.dummySn = this.buf("dummySn", 48, ST);
    this.dummySnq = this.buf("dummySnq", 360, ST);
    if (timestamps) {
      const n = PASSES.length * 2;
      this.ts = {
        set: device.createQuerySet({ type: "timestamp", count: n }),
        resolve: this.buf("tsResolve", n * 8, GPUBufferUsage.QUERY_RESOLVE | CS),
        read: [0, 1, 2].map((i) => this.buf(`tsRead${i}`, n * 8, GPUBufferUsage.MAP_READ | CD)),
        busy: [false, false, false],
        next: 0
      };
    }
  }
  /** desktop canvas background, linear 0..1 + alpha (a=0 keeps canvas transparent for CSS runway stage) */
  setBackground(r, g, b, a = 1) {
    this.device.queue.writeBuffer(this.bgU, 0, new Float32Array([r, g, b, a]));
  }
  /** grade applied by the XR eye blit; null turns it off */
  setGrade(g) {
    const d = this.xrBlitData;
    if (!g) {
      d.fill(0, 4, 12);
      return;
    }
    d.set(gradeGain(g), 4);
    d[7] = g.contrast;
    d[8] = g.saturation;
    d[9] = 1;
  }
  /** P40: in-headset readout (fps, splats in thousands) drawn by the XR eye blit; px = digit height, 0 turns it off */
  setHud(fps, kSplats, px) {
    const d = this.xrBlitData;
    d[12] = fps;
    d[13] = kSplats;
    d[14] = px > 0 ? 1 : 0;
    d[15] = px;
  }
  /**
   * P40 bench/test hook: run the XR eye blit (HUD on) from a cleared w×h float target into an rgba8unorm texture and
   * return how many pixels are lit (green/amber/red) and dark (HUD background) — proves the WGSL compiles and draws.
   */
  async debugXrBlit(w, h, fps, kSplats, px) {
    const dev = this.device;
    const src = dev.createTexture({ size: [w, h], format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const dst = dev.createTexture({ size: [w, h], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const { pipe, uni } = this.xrBlitPipeline("rgba8unorm");
    const keep = this.xrBlitData.slice();
    this.setHud(fps, kSplats, px);
    this.xrBlitData[0] = 0;
    this.xrBlitData[1] = 0;
    this.xrBlitData[2] = 1;
    this.xrBlitData[3] = 0;
    this.xrBlitData[18] = 0;
    dev.queue.writeBuffer(uni, 0, this.xrBlitData);
    this.xrBlitData.set(keep);
    const enc = dev.createCommandEncoder();
    const clr = enc.beginRenderPass({ colorAttachments: [{ view: src.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
    clr.end();
    const bp = enc.beginRenderPass({ colorAttachments: [{ view: dst.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
    bp.setPipeline(pipe);
    bp.setBindGroup(0, dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: src.createView() },
      { binding: 1, resource: { buffer: uni } }
    ] }));
    bp.draw(3);
    bp.end();
    const bpr = Math.ceil(w * 4 / 256) * 256;
    const rb = dev.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyTextureToBuffer({ texture: dst }, { buffer: rb, bytesPerRow: bpr }, [w, h]);
    dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const px8 = new Uint8Array(rb.getMappedRange());
    let lit = 0, dark = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * bpr + x * 4;
      if (px8[i + 3] < 200) continue;
      if (Math.max(px8[i], px8[i + 1]) > 100) lit++;
      else dark++;
    }
    rb.unmap();
    rb.destroy();
    src.destroy();
    dst.destroy();
    return { lit, dark, total: w * h };
  }
  buf(name, size, usage) {
    const b = this.device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage, label: name });
    this.bytes.set(name, (this.bytes.get(name) ?? 0) + b.size);
    this.peakBytes = Math.max(this.peakBytes, this.gpuBytes());
    return b;
  }
  free(name, b) {
    this.bytes.set(name, (this.bytes.get(name) ?? 0) - b.size);
    b.destroy();
  }
  gpuBytes() {
    let s = 0;
    for (const v of this.bytes.values()) s += v;
    if (this.target) s += this.targetSize[0] * this.targetSize[1] * 8;
    for (const t of this.xrTargets) s += t.width * t.height * 8;
    return s;
  }
  /** Allocates the section's buffers; the data goes up through {@link pump}. */
  upload(ps) {
    const pending = [];
    const mk = (nm, data) => {
      const b = this.buf(`sec_${nm}`, data.byteLength, ST | CD);
      pending.push({ buf: b, data, done: 0 });
      return b;
    };
    const snq = new Float32Array(90);
    snq.set(ps.snOffset, 0);
    snq.set(ps.snScale, 45);
    const g = { ps, hdr: mk("hdr", ps.hdr), knots: mk("knots", ps.knots), sn: mk("sn", ps.sn), snq: mk("snq", snq), bytes: 0, pending };
    g.bytes = g.hdr.size + g.knots.size + g.sn.size + g.snq.size;
    this.ensureCapacity(ps.n);
    return g;
  }
  /** Issue up to `budget` bytes of a section's pending writes (Infinity finishes it). */
  pump(g, budget) {
    const q = this.device.queue;
    while (g.pending?.length && budget > 0) {
      const w = g.pending[0];
      const len = Math.min(w.data.byteLength - w.done, budget >= 2 ** 30 ? Infinity : Math.max(4, budget & ~3));
      q.writeBuffer(w.buf, w.done, w.data.buffer, w.data.byteOffset + w.done, len);
      w.done += len;
      budget -= len;
      if (w.done >= w.data.byteLength) g.pending.shift();
    }
    if (g.pending && !g.pending.length) g.pending = null;
  }
  release(g) {
    if (isQ(g)) {
      this.free("q_hdr", g.hdr);
      this.free("q_data", g.data);
      if (g.p16) this.free("q_p16", g.p16);
      if (g.sn) this.free("q_sn", g.sn);
      if (g.snq) this.free("q_snq", g.snq);
      return;
    }
    this.free("sec_hdr", g.hdr);
    this.free("sec_knots", g.knots);
    this.free("sec_sn", g.sn);
    this.free("sec_snq", g.snq);
  }
  /** upload a .splq frame into `slot` (reused when it is large enough and has the same optional blocks, else replaced). */
  uploadQ(fr, slot = null) {
    const opt = fr.flags & (SPLQ_FLAG_SN | SPLQ_FLAG_P16);
    if (!slot || slot.cap < fr.n || slot.flags !== opt) {
      if (slot) this.release(slot);
      const cap = Math.ceil(fr.n * 1.05) + 256;
      slot = {
        q: true,
        n: fr.n,
        cap,
        hdr: this.buf("q_hdr", SPLQ_HDR, GPUBufferUsage.UNIFORM | CD),
        data: this.buf("q_data", cap * 16, ST | CD),
        p16: fr.p16 ? this.buf("q_p16", cap * 8, ST | CD) : null,
        sn: fr.sn ? this.buf("q_sn", cap * 48, ST | CD) : null,
        snq: fr.sn ? this.buf("q_snq", 360, ST | CD) : null,
        flags: opt,
        bytes: 0
      };
      slot.bytes = slot.hdr.size + slot.data.size + (slot.p16?.size ?? 0) + (slot.sn?.size ?? 0) + (slot.snq?.size ?? 0);
    }
    slot.n = fr.n;
    this.device.queue.writeBuffer(slot.hdr, 0, fr.header.buffer, fr.header.byteOffset, SPLQ_HDR);
    this.device.queue.writeBuffer(slot.data, 0, fr.data.buffer, fr.data.byteOffset, fr.n * 16);
    if (fr.p16 && slot.p16) this.device.queue.writeBuffer(slot.p16, 0, fr.p16.buffer, fr.p16.byteOffset, fr.n * 8);
    const snw = splqSnWords(fr);
    if (snw && slot.sn && slot.snq) {
      this.device.queue.writeBuffer(slot.sn, 0, snw.buffer, 0, fr.n * 48);
      this.device.queue.writeBuffer(slot.snq, 0, fr.snq.buffer, fr.snq.byteOffset, 360);
    }
    this.ensureCapacity(fr.n);
    return slot;
  }
  ensureCapacity(n) {
    if (n <= this.cap) return;
    if (this.cap) {
      this.free("world", this.world);
      this.free("splat2d", this.splat2d);
      this.free("keys", this.keys);
      this.free("vals", this.vals);
    }
    this.cap = n;
    this.n2 = nextPow2(n);
    this.world = this.buf("world", n * 64, ST | CS);
    this.splat2d = this.buf("splat2d", n * 48, ST);
    this.keys = this.buf("keys", this.n2 * 4, ST | CS);
    this.vals = this.buf("vals", this.n2 * 4, ST | CS);
    const steps = [{ k: 512, j: 0, mode: 0 }];
    for (let k = 1024; k <= this.n2; k *= 2) {
      for (let j = k / 2; j >= 512; j /= 2) steps.push({ k, j, mode: 2 });
      steps.push({ k, j: 0, mode: 1 });
    }
    this.sortSteps = steps;
    if (this.sortU) this.free("sortU", this.sortU);
    this.sortU = this.buf("sortU", steps.length * 256, GPUBufferUsage.UNIFORM | CD);
    const u = new Uint32Array(steps.length * 64);
    steps.forEach((s, i) => {
      u[i * 64] = s.k;
      u[i * 64 + 1] = s.j;
      u[i * 64 + 2] = s.mode === 2 ? 0 : s.mode;
    });
    this.device.queue.writeBuffer(this.sortU, 0, u);
    this.sortBGs = steps.map((s, idx) => {
      const pipe = s.mode === 2 ? this.sortGlobal : this.sortLocal;
      return this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.sortU, offset: idx * 256, size: 16 } },
        { binding: 1, resource: { buffer: this.keys, size: this.n2 * 4 } },
        { binding: 2, resource: { buffer: this.vals, size: this.n2 * 4 } }
      ] });
    });
    this.capVersion++;
  }
  sortBGs = [];
  capVersion = 0;
  bindGroups(g) {
    if (g.bgs && g.bgs.ver === this.capVersion) return g.bgs;
    const dev = this.device;
    const q = isQ(g);
    g.bgs = {
      ver: this.capVersion,
      eval: q ? dev.createBindGroup({ layout: this.evalqPipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: g.hdr } },
        { binding: 1, resource: { buffer: g.data } },
        { binding: 2, resource: { buffer: this.world } },
        { binding: 3, resource: { buffer: g.p16 ?? this.dummySn } }
      ] }) : dev.createBindGroup({ layout: this.evalPipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.evalU } },
        { binding: 1, resource: { buffer: g.hdr } },
        { binding: 2, resource: { buffer: g.knots } },
        { binding: 3, resource: { buffer: this.world } }
      ] }),
      proj: dev.createBindGroup({ layout: this.projPipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.camU } },
        { binding: 1, resource: { buffer: this.world } },
        { binding: 2, resource: { buffer: q ? g.sn ?? this.dummySn : g.sn } },
        { binding: 3, resource: { buffer: q ? g.snq ?? this.dummySnq : g.snq } },
        { binding: 4, resource: { buffer: this.splat2d } },
        { binding: 5, resource: { buffer: this.keys } },
        { binding: 6, resource: { buffer: this.vals } },
        { binding: 7, resource: { buffer: this.indirect } }
      ] }),
      raster: dev.createBindGroup({ layout: this.rasterPipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.camU } },
        { binding: 1, resource: { buffer: this.splat2d } },
        { binding: 2, resource: { buffer: this.vals, size: this.n2 * 4 } }
      ] })
    };
    return g.bgs;
  }
  sortDispatches() {
    return this.sortSteps.length;
  }
  ensureTarget(w, h) {
    if (this.target && this.targetSize[0] === w && this.targetSize[1] === h) return;
    this.target?.destroy();
    this.target = this.device.createTexture({ size: [w, h], format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    this.targetSize = [w, h];
    this.peakBytes = Math.max(this.peakBytes, this.gpuBytes());
  }
  /** encode one frame at global frame time t (fractional) into `out` (canvas texture) and submit.
   *  opts.diff: show |render − ref| (difference view) instead of the render. */
  frame(g, t, cam, out, opts = {}) {
    const dev = this.device;
    const ts = opts.timing && this.ts && !this.ts.busy[this.ts.next] ? this.ts : null;
    const enc = dev.createCommandEncoder();
    this.record(
      enc,
      g,
      t,
      cam,
      out ? { kind: "canvas", texture: out, diff: opts.diff ?? null } : null,
      true,
      ts,
      null,
      this.reuseOrder(g) ? 2 : 0
    );
    let slot = -1;
    if (ts) {
      slot = ts.next;
      ts.next = (ts.next + 1) % ts.read.length;
      ts.busy[slot] = true;
      const cnt = out ? PASSES.length * 2 : (PASSES.length - 1) * 2;
      enc.resolveQuerySet(ts.set, 0, cnt, ts.resolve, 0);
      enc.copyBufferToBuffer(ts.resolve, 0, ts.read[slot], 0, cnt * 8);
    }
    const readVis = opts.readVisible && this.visibleBuf.mapState === "unmapped";
    if (readVis) enc.copyBufferToBuffer(this.indirect, 0, this.visibleBuf, 0, 16);
    dev.queue.submit([enc.finish()]);
    if (ts && slot >= 0) {
      const rb = ts.read[slot], hasBlit = !!out;
      rb.mapAsync(GPUMapMode.READ).then(() => {
        const v = new BigUint64Array(rb.getMappedRange().slice(0));
        rb.unmap();
        ts.busy[slot] = false;
        const r = {};
        PASSES.forEach((nm, p) => {
          if (p < 4 || hasBlit) r[nm] = Number(v[2 * p + 1] - v[2 * p]) / 1e6;
        });
        r.gpu_total = Number(v[hasBlit ? 9 : 7] - v[0]) / 1e6;
        this.lastTimings = r;
        this.timingsLog.push(r);
      }).catch(() => {
        ts.busy[slot] = false;
      });
    }
    if (readVis) {
      this.visibleBuf.mapAsync(GPUMapMode.READ).then(() => {
        this.lastVisible = new Uint32Array(this.visibleBuf.getMappedRange().slice(0))[1];
        this.visibleBuf.unmap();
      }).catch(() => {
      });
    }
  }
  /** Both eyes of one immersive frame. Eval runs on the first eye; each eye is its own submit so its camera uniform is visible to that submit only. */
  frameEyes(g, t, eyes) {
    const shared = eyes.length > 1;
    const reuse = this.reuseOrder(g);
    eyes.forEach((eye, i) => {
      const target = this.xrTarget(i, eye.cam.width, eye.cam.height);
      const enc = this.device.createCommandEncoder();
      const order = reuse ? 2 : shared ? i === 0 ? 1 : 2 : 0;
      this.record(enc, g, t, eye.cam, { kind: "xr", eye }, i === 0, null, target, order, this.occFor(i, eye.occ));
      this.device.queue.submit([enc.finish()]);
    });
  }
  xrTarget(eye, w, h) {
    const cur = this.xrTargets[eye];
    if (cur && cur.width === w && cur.height === h) return cur;
    cur?.destroy();
    const t = this.device.createTexture({
      size: [Math.max(1, w), Math.max(1, h)],
      format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: `xr-eye-${eye}`
    });
    this.xrTargets[eye] = t;
    this.peakBytes = Math.max(this.peakBytes, this.gpuBytes());
    return t;
  }
  occGroup(buf, tex, kind, desc) {
    return this.device.createBindGroup({ layout: this.occLayout, entries: [
      { binding: 0, resource: { buffer: buf } },
      { binding: 1, resource: (tex && kind === "float" ? tex : this.occFloat).createView(tex && kind === "float" ? desc : void 0) },
      { binding: 2, resource: (tex && kind === "uint" ? tex : this.occUint).createView(tex && kind === "uint" ? desc : void 0) }
    ] });
  }
  /** slot -1: the always-off group (zero uniform) */
  occSlot(i) {
    if (i >= 0 && this.occSlots[i]) return this.occSlots[i];
    const buf = this.buf("occU", 128, GPUBufferUsage.UNIFORM | CD);
    const s = { buf, bg: this.occGroup(buf, null, "float"), tex: null, layer: -1 };
    if (i >= 0) this.occSlots[i] = s;
    return s;
  }
  /** Real-world depth test for eye `i` (one uniform per eye, so both survive their submits). */
  occFor(i, occ) {
    if (!occ) return this.occOff;
    const s = this.occSlot(i);
    this.device.queue.writeBuffer(s.buf, 0, occ.data);
    const layer = occ.view?.baseArrayLayer ?? 0;
    if (s.tex !== occ.texture || s.layer !== layer) {
      s.tex = occ.texture;
      s.layer = layer;
      s.bg = this.occGroup(s.buf, occ.texture, occ.kind, occ.view);
    }
    return s.bg;
  }
  xrBlitPipeline(format) {
    if (!this.xrBlitU) this.xrBlitU = this.buf("xrBlitU", 80, GPUBufferUsage.UNIFORM | CD);
    if (!this.xrBlitPipe || this.xrBlitFormat !== format) {
      const bm = this.device.createShaderModule({ code: BLIT_XR_WGSL });
      this.xrBlitPipe = this.device.createRenderPipeline({
        label: "xr-blit",
        layout: "auto",
        vertex: { module: bm, entryPoint: "vs" },
        fragment: { module: bm, entryPoint: "fs", targets: [{ format }] },
        primitive: { topology: "triangle-list" }
      });
      this.xrBlitFormat = format;
    }
    return { pipe: this.xrBlitPipe, uni: this.xrBlitU };
  }
  record(enc, g, t, cam, dest, doEval, ts, raster, order = 0, occ = this.occOff) {
    const dev = this.device, q = isQ(g), n = q ? g.n : g.ps.n;
    this.ensureCapacity(n);
    if (!raster) this.ensureTarget(cam.width, cam.height);
    const target = raster ?? this.target;
    if (doEval && !q) {
      const ps = g.ps, ef = this.evalF;
      ef[0] = t;
      ef[1] = ps.g0;
      ef[2] = Math.max(ps.nframes - 1, 1);
      this.evalI[3] = n;
      dev.queue.writeBuffer(this.evalU, 0, this.evalScratch);
    }
    const cf = this.camF, ci = this.camI;
    cf.set(cam.view, 0);
    cf[16] = cam.campos[0];
    cf[17] = cam.campos[1];
    cf[18] = cam.campos[2];
    cf[20] = cam.fx;
    cf[21] = cam.fy;
    cf[22] = cam.cx;
    cf[23] = cam.cy;
    cf[24] = cam.width;
    cf[25] = cam.height;
    cf[26] = renderCfg.near;
    cf[27] = 0;
    ci[28] = n;
    ci[29] = this.n2;
    ci[30] = q && !g.sn ? 1 : 0;
    ci[31] = order;
    dev.queue.writeBuffer(this.camU, 0, this.camScratch);
    if (order !== 2) dev.queue.writeBuffer(this.indirect, 0, this.indirectReset);
    const tw = (p) => ts ? { querySet: ts.set, beginningOfPassWriteIndex: 2 * p, endOfPassWriteIndex: 2 * p + 1 } : void 0;
    const bgs = this.bindGroups(g);
    if (doEval) {
      const pass2 = enc.beginComputePass({ timestampWrites: tw(0) });
      pass2.setPipeline(q ? this.evalqPipe : this.evalPipe);
      pass2.setBindGroup(0, bgs.eval);
      pass2.dispatchWorkgroups(Math.ceil(n / 256));
      pass2.end();
    }
    let pass = enc.beginComputePass({ timestampWrites: tw(1) });
    pass.setPipeline(this.projPipe);
    pass.setBindGroup(0, bgs.proj);
    pass.dispatchWorkgroups(Math.ceil(this.n2 / 256));
    pass.end();
    if (order !== 2) {
      pass = enc.beginComputePass({ timestampWrites: tw(2) });
      this.sortSteps.forEach((s, idx) => {
        pass.setPipeline(s.mode === 2 ? this.sortGlobal : this.sortLocal);
        pass.setBindGroup(0, this.sortBGs[idx]);
        pass.dispatchWorkgroups(s.mode === 2 ? Math.ceil(this.n2 / 2 / 256) : this.n2 / 512);
      });
      pass.end();
    }
    const targetView = this.viewOf(target);
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: targetView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
      timestampWrites: tw(3)
    });
    rp.setPipeline(this.rasterPipe);
    rp.setBindGroup(0, bgs.raster);
    rp.setBindGroup(1, occ);
    rp.drawIndirect(this.indirect, 0);
    rp.end();
    if (dest?.kind === "canvas") {
      const bp = enc.beginRenderPass({
        colorAttachments: [{ view: dest.texture.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
        timestampWrites: tw(4)
      });
      const df = dest.diff;
      if (df) {
        if (!this.diffPipe) {
          const dm = dev.createShaderModule({ code: DIFF_WGSL });
          this.diffPipe = dev.createRenderPipeline({
            layout: "auto",
            vertex: { module: dm, entryPoint: "vs" },
            fragment: { module: dm, entryPoint: "fs", targets: [{ format: this.format }] },
            primitive: { topology: "triangle-list" }
          });
          this.diffU = this.buf("diffU", 32, GPUBufferUsage.UNIFORM | CD);
        }
        dev.queue.writeBuffer(this.diffU, 0, new Float32Array([df.ox, df.oy, df.dw, df.dh, df.tex.width, df.tex.height, df.gain, 0]));
        bp.setPipeline(this.diffPipe);
        bp.setBindGroup(0, dev.createBindGroup({ layout: this.diffPipe.getBindGroupLayout(0), entries: [
          { binding: 0, resource: this.viewOf(target) },
          { binding: 1, resource: df.tex.createView() },
          { binding: 2, resource: { buffer: this.diffU } }
        ] }));
      } else {
        bp.setPipeline(this.blitPipe);
        bp.setBindGroup(0, this.blitBindGroup(this.blitPipe, target, this.bgU));
      }
      bp.draw(3);
      bp.end();
    } else if (dest?.kind === "xr") {
      const eye = dest.eye;
      const { pipe, uni } = this.xrBlitPipeline(eye.format);
      this.xrBlitData[0] = eye.viewport.x;
      this.xrBlitData[1] = eye.viewport.y;
      this.xrBlitData[2] = eye.keepAlpha ? 1 : 0;
      this.xrBlitData[3] = eye.encodeSrgb ? 1 : 0;
      this.xrBlitData[16] = target.width / eye.viewport.width;
      this.xrBlitData[17] = target.height / eye.viewport.height;
      this.xrBlitData[18] = target.width !== eye.viewport.width || target.height !== eye.viewport.height ? 1 : 0;
      dev.queue.writeBuffer(uni, 0, this.xrBlitData);
      const bp = enc.beginRenderPass({
        colorAttachments: [{
          view: eye.color,
          clearValue: { r: 0, g: 0, b: 0, a: eye.keepAlpha ? 0 : 1 },
          loadOp: eye.clear ? "clear" : "load",
          storeOp: "store"
        }]
      });
      bp.setPipeline(pipe);
      bp.setBindGroup(0, this.blitBindGroup(pipe, target, uni));
      const full = eye.viewport.x === 0 && eye.viewport.y === 0 && eye.viewport.width === eye.attachmentWidth && eye.viewport.height === eye.attachmentHeight;
      if (!full) bp.setViewport(eye.viewport.x, eye.viewport.y, eye.viewport.width, eye.viewport.height, 0, 1);
      bp.draw(3);
      bp.end();
    }
  }
  lastVisible = 0;
  viewOf(tex) {
    let v = this.views.get(tex);
    if (!v) {
      v = tex.createView();
      this.views.set(tex, v);
    }
    return v;
  }
  blitBindGroup(pipe, src, uni) {
    const hit = this.blitBGs.get(src);
    if (hit && hit.pipe === pipe) return hit.bg;
    const entries = [{ binding: 0, resource: this.viewOf(src) }];
    if (uni) entries.push({ binding: 1, resource: { buffer: uni } });
    const bg = this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries });
    this.blitBGs.set(src, { pipe, bg });
    return bg;
  }
  /** float render target -> 8-bit RGB (same clamp as the blit), for PSNR checks. */
  async readTarget() {
    const { w, h, bpr, src } = await this.readTargetHalf();
    const rgb = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      const v = half(src[y * bpr / 2 + x * 4 + c]);
      rgb[(y * w + x) * 3 + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
    return { w, h, rgb };
  }
  /** every `step`-th pixel of the last desktop frame, premultiplied RGBA; null before the first frame. */
  async readTargetRGBA(step = 1) {
    if (!this.target) return null;
    const { w, h, bpr, src } = await this.readTargetHalf();
    const out = new Float32Array(Math.ceil(w * h / step) * 4);
    let o = 0;
    for (let i = 0; i < w * h; i += step) {
      const base = Math.floor(i / w) * (bpr / 2) + i % w * 4;
      for (let c = 0; c < 4; c++) out[o++] = half(src[base + c]);
    }
    return out;
  }
  async readTargetHalf() {
    const [w, h] = this.targetSize;
    const bpr = Math.ceil(w * 8 / 256) * 256;
    const rb = this.device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.MAP_READ | CD });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: this.target }, { buffer: rb, bytesPerRow: bpr }, [w, h]);
    this.device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const src = new Uint16Array(rb.getMappedRange().slice(0));
    rb.destroy();
    return { w, h, bpr, src };
  }
  /** evaluated world attributes of splats `idx` (GPU eval pass output of the last frame). */
  async readWorld(idx) {
    const rb = this.device.createBuffer({ size: this.world.size, usage: GPUBufferUsage.MAP_READ | CD });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.world, 0, rb, 0, this.world.size);
    this.device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const all = new Float32Array(rb.getMappedRange().slice(0));
    rb.destroy();
    return idx.map((i) => all.slice(i * 16, i * 16 + 16));
  }
  /** P40: the whole evaluated world buffer of the last frame (16 floats per splat), raw bytes. */
  async readWorldAll() {
    const rb = this.device.createBuffer({ size: this.world.size, usage: GPUBufferUsage.MAP_READ | CD });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.world, 0, rb, 0, this.world.size);
    this.device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const all = rb.getMappedRange().slice(0);
    rb.destroy();
    return all;
  }
};
function half(h) {
  const s = h & 32768 ? -1 : 1, e = h >> 10 & 31, f = h & 1023;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

// src/bspline.ts
var BSPLINE_DEGREE = 3;
function bsplineWeights(K, uIn) {
  const p = Math.min(BSPLINE_DEGREE, K - 1);
  if (p <= 0) return [1];
  const nInt = K - p - 1;
  const kn = new Array(p + 1).fill(0);
  for (let i = 0; i < nInt; i++) kn.push((i + 1) / (nInt + 1));
  for (let i = 0; i < p + 1; i++) kn.push(1);
  const u = Math.min(Math.max(uIn, 0), 1);
  const m = kn.length - 1;
  let N = [];
  for (let i = 0; i < m; i++) N.push(kn[i] <= u && u < kn[i + 1] || u === 1 && kn[i] < kn[i + 1] && kn[i + 1] === 1 ? 1 : 0);
  for (let d = 1; d <= p; d++) {
    const M = [];
    for (let i = 0; i < m - d; i++) {
      const a = kn[i + d] > kn[i] ? (u - kn[i]) / (kn[i + d] - kn[i]) * N[i] : 0;
      const b = kn[i + d + 1] > kn[i + 1] ? (kn[i + d + 1] - u) / (kn[i + d + 1] - kn[i + 1]) * N[i + 1] : 0;
      M.push(a + b);
    }
    N = M;
  }
  return N.slice(0, K);
}

// src/pack.ts
var GROUP_DIMS = [3, 4, 3, 1, 3];
var HDR_U32 = 8;
function evalSplat(ps, i, t) {
  const h = i * HDR_U32;
  const fi = Math.floor(t);
  const alive = ps.hdr[h] <= fi && fi < ps.hdr[h + 1];
  const span = Math.max(ps.nframes - 1, 1);
  const vals = [];
  for (let g = 0; g < 5; g++) {
    const K = ps.hdr[h + 2] >>> 6 * g & 63, d = GROUP_DIMS[g], off = ps.hdr[h + 3 + g];
    const v = [];
    if (ps.hdr[h + 2] >>> 31) {
      const u = Math.min(Math.max((t - ps.g0) / span, 0), 1);
      const wts = bsplineWeights(K, u);
      for (let c = 0; c < d; c++) {
        let acc = 0;
        for (let j = 0; j < K; j++) if (wts[j] !== 0) acc += wts[j] * ps.knots[off + j * d + c];
        v.push(acc);
      }
    } else {
      let j = 0, w = 0;
      if (K > 1) {
        const tau = Math.min(Math.max((t - ps.g0) * (K - 1) / span, 0), K - 1);
        j = Math.min(Math.floor(tau), K - 2);
        w = tau - j;
      }
      for (let c = 0; c < d; c++) {
        const a = ps.knots[off + j * d + c];
        const b = K > 1 ? ps.knots[off + (j + 1) * d + c] : a;
        v.push(a + (b - a) * w);
      }
    }
    if (g === 1) {
      const nrm = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
      for (let c = 0; c < 4; c++) v[c] /= nrm;
    }
    vals.push(v);
  }
  return { alive, vals };
}

// src/xr.ts
var OCC_MARGIN = 0.02;
function mul4(a, b, out = new Float32Array(16)) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = s;
  }
  return out;
}
function projNear(p) {
  if (Math.abs(p[10]) < 1e-8) return 0;
  const near = p[14] / p[10];
  return near > 0 && near < 10 ? near : 0;
}
var NDC_TO_UV = new Float32Array([0.5, 0, 0, 0, 0, -0.5, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0, 1]);
function occlusionData(cam, scale, eyePose, depthPoseInv, depthProj, uvFromView, rawValueToMeters, kind, width, height, windowDepth = null, out = new Float32Array(32)) {
  const s = scale;
  const E = new Float32Array([s / cam.fx, 0, 0, 0, 0, -s / cam.fy, 0, 0, -s * cam.cx / cam.fx, s * cam.cy / cam.fy, -s, 0, 0, 0, 0, 1]);
  const A = mul4(mul4(depthPoseInv, eyePose), E);
  const F = mul4(mul4(uvFromView, NDC_TO_UV), mul4(depthProj, A));
  out.set(F, 0);
  out[16] = A[2];
  out[17] = A[6];
  out[18] = A[10];
  out[19] = A[14];
  out[20] = rawValueToMeters;
  out[21] = kind === "float" ? 1 : 2;
  out[22] = width;
  out[23] = height;
  out[24] = windowDepth ? windowDepth.near : projNear(depthProj);
  out[25] = OCC_MARGIN;
  out[26] = windowDepth ? windowDepth.far : 0;
  out[27] = windowDepth ? 1 : 0;
  return out;
}
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
var sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
var mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]);
  if (l < 1e-8) return null;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function horizontal(v, up) {
  return norm(sub(v, mul(up, dot(v, up))));
}
function frameOf(forward, upIn) {
  const up = norm(upIn);
  if (!up) return null;
  let fwd = horizontal(forward, up);
  if (!fwd) {
    const hint = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    fwd = norm(cross(hint, up));
    if (!fwd) return null;
  }
  const right = norm(cross(fwd, up));
  if (!right) return null;
  return [right, up, fwd];
}
function m3(cols) {
  const m = new Float32Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 3 + r] = cols[c][r];
  return m;
}
function mulM3(a, b) {
  const m = new Float32Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
    m[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
  }
  return m;
}
function transposeM3(a) {
  const m = new Float32Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 3 + r] = a[r * 3 + c];
  return m;
}
function mulM3V(a, v) {
  return [
    a[0] * v[0] + a[3] * v[1] + a[6] * v[2],
    a[1] * v[0] + a[4] * v[1] + a[7] * v[2],
    a[2] * v[0] + a[5] * v[1] + a[8] * v[2]
  ];
}
function place(cam, center, up, head, headForward, meters) {
  const scene = frameOf(sub(center, cam), up);
  const room = frameOf(headForward, [0, 1, 0]);
  if (!scene || !room) return null;
  const dist = Math.hypot(center[0] - cam[0], center[1] - cam[1], center[2] - cam[2]);
  const scale = dist > 1e-8 && meters > 0 ? meters / dist : 1;
  return {
    R: mulM3(m3(room), transposeM3(m3(scene))),
    scale,
    scale0: scale,
    cam: [cam[0], cam[1], cam[2]],
    anchor: [head[0], head[1], head[2]],
    locked: false
  };
}
function intrinsics(p, width, height) {
  return {
    fx: p[0] * 0.5 * width,
    fy: p[5] * 0.5 * height,
    cx: width * (1 - p[8]) * 0.5,
    cy: height * (1 + p[9]) * 0.5
  };
}
function eyeCamera(p, proj, pose, width, height) {
  const Rt = transposeM3(p.R);
  const c0 = mulM3V(Rt, [pose[0], pose[1], pose[2]]);
  const c1 = mulM3V(Rt, [pose[4], pose[5], pose[6]]);
  const c2 = mulM3V(Rt, [pose[8], pose[9], pose[10]]);
  const r0 = c0;
  const r1 = mul(c1, -1);
  const r2 = mul(c2, -1);
  const eye = [pose[12], pose[13], pose[14]];
  const campos = add(p.cam, mul(mulM3V(Rt, sub(eye, p.anchor)), 1 / p.scale));
  const view = new Float32Array(16);
  const rows = [r0, r1, r2];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) view[c * 4 + r] = rows[r][c];
  view[12] = -(r0[0] * campos[0] + r0[1] * campos[1] + r0[2] * campos[2]);
  view[13] = -(r1[0] * campos[0] + r1[1] * campos[1] + r1[2] * campos[2]);
  view[14] = -(r2[0] * campos[0] + r2[1] * campos[1] + r2[2] * campos[2]);
  view[15] = 1;
  const k = intrinsics(proj, width, height);
  return { view, campos, ...k, width, height };
}
var PLACE_ARM_MS = 400;
var PLACE_ARM_SPAN = 0.12;
var PLACE_YAW_SPAN = 0.1;
var PLACE_JUMP = 0.05;
var PLACE_YAW_JUMP = 0.18;
var SCALE_STEP = 0.08;
var PINCH_ON = 0.016;
var PINCH_OFF = 0.04;
var PINCH_ON_BONE = 0.032;
var PINCH_OFF_BONE = 0.055;
function grabState() {
  return { armAt: null, placing: false, last: null };
}
function pinchClosed(was, gap, radii) {
  const on = radii > 0 ? PINCH_ON : PINCH_ON_BONE;
  const off = radii > 0 ? PINCH_OFF : PINCH_OFF_BONE;
  return was ? gap < off : gap < on;
}
function copy3(v) {
  return [v[0], v[1], v[2]];
}
function yawAboutY(radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const m = new Float32Array(9);
  m[0] = c;
  m[2] = -s;
  m[4] = 1;
  m[6] = s;
  m[8] = c;
  return m;
}
function applyGrab(p, from, to) {
  const [la, lb] = from;
  const [a, b] = to;
  if (Math.hypot(a[0] - la[0], a[1] - la[1], a[2] - la[2]) > PLACE_JUMP) return false;
  if (Math.hypot(b[0] - lb[0], b[1] - lb[1], b[2] - lb[2]) > PLACE_JUMP) return false;
  const lastMid = mul(add(la, lb), 0.5);
  const mid = mul(add(a, b), 0.5);
  let k = 1;
  const lastDist = Math.hypot(lb[0] - la[0], lb[1] - la[1], lb[2] - la[2]);
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (dist >= 0.06 && lastDist >= 0.06) {
    const next = dist / lastDist;
    if (Math.abs(next - 1) <= SCALE_STEP) k = next;
  }
  const lo = p.scale0 * 0.05;
  const hi = p.scale0 * 20;
  if (p.scale > 1e-8) {
    if (p.scale * k < lo) k = lo / p.scale;
    else if (p.scale * k > hi) k = hi / p.scale;
  }
  let yaw = 0;
  const spanH = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const lastH = Math.hypot(lb[0] - la[0], lb[2] - la[2]);
  if (spanH >= PLACE_YAW_SPAN && lastH >= PLACE_YAW_SPAN) {
    const ang = Math.atan2(b[0] - a[0], b[2] - a[2]);
    const prev = Math.atan2(lb[0] - la[0], lb[2] - la[2]);
    const d = Math.atan2(Math.sin(ang - prev), Math.cos(ang - prev));
    if (Math.abs(d) <= PLACE_YAW_JUMP) yaw = d;
  }
  const spun = mulM3V(yawAboutY(yaw), sub(p.anchor, lastMid));
  p.anchor = add(mid, mul(spun, k));
  p.scale *= k;
  if (yaw !== 0) p.R = mulM3(yawAboutY(yaw), p.R);
  return true;
}
function stepGrab(g, a, b, now, placement) {
  const span = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const spanning = span >= (g.armAt !== null && !g.placing ? PLACE_ARM_SPAN * 0.65 : PLACE_ARM_SPAN);
  if (g.placing || spanning) {
    if (!g.placing) {
      if (g.armAt === null) g.armAt = now;
      if (now - g.armAt >= PLACE_ARM_MS) g.placing = true;
    }
    if (g.placing) {
      if (g.last) applyGrab(placement, g.last, [a, b]);
      g.last = [copy3(a), copy3(b)];
    }
  } else {
    g.armAt = null;
    g.placing = false;
    g.last = null;
  }
}
function jointAt(frame, space, ref) {
  if (!space) return null;
  const withJoint = frame;
  const pose = withJoint.getJointPose?.(space, ref) ?? frame.getPose(space, ref);
  if (!pose) return null;
  const q = pose.transform.position;
  return { p: [q.x, q.y, q.z], r: pose.radius ?? 0 };
}
function readTips(frame, hand, ref) {
  const thumb = jointAt(frame, hand.get("thumb-tip"), ref);
  const index = jointAt(frame, hand.get("index-finger-tip"), ref);
  if (!thumb || !index) return null;
  return {
    gap: Math.hypot(thumb.p[0] - index.p[0], thumb.p[1] - index.p[1], thumb.p[2] - index.p[2]) - thumb.r - index.r,
    radii: thumb.r + index.r,
    point: [(thumb.p[0] + index.p[0]) * 0.5, (thumb.p[1] + index.p[1]) * 0.5, (thumb.p[2] + index.p[2]) * 0.5]
  };
}
var Hands = class {
  pinch = /* @__PURE__ */ new Map();
  gate = grabState();
  update(frame, session, ref, placement, now) {
    const pts = /* @__PURE__ */ new Map();
    const seen = /* @__PURE__ */ new Set();
    for (let i = 0; i < session.inputSources.length; i++) {
      const source = session.inputSources[i];
      const hand = source.hand;
      const side = source.handedness;
      if (!hand || side !== "left" && side !== "right") continue;
      seen.add(side);
      let tips = null;
      try {
        tips = readTips(frame, hand, ref);
      } catch {
        tips = null;
      }
      const was = this.pinch.get(side) ?? false;
      const held = !!tips && pinchClosed(was, tips.gap, tips.radii);
      this.pinch.set(side, held);
      if (held && tips) pts.set(side, tips.point);
    }
    for (const side of ["left", "right"]) if (!seen.has(side)) this.pinch.delete(side);
    const a = pts.get("left");
    const b = pts.get("right");
    if (!a || !b) {
      this.gate.armAt = null;
      this.gate.placing = false;
      this.gate.last = null;
      return;
    }
    stepGrab(this.gate, a, b, now, placement);
  }
};
var ImmersiveAR = class _ImmersiveAR {
  session;
  binding;
  layer;
  refSpace;
  colorFormat;
  /** The real world shows through wherever alpha is 0. */
  passthrough;
  /** GPU depth (float32 or unsigned-short) was granted with matchDepthView false */
  depthSensing;
  /** turns the real-world depth test off without ending the session */
  occlude = true;
  /** tint occluded splat fragments red instead of dropping them */
  occDebug = false;
  /** P40 (Quest): splats are rendered at this fraction of the eye viewport and upscaled by the eye blit. Independent of
   *  the layer scaleFactor, which Quest Browser 152 ignores for WebGPU layers (fixed 1680×1760, Meta investigation
   *  2144687486168018). 1 = native. */
  renderScale = 1;
  occLogged = false;
  hands = new Hands();
  occData = [];
  constructor(session, binding, layer, refSpace, colorFormat, passthrough, depthSensing) {
    this.session = session;
    this.binding = binding;
    this.layer = layer;
    this.refSpace = refSpace;
    this.colorFormat = colorFormat;
    this.passthrough = passthrough;
    this.depthSensing = depthSensing;
  }
  static async diagnose(mode = "immersive-ar") {
    if (!navigator.xr) return "no WebXR (navigator.xr)";
    const ok = await navigator.xr.isSessionSupported(mode).catch(() => false);
    if (!ok) return `${mode} not supported`;
    if (!("XRGPUBinding" in globalThis)) return "no WebXR/WebGPU binding (XRGPUBinding)";
    return null;
  }
  static async start(device, scaleFactor = 1, opts = {}) {
    const init = {
      requiredFeatures: ["webgpu"],
      optionalFeatures: ["local-floor", "hand-tracking", "depth-sensing"],
      depthSensing: { usagePreference: ["gpu-optimized"], dataFormatPreference: ["float32", "unsigned-short"], matchDepthView: false }
    };
    const session = await requestWithTimeout("immersive-ar", init, 6e3);
    try {
      const binding = new XRGPUBinding(session, device);
      const colorFormat = binding.getPreferredColorFormat?.() ?? navigator.gpu.getPreferredCanvasFormat();
      const layer = binding.createProjectionLayer({ colorFormat, scaleFactor });
      if (opts.foveation !== void 0) {
        try {
          layer.fixedFoveation = opts.foveation;
        } catch {
        }
      }
      if (opts.frameRate) {
        const s = session;
        if (s.updateTargetFrameRate && (!s.supportedFrameRates || [...s.supportedFrameRates].includes(opts.frameRate))) {
          void s.updateTargetFrameRate(opts.frameRate).catch(() => {
          });
        }
      }
      session.updateRenderState({ layers: [layer], depthNear: 0.01, depthFar: 50 });
      const features = session.enabledFeatures ?? [];
      const floor = features.includes("local-floor");
      const refSpace = await session.requestReferenceSpace(floor ? "local-floor" : "local");
      const blend = session.environmentBlendMode;
      const passthrough = blend === "alpha-blend" || blend === "additive";
      const depth = _ImmersiveAR.depthFormat(session, binding);
      console.info(`MR: ${colorFormat} blend=${blend} floor=${floor} hands=${features.includes("hand-tracking")} depth=${depth ?? "off"} scale=${scaleFactor} foveation=${layer.fixedFoveation ?? "n/a"}`);
      return new _ImmersiveAR(session, binding, layer, refSpace, colorFormat, passthrough, depth !== null);
    } catch (error) {
      void session.end().catch(() => {
      });
      throw error;
    }
  }
  static depthFormat(session, binding) {
    if (!session.enabledFeatures?.includes("depth-sensing") || !binding.getDepthInformation) return null;
    try {
      const fmt = session.depthDataFormat;
      if (fmt === "float32" || fmt === "unsigned-short") return fmt;
      if (fmt) console.warn(`MR: depth-sensing format ${fmt} has no WebGPU texture; no occlusion`);
    } catch {
    }
    return null;
  }
  occlusionFor(view, cam, scale, slot) {
    if (!this.depthSensing || !this.occlude) return null;
    let info = null;
    try {
      info = this.binding.getDepthInformation(view);
    } catch {
      return null;
    }
    if (!info?.texture) return null;
    const fmt = info.texture.format;
    const kind = fmt === "r32float" ? "float" : fmt === "r16uint" ? "uint" : null;
    if (!kind) return null;
    const data = this.occData[slot] ?? (this.occData[slot] = new Float32Array(32));
    const n = info.depthNear, f = info.depthFar;
    const windowDepth = typeof n === "number" && typeof f === "number" && n > 0 ? { near: n, far: f > n ? f : 1e6 } : null;
    occlusionData(
      cam,
      scale,
      view.transform.matrix,
      info.transform.inverse.matrix,
      info.projectionMatrix,
      info.normDepthBufferFromNormView.matrix,
      info.rawValueToMeters,
      kind,
      info.width,
      info.height,
      windowDepth,
      data
    );
    data[28] = this.occDebug ? 1 : 0;
    const layers = info.texture.depthOrArrayLayers;
    const src = info.getViewDescriptor?.();
    const desc = src ? { ...src } : layers > 1 ? { baseArrayLayer: slot } : {};
    delete desc.format;
    if (layers > 1) {
      desc.dimension = "2d";
      desc.arrayLayerCount = 1;
    }
    if (!this.occLogged) {
      this.occLogged = true;
      console.info(`MR depth: ${fmt} ${info.width}x${info.height}x${layers}, rawValueToMeters ${info.rawValueToMeters}, near ${n} far ${f} (${windowDepth ? "hardware depth" : "linear"}), view descriptor ${src ? JSON.stringify(src) : "none"}, proj[10] ${info.projectionMatrix[10].toFixed(4)} proj[14] ${info.projectionMatrix[14].toFixed(4)}`);
    }
    return { data, texture: info.texture, kind, view: desc };
  }
  /** Move, yaw and scale the placement when both hands are pinched. */
  pinch(frame, placement, now) {
    this.hands.update(frame, this.session, this.refSpace, placement, now);
  }
  /** Per-eye cameras and projection-layer views for this pose. */
  eyes(pose, placement) {
    const encodeSrgb = !this.colorFormat.endsWith("-srgb");
    const keepAlpha = this.passthrough;
    const drawn = [];
    const out = [];
    for (const view of pose.views) {
      const sub2 = this.binding.getViewSubImage(this.layer, view);
      const vp = sub2.viewport;
      if (vp.width < 1 || vp.height < 1) continue;
      const tex = sub2.colorTexture;
      const srcDesc = sub2.getViewDescriptor?.();
      const layerIndex = srcDesc?.baseArrayLayer ?? 0;
      const mip = srcDesc?.baseMipLevel ?? 0;
      const desc = { ...srcDesc ?? {} };
      delete desc.format;
      const clear = !drawn.some((d) => d.tex === tex && d.layer === layerIndex);
      drawn.push({ tex, layer: layerIndex });
      const rs = this.renderScale > 0 && this.renderScale < 1 ? this.renderScale : 1;
      const cam = eyeCamera(
        placement,
        view.projectionMatrix,
        view.transform.matrix,
        Math.max(1, Math.round(vp.width * rs)),
        Math.max(1, Math.round(vp.height * rs))
      );
      out.push({
        cam,
        occ: this.occlusionFor(view, cam, placement.scale, out.length),
        color: tex.createView(desc),
        format: this.colorFormat,
        attachmentWidth: Math.max(1, tex.width >> mip),
        attachmentHeight: Math.max(1, tex.height >> mip),
        viewport: { x: vp.x, y: vp.y, width: vp.width, height: vp.height },
        clear,
        keepAlpha,
        encodeSrgb
      });
    }
    return out;
  }
};
function requestWithTimeout(mode, init, ms) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`requestSession timed out after ${ms}ms`));
    }, ms);
    navigator.xr.requestSession(mode, init).then(
      (session) => {
        if (settled) {
          void session.end();
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve(session);
      },
      (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

// src/main.ts
var Q = new URLSearchParams(location.search);
var QUEST = Q.get("quest") === "1";
var qnum = (k, quest, dflt) => {
  const v = Number(Q.get(k) ?? (QUEST ? quest : dflt));
  return Number.isFinite(v) ? v : dflt;
};
var T_NAV = performance.now();
var LOOKAHEAD = Math.max(1, Math.round(qnum("lookahead", 1, 2)));
var UPLOAD_SLICE = 8 * 2 ** 20;
var marks = { script_start_ms: T_NAV };
var overlay = document.getElementById("stats");
var canvas = document.getElementById("c");
localizeDom();
var setting = (k) => {
  try {
    return localStorage.getItem("p5." + k);
  } catch {
    return null;
  }
};
var saveSetting = (k, v) => {
  try {
    localStorage.setItem("p5." + k, v);
  } catch {
  }
};
async function sceneList() {
  try {
    const names = await (await fetch("scenes.json", { cache: "no-store" })).json();
    return Array.isArray(names) ? names : [];
  } catch {
    return [];
  }
}
function fillScenes(names, current) {
  const sel = document.getElementById("scene");
  if (!names.length) return;
  if (!names.includes(current)) names.unshift(current);
  for (const n of names) sel.add(new Option(n.replace(/^scene_?/, "").replace(/\.json$/, "") || "scene", n, false, n === current));
  sel.hidden = false;
  sel.addEventListener("change", () => {
    saveSetting("scene", sel.value);
    const q = new URLSearchParams(location.search);
    q.delete("scene");
    location.search = q.toString();
  });
}
var postToParent = (msg) => {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(msg, "*");
    }
  } catch {
  }
};
function fail(msg) {
  overlay.textContent = tr("Fehler: ", "Error: ") + msg;
  window.__p5 = { error: msg };
  postToParent({ type: "p5:error", message: msg });
  throw new Error(msg);
}
function lookAt(pos, target, up) {
  const sub2 = (a, b) => a.map((v, i) => v - b[i]);
  const cross2 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm2 = (a) => {
    const l = Math.hypot(...a);
    return a.map((v) => v / l);
  };
  const z = norm2(sub2(target, pos));
  const x = norm2(cross2(z, up));
  const y = cross2(z, x);
  return [x, y, z];
}
function camFromRt(R, t, fx, fy, cx, cy, w, h) {
  const view = new Float32Array(16);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) view[c * 4 + r] = R[r][c];
    view[12 + r] = t[r];
  }
  view[15] = 1;
  const campos = [0, 1, 2].map((c) => -(R[0][c] * t[0] + R[1][c] * t[1] + R[2][c] * t[2]));
  return { view, campos, fx, fy, cx, cy, width: w, height: h };
}
function orbitCam(sc, az, elev, distScale, panY, w, h) {
  const o = sc.orbit, up = o.up, f = o.front;
  const center = [
    o.center[0] + up[0] * panY,
    o.center[1] + up[1] * panY,
    o.center[2] + up[2] * panY
  ];
  const s = [up[1] * f[2] - up[2] * f[1], up[2] * f[0] - up[0] * f[2], up[0] * f[1] - up[1] * f[0]];
  const ce = Math.cos(elev), se = Math.sin(elev), ca = Math.cos(az), sa = Math.sin(az);
  const d = o.dist * distScale;
  const pos = [0, 1, 2].map((i) => center[i] + d * (ce * (ca * f[i] + sa * s[i]) + se * up[i]));
  const R = lookAt(pos, center, up);
  const t = R.map((row) => -(row[0] * pos[0] + row[1] * pos[1] + row[2] * pos[2]));
  const fy = 0.5 * h / Math.tan((Q.has("fovy") ? Number(Q.get("fovy")) : o.fovy_deg) * Math.PI / 360);
  return camFromRt(R, t, fy, fy, w / 2, h / 2, w, h);
}
function questHint() {
  return tr(
    " \u2014 Quest: Quest Browser ab Version 146 n\xF6tig; in chrome://flags \u201EWebXR experiments\u201C (WebXR experimental features) aktivieren und den Browser neu starten. Die Seite muss \xFCber HTTPS kommen.",
    ' \u2014 Quest: needs Quest Browser 146 or newer; enable "WebXR experiments" (WebXR experimental features) in chrome://flags and restart the browser. The page must be served over HTTPS.'
  );
}
async function main() {
  if (!navigator.gpu) fail(tr("kein WebGPU (navigator.gpu fehlt)", "no WebGPU (navigator.gpu missing)") + (QUEST ? questHint() : ""));
  const xrProblem = await ImmersiveAR.diagnose();
  if (xrProblem) console.info(`MR: ${xrProblem}`);
  const xrReady = xrProblem === null;
  if (xrProblem && navigator.xr && (QUEST || xrProblem.includes("XRGPUBinding"))) {
    const hint = document.getElementById("xr-hint");
    if (hint) {
      hint.textContent = "MR: " + xrProblem + questHint();
      hint.hidden = false;
    }
  }
  const ask = (xr2) => {
    const p = navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
      ...xr2 ? { xrCompatible: true } : {}
    });
    return xr2 ? p.catch(() => null) : p;
  };
  let adapter = null;
  for (let i = 0; i < 10 && !adapter; i++) {
    if (xrReady) adapter = await ask(true);
    for (const pref of ["high-performance", "default", "low-power"]) {
      if (adapter) break;
      adapter = await navigator.gpu.requestAdapter(
        { ...pref === "default" ? {} : { powerPreference: pref }, ...xrReady ? { xrCompatible: true } : {} }
      ).catch(() => null);
    }
    if (!adapter) await new Promise((r) => setTimeout(r, 200));
  }
  if (!adapter) fail(tr("kein WebGPU-Adapter", "no WebGPU adapter"));
  const hasTs = adapter.features.has("timestamp-query") && Q.get("ts") !== "0";
  const device = await adapter.requestDevice({
    requiredFeatures: hasTs ? ["timestamp-query"] : [],
    requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize }
  });
  let gpuError = null;
  device.lost.then((i) => {
    gpuError = `device lost (${i.reason}): ${i.message}`;
    console.error(gpuError);
  });
  device.addEventListener("uncapturederror", (e) => {
    const msg = e.error.message;
    console.error("WebGPU: " + msg);
    gpuError ??= msg;
  });
  marks.device_ms = performance.now();
  console.info(`p5: device ${marks.device_ms.toFixed(0)} ms`);
  const info = adapter.info ?? {};
  const ctx = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  const offscreen = Q.get("offscreen") === "1";
  if (!offscreen) ctx.configure({ device, format, alphaMode: "premultiplied" });
  let offTex = null;
  const outTexture = () => {
    if (!offscreen) return ctx.getCurrentTexture();
    if (!offTex || offTex.width !== canvas.width || offTex.height !== canvas.height) {
      offTex?.destroy();
      offTex = device.createTexture({ size: [canvas.width, canvas.height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
    return offTex;
  };
  const dpr = Number(Q.get("dpr") ?? Math.min(devicePixelRatio || 1, 2));
  const resize = () => {
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  };
  resize();
  addEventListener("resize", resize);
  const renderer = new Renderer(device, format, hasTs);
  renderer.sortEvery = Math.max(1, Math.round(qnum("sortevery", 2, 1)));
  const bgInput = document.getElementById("bg");
  const setBg = (hex) => {
    if (hex === "transparent" || hex === "none") {
      renderer.setBackground(0, 0, 0, 0);
      return;
    }
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
    renderer.setBackground(r, g, b, 1);
    bgInput.value = "#" + m[1].toLowerCase();
  };
  setBg(Q.get("bg") ?? setting("bg") ?? "transparent");
  bgInput.addEventListener("input", () => {
    setBg(bgInput.value);
    saveSetting("bg", bgInput.value);
  });
  const scenes = await sceneList();
  const saved = setting("scene");
  const sceneName = Q.get("scene") ?? (saved && scenes.includes(saved) ? saved : scenes[0] ?? "scene.json");
  const sceneUrl = new URL(sceneName, location.href);
  fillScenes(scenes, sceneName);
  const sceneResp = await fetch(sceneUrl);
  if (!sceneResp.ok) fail(`scene fetch HTTP ${sceneResp.status}`);
  const scene = await sceneResp.json();
  marks.scene_ms = performance.now();
  const nsec = scene.sections.length;
  const total = scene.sections.reduce((a, s) => a + s.nframes, 0);
  const targetN = Number(Q.get("n") ?? 0);
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  const decoded = /* @__PURE__ */ new Map();
  const gpu = /* @__PURE__ */ new Map();
  const requested = /* @__PURE__ */ new Set();
  const timings = [];
  const waiters = /* @__PURE__ */ new Map();
  let loadPct = 0;
  worker.onerror = (ev) => {
    fail(`Worker error: ${ev.message || "failed to execute decoder"}`);
  };
  worker.onmessage = (e) => {
    const { seq, ps, timing, error, progress, loaded, total: totalBytes } = e.data;
    if (progress) {
      if (seq === 0 && totalBytes > 0) {
        loadPct = Math.min(99, Math.round(loaded / totalBytes * 100));
        overlay.textContent = tr("Laden ", "Loading ") + `${loadPct}% \xB7 ${(loaded / 1048576).toFixed(1)} / ${(totalBytes / 1048576).toFixed(1)} MB`;
      }
      postToParent({ type: "p5:progress", seq, loaded, total: totalBytes, pct: loadPct });
      return;
    }
    if (error) {
      if (!firstFrameDone) {
        fail(`${tr("Abschnitt", "Section")} ${seq}: ${error}`);
      } else {
        console.warn(`p5: section ${seq} stalled after live ready:`, error);
        postToParent({ type: "p5:stall", seq, error });
        return;
      }
    }
    timing.seq = seq;
    timing.index = seq % nsec;
    timing.recv_ms = performance.now();
    timings.push(timing);
    decoded.set(seq, { ps, timing });
    maxDecoded = Math.max(maxDecoded, seq);
    (waiters.get(seq) ?? []).forEach((f) => f());
    waiters.delete(seq);
  };
  const residentMiB = qnum("resident", 512, 1024);
  let resident = residentMiB > 0 ? /* @__PURE__ */ new Map() : null;
  let residentBytes = 0;
  const residentFull = () => !!resident && resident.size === nsec;
  const isResident = (seq, g) => !!resident && resident.get(seq % nsec) === g;
  const keep = (seq, g) => {
    if (!resident || resident.has(seq % nsec)) return;
    resident.set(seq % nsec, g);
    residentBytes += g.bytes;
    if (residentBytes <= residentMiB * 2 ** 20) return;
    const live = new Set(gpu.values());
    for (const r of resident.values()) if (!live.has(r)) renderer.release(r);
    resident = null;
    console.info(`p5: clip exceeds ${residentMiB} MiB, streaming`);
  };
  let maxRequested = -1;
  const request = (seq) => {
    if (requested.has(seq) || residentFull()) return;
    for (let s = maxRequested + 1; s < seq; s++) request(s);
    maxRequested = Math.max(maxRequested, seq);
    requested.add(seq);
    worker.postMessage({ seq, url: new URL(scene.sections[seq % nsec].url, sceneUrl).href, targetN });
  };
  let maxDecoded = -1, curSeq = 0;
  const whenDecoded = (seq) => new Promise((res) => {
    request(seq);
    if (seq <= maxDecoded || residentFull()) res();
    else waiters.set(seq, [...waiters.get(seq) ?? [], res]);
  });
  const ensureGpu = (seq, now = true) => {
    let g = gpu.get(seq) ?? resident?.get(seq % nsec) ?? null;
    if (!g) {
      const d = decoded.get(seq);
      if (!d) return null;
      console.info(`p5: upload seq ${seq} n=${d.ps.n} at ${performance.now().toFixed(0)} ms`);
      g = renderer.upload(d.ps);
    }
    gpu.set(seq, g);
    if (g.pending) {
      const t0 = performance.now();
      renderer.pump(g, now ? Infinity : UPLOAD_SLICE);
      const d = decoded.get(seq);
      if (d) d.timing.upload_ms = (d.timing.upload_ms ?? 0) + performance.now() - t0;
      if (g.pending) return null;
      keep(seq, g);
    }
    return g;
  };
  const locate = (playFrames2) => {
    const loop = Math.floor(playFrames2 / total);
    let f = playFrames2 - loop * total;
    for (let i = 0; i < nsec; i++) {
      const s = scene.sections[i];
      if (f < s.nframes || i === nsec - 1) return { seq: loop * nsec + i, t: s.g0 + Math.min(f, s.nframes - 1e-4) };
      f -= s.nframes;
    }
    throw new Error("unreachable");
  };
  const housekeeping = (seq) => {
    curSeq = seq;
    const ahead = firstFrameDone ? LOOKAHEAD : 0;
    for (let s = seq; s <= seq + ahead; s++) request(s);
    if (firstFrameDone) ensureGpu(seq + 1, false);
    for (const [k, g] of gpu) if (k < seq) {
      if (!isResident(k, g)) renderer.release(g);
      gpu.delete(k);
    }
    for (const k of decoded.keys()) if (k < seq) decoded.delete(k);
  };
  const fixedT = Q.has("t") ? Number(Q.get("t")) : null;
  let playing = !Q.has("pause") && fixedT === null;
  let playRate = Number(Q.get("speed") ?? 1) || 1;
  let autoOrbit = Q.get("orbit") === "1";
  let activePreset = Q.get("preset") ?? "runway";
  let playFrames = fixedT ?? 0;
  let lastNow = 0, stalls = 0, frames = 0, firstFrameDone = false, inflight = 0, gpuBound = 0;
  let lastRendered = null;
  let az = Number(Q.get("az") ?? 0) * Math.PI / 180;
  let elev = scene.orbit.elev_deg * Math.PI / 180;
  let distScale = Number(Q.get("zoom") ?? 1);
  let panY = Number(Q.get("pany") ?? 0);
  let tAz = az, tElev = elev, tDistScale = distScale, tPanY = panY;
  const presets = {
    runway: { az: 0, elev: scene.orbit.elev_deg, zoom: 1, panY: 0 },
    face: { az: -10, elev: 2, zoom: 0.34, panY: 0.64 },
    dress: { az: 14, elev: -2, zoom: 0.56, panY: -0.02 },
    back: { az: 174, elev: 5, zoom: 0.94, panY: 0.04 }
  };
  const applyPreset = (name) => {
    const p = presets[name];
    if (!p) return;
    activePreset = name;
    tAz = p.az * Math.PI / 180;
    tElev = p.elev * Math.PI / 180;
    tDistScale = p.zoom;
    tPanY = p.panY;
  };
  if (Q.has("preset") && presets[activePreset]) {
    applyPreset(activePreset);
    az = tAz;
    elev = tElev;
    distScale = tDistScale;
    panY = tPanY;
  }
  const fpsWin = [];
  const testIdx = Q.has("testcam") ? Number(Q.get("testcam")) : -1;
  const currentCam = () => {
    if (testIdx >= 0) {
      const c = scene.testcams[testIdx];
      return camFromRt(c.R, c.t, c.fx, c.fy, c.cx, c.cy, c.w, c.h);
    }
    return orbitCam(scene, az, elev, distScale, panY, canvas.width, canvas.height);
  };
  let rafOn = true;
  let hud = () => {
  };
  const markFps = (now) => {
    fpsWin.push(now);
    while (fpsWin.length && fpsWin[0] < now - 1e3) fpsWin.shift();
  };
  const statusText = (seq, t, n) => {
    const tm = renderer.lastTimings;
    return `${fpsWin.length} fps \xB7 ${tr("Abschnitt", "section")} ${seq % nsec} t=${t.toFixed(2)} \xB7 ${n} splats (${renderer.lastVisible} ${tr("sichtbar", "visible")})` + (tm ? ` \xB7 GPU ${tm.gpu_total.toFixed(2)} ms` : "") + ` \xB7 ${(renderer.gpuBytes() / 2 ** 20).toFixed(0)} MiB`;
  };
  const tick = (now) => {
    if (gpuError) {
      overlay.textContent = tr("GPU-Fehler: ", "GPU error: ") + gpuError;
      window.__p5.error = gpuError;
      postToParent({ type: "p5:error", message: gpuError });
      return;
    }
    if (!rafOn) return;
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1e3) : 0;
    lastNow = now;
    if (autoOrbit && !activePointers.size) {
      tAz += dt * 0.34;
    }
    const camEase = dt > 0 ? 1 - Math.exp(-dt * 9) : 1;
    az += (tAz - az) * camEase;
    elev += (tElev - elev) * camEase;
    distScale += (tDistScale - distScale) * camEase;
    panY += (tPanY - panY) * camEase;
    let { seq, t } = locate(playFrames);
    housekeeping(seq);
    const g = ensureGpu(seq);
    if (g && inflight >= 2) {
      gpuBound++;
      if (playing) playFrames += dt * scene.fps * playRate;
    } else if (g) {
      renderer.frame(g, t, currentCam(), outTexture(), { timing: true, readVisible: frames % 10 === 0 });
      lastRendered = { g, t, seq };
      inflight++;
      device.queue.onSubmittedWorkDone().then(() => {
        inflight--;
      });
      frames++;
      if (!firstFrameDone) {
        firstFrameDone = true;
        console.info(`p5: first frame submitted ${performance.now().toFixed(0)} ms`);
        device.queue.onSubmittedWorkDone().then(() => {
          marks.first_frame_ms = performance.now();
          console.info(`p5: first frame done ${marks.first_frame_ms.toFixed(0)} ms`);
          hud();
          postToParent({
            type: "p5:ready",
            firstFrameMs: marks.first_frame_ms,
            splats: g.ps.n,
            fps: scene.fps,
            totalFrames: total
          });
        });
      }
      if (playing) playFrames += dt * scene.fps * playRate;
    } else if (lastRendered && inflight < 2) {
      renderer.frame(lastRendered.g, lastRendered.t, currentCam(), outTexture(), { timing: true, readVisible: frames % 10 === 0 });
      inflight++;
      device.queue.onSubmittedWorkDone().then(() => {
        inflight--;
      });
      frames++;
      if (playing) stalls++;
    } else if (playing) {
      stalls++;
    }
    markFps(now);
    hud = () => {
      const shown = g ?? lastRendered?.g ?? null;
      const shownSeq = g ? seq : lastRendered?.seq ?? seq;
      const shownT = g ? t : lastRendered?.t ?? t;
      overlay.textContent = statusText(shownSeq, shownT, shown ? shown.ps.n : 0);
      postToParent({
        type: "p5:state",
        fps: fpsWin.length,
        section: shownSeq % nsec,
        t: Number(shownT.toFixed(2)),
        splats: shown ? shown.ps.n : 0,
        visible: renderer.lastVisible,
        gpuMs: renderer.lastTimings?.gpu_total ?? null,
        mib: Number((renderer.gpuBytes() / 2 ** 20).toFixed(0)),
        playing,
        autoOrbit,
        preset: activePreset,
        playRate
      });
    };
    if (frames > 0 && frames % 15 === 0) hud();
    void t;
    void seq;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const activePointers = /* @__PURE__ */ new Map();
  let pinchDist = null;
  let lastMidY = null;
  const pointerPairDist = () => {
    const pts = [...activePointers.values()];
    if (pts.length < 2) return null;
    return {
      dist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
      midY: 0.5 * (pts[0].y + pts[1].y)
    };
  };
  canvas.addEventListener("pointerdown", (e) => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    autoOrbit = false;
    activePreset = "custom";
    const pair = pointerPairDist();
    pinchDist = pair ? pair.dist : null;
    lastMidY = pair ? pair.midY : null;
  });
  const endPointer = (e) => {
    activePointers.delete(e.pointerId);
    const pair = pointerPairDist();
    pinchDist = pair ? pair.dist : null;
    lastMidY = pair ? pair.midY : null;
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointermove", (e) => {
    const prev = activePointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size >= 2) {
      const pair = pointerPairDist();
      if (pair && pinchDist && pair.dist > 4) {
        const ratio = pinchDist / pair.dist;
        tDistScale = Math.max(0.26, Math.min(2.4, tDistScale * ratio));
        distScale = tDistScale;
        if (lastMidY !== null) {
          tPanY = Math.max(-0.55, Math.min(0.85, tPanY + (pair.midY - lastMidY) * 2e-3));
          panY = tPanY;
        }
        pinchDist = pair.dist;
        lastMidY = pair.midY;
      }
      return;
    }
    if (e.buttons === 2 || e.shiftKey) {
      tPanY = Math.max(-0.55, Math.min(0.85, tPanY + dy * 22e-4));
      panY = tPanY;
    } else {
      tAz -= dx * 0.01;
      tElev = Math.max(-1.35, Math.min(1.35, tElev + dy * 0.01));
      az = tAz;
      elev = tElev;
    }
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    activePreset = "custom";
    tDistScale = Math.max(0.26, Math.min(2.4, tDistScale * Math.exp(e.deltaY * 1e-3)));
    distScale = tDistScale;
    e.preventDefault();
  }, { passive: false });
  document.getElementById("play").addEventListener("click", () => {
    playing = !playing;
    hud();
  });
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || typeof d !== "object" || d.type !== "p5:cmd") return;
    if (typeof d.preset === "string") applyPreset(d.preset);
    if (typeof d.playing === "boolean") playing = d.playing;
    if (typeof d.togglePlay === "boolean" && d.togglePlay) playing = !playing;
    if (typeof d.autoOrbit === "boolean") {
      autoOrbit = d.autoOrbit;
      if (autoOrbit && activePreset !== "custom") activePreset = "orbit";
    }
    if (typeof d.playRate === "number" && d.playRate > 0) playRate = d.playRate;
    if (typeof d.bg === "string") setBg(d.bg);
    hud();
  });
  const xrScaleQ = qnum("xrscale", 1, 1);
  const xrRenderScale = Math.min(1, Math.max(0.3, qnum("xrrs", 0.7, 1)));
  const xrLayerScale = Number.isFinite(xrScaleQ) && xrScaleQ > 0 ? xrScaleQ : 1;
  const xrFovQ = Q.get("foveation") ?? (QUEST ? "1" : null);
  const xrOpts = {
    foveation: xrFovQ !== null && Number.isFinite(Number(xrFovQ)) ? Math.min(1, Math.max(0, Number(xrFovQ))) : void 0,
    frameRate: qnum("hz", 72, 0) || void 0
  };
  const hudOn = qnum("hud", 1, 0) > 0;
  const xrDistQ = Number(Q.get("xrdist") ?? 1.5);
  const xrDist = Number.isFinite(xrDistQ) && xrDistQ > 0 ? xrDistQ : 1.5;
  const xrButton = document.getElementById("xr-ar");
  const recolorBox = document.getElementById("recolor");
  const recolorInfo = document.getElementById("recolor-info");
  const recolorQ = Number(Q.get("recolor") ?? 0.6);
  const recolorStrength = Number.isFinite(recolorQ) && recolorQ >= 0 ? recolorQ : 0.6;
  const applyRecolor = async (stage) => {
    renderer.setGrade(null);
    recolorInfo.textContent = tr("Kamera \u2026", "Camera \u2026");
    let room;
    try {
      room = await captureRoom();
    } catch (e) {
      console.warn("MR: recolor", e);
      recolorInfo.textContent = tr("Kamera: ", "Camera: ") + (e instanceof Error ? e.message : e);
      return;
    }
    if (xr !== stage || !recolorBox.checked) {
      recolorInfo.textContent = "";
      return;
    }
    const px = await renderer.readTargetRGBA(4);
    const grade = estimateGrade(room, px ? imageStats(px, 1, true) : null, recolorStrength);
    renderer.setGrade(grade);
    recolorInfo.textContent = describeGrade(grade);
    console.info(`MR: recolor ${describeGrade(grade)}`);
  };
  recolorBox.addEventListener("change", () => {
    if (recolorBox.checked) {
      if (xr) void applyRecolor(xr);
      return;
    }
    renderer.setGrade(null);
    recolorInfo.textContent = "";
  });
  let xr = null;
  let placed = null;
  let xrFrames = 0;
  let xrDrawError = false;
  const onXR = (time, frame) => {
    const stage = xr;
    if (!stage) return;
    stage.session.requestAnimationFrame(onXR);
    if (gpuError) {
      overlay.textContent = tr("GPU-Fehler: ", "GPU error: ") + gpuError;
      window.__p5.error = gpuError;
      return;
    }
    const dt = lastNow ? (time - lastNow) / 1e3 : 0;
    lastNow = time;
    const { seq, t } = locate(playFrames);
    housekeeping(seq);
    const g = ensureGpu(seq);
    const pose = frame.getViewerPose(stage.refSpace);
    xrFrames++;
    if (pose && !placed?.locked) {
      const entry = currentCam();
      const dist = scene.orbit.dist * distScale;
      const fwd = [entry.view[2], entry.view[6], entry.view[10]];
      const center = [entry.campos[0] + fwd[0] * dist, entry.campos[1] + fwd[1] * dist, entry.campos[2] + fwd[2] * dist];
      const hm = pose.transform.matrix;
      const up = scene.orbit.up;
      const next = place(entry.campos, center, [up[0], up[1], up[2]], [hm[12], hm[13], hm[14]], [-hm[8], -hm[9], -hm[10]], xrDist);
      if (next) {
        next.locked = !pose.emulatedPosition || xrFrames > 30;
        placed = next;
      }
    }
    if (placed?.locked) stage.pinch(frame, placed, time);
    if (g && inflight >= 2) {
      gpuBound++;
      if (playing) playFrames += dt * scene.fps;
    } else if (g && pose && placed) {
      try {
        const eyes = stage.eyes(pose, placed);
        if (eyes.some((e) => e.occ)) xrLog.occ++;
        if (eyes.length) {
          if (hudOn) renderer.setHud(fpsWin.length, g.ps.n / 1e3, Math.round(eyes[0].viewport.height * 0.03));
          renderer.frameEyes(g, t, eyes);
          inflight++;
          device.queue.onSubmittedWorkDone().then(() => {
            inflight--;
          });
          frames++;
          if (!firstFrameDone) {
            firstFrameDone = true;
            console.info(`p5: first frame submitted ${performance.now().toFixed(0)} ms`);
            device.queue.onSubmittedWorkDone().then(() => {
              marks.first_frame_ms = performance.now();
              console.info(`p5: first frame done ${marks.first_frame_ms.toFixed(0)} ms`);
            });
          }
        }
      } catch (e) {
        if (!xrDrawError) {
          xrDrawError = true;
          console.error("MR", e);
        }
      }
      if (playing) playFrames += dt * scene.fps;
    } else if (playing) {
      stalls++;
    }
    markFps(time);
    hud = () => {
      overlay.textContent = statusText(seq, t, g ? g.ps.n : 0);
    };
    if (frames % 15 === 0) hud();
    if (time - xrLog.at >= 5e3) {
      const last = timings[timings.length - 1];
      console.info(`MR: ${fpsWin.length} fps, ${gpuBound - xrLog.busy} frames skipped (GPU busy), ${stalls - xrLog.stalls} stalls (section not ready)` + (last ? `, last decode ${last.decode_ms.toFixed(0)} ms seq ${last.seq}` : "") + `, ${resident ? `resident ${resident.size}/${nsec}` : "streaming"}, depth occlusion ${stage.depthSensing ? stage.occlude ? `${xrLog.occ} frames` : "off" : "unavailable"}`);
      xrLog.at = time;
      xrLog.busy = gpuBound;
      xrLog.stalls = stalls;
      xrLog.occ = 0;
    }
  };
  const xrLog = { at: 0, busy: 0, stalls: 0, occ: 0 };
  const occBox = document.getElementById("occ");
  const occDebugBox = document.getElementById("occ-debug");
  occBox.checked = setting("occlude") !== "0";
  occDebugBox.checked = setting("occdebug") === "1";
  occBox.addEventListener("change", () => {
    saveSetting("occlude", occBox.checked ? "1" : "0");
    if (xr) xr.occlude = occBox.checked;
  });
  occDebugBox.addEventListener("change", () => {
    saveSetting("occdebug", occDebugBox.checked ? "1" : "0");
    if (xr) xr.occDebug = occDebugBox.checked;
  });
  if (xrReady) {
    xrButton.hidden = false;
    document.getElementById("occ-box").hidden = false;
    document.getElementById("occ-debug-box").hidden = false;
    document.getElementById("recolor-box").hidden = !navigator.mediaDevices?.getUserMedia;
    xrButton.addEventListener("click", () => {
      if (xr) {
        void xr.session.end();
        return;
      }
      xrButton.disabled = true;
      xrButton.textContent = "\u2026";
      void (async () => {
        try {
          const stage = await ImmersiveAR.start(device, xrLayerScale, xrOpts);
          stage.occlude = occBox.checked;
          stage.occDebug = occDebugBox.checked;
          stage.renderScale = xrRenderScale;
          stage.session.addEventListener("end", () => {
            xr = null;
            placed = null;
            xrFrames = 0;
            rafOn = true;
            lastNow = 0;
            renderer.setGrade(null);
            xrButton.textContent = "MR";
            requestAnimationFrame(tick);
          });
          placed = null;
          xrFrames = 0;
          xrDrawError = false;
          rafOn = false;
          lastNow = 0;
          xr = stage;
          xrButton.textContent = "Exit";
          stage.session.requestAnimationFrame(onXR);
          if (recolorBox.checked) void applyRecolor(stage);
        } catch (e) {
          console.error("MR", e);
          overlay.textContent = "MR: " + (e instanceof Error ? e.message : e);
          xrButton.textContent = "MR";
        } finally {
          xrButton.disabled = false;
        }
      })();
    });
  }
  const allLoaded = async () => {
    const c = curSeq;
    for (let s = c; s <= c + LOOKAHEAD; s++) await whenDecoded(s);
  };
  const p5 = {
    ready: true,
    info: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, timestamps: hasTs, format },
    marks,
    timings,
    scene: { nsec, total, fps: scene.fps, targetN },
    config: { quest: QUEST, lookahead: LOOKAHEAD, resident_mib: residentMiB, xrscale: xrLayerScale, xrrs: xrRenderScale, sortevery: renderer.sortEvery, xr: xrOpts, hud: hudOn },
    /** P40: the XR eye blit with the in-headset readout, rendered offscreen (no XR session needed) */
    xrBlitCheck: (w, h, fps, k) => renderer.debugXrBlit(w, h, fps, k, Math.round(h * 0.03)),
    state: () => ({
      frames,
      stalls,
      playFrames,
      visible: renderer.lastVisible,
      gpu_bytes: renderer.gpuBytes(),
      gpu_bytes_peak: renderer.peakBytes,
      gpu_bytes_by: Object.fromEntries(renderer.bytes),
      sort_dispatches: renderer.sortDispatches(),
      canvas: [canvas.width, canvas.height]
    }),
    setView: (o) => {
      if (o.preset !== void 0) applyPreset(o.preset);
      if (o.az !== void 0) {
        tAz = o.az * Math.PI / 180;
        az = tAz;
      }
      if (o.elev !== void 0) {
        tElev = o.elev * Math.PI / 180;
        elev = tElev;
      }
      if (o.zoom !== void 0) {
        tDistScale = o.zoom;
        distScale = tDistScale;
      }
      if (o.panY !== void 0) {
        tPanY = o.panY;
        panY = tPanY;
      }
      if (o.t !== void 0) {
        let pf = Math.floor(playFrames / total) * total + o.t % total;
        if (pf < playFrames) pf += total;
        playFrames = pf;
      }
      if (o.playing !== void 0) playing = o.playing;
    },
    /** rAF-paced playback for `seconds`; returns the display-paced frame rate. */
    async rafFps(seconds) {
      await allLoaded();
      playing = true;
      const f0 = frames, t0 = performance.now(), s0 = stalls, b0 = gpuBound;
      renderer.timingsLog.length = 0;
      await new Promise((r) => setTimeout(r, seconds * 1e3));
      const el = (performance.now() - t0) / 1e3;
      return { fps: (frames - f0) / el, frames: frames - f0, seconds: el, stalls: stalls - s0, skipped_gpu_busy: gpuBound - b0, gpu_timings: summarize(renderer.timingsLog) };
    },
    /** frames back-to-back without vsync (max 2 in flight); measures what the GPU sustains. */
    async uncapped(nFrames, timing, maxInflight = 3) {
      await allLoaded();
      rafOn = false;
      await device.queue.onSubmittedWorkDone();
      const off = device.createTexture({ size: [canvas.width, canvas.height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      renderer.timingsLog.length = 0;
      const inflight2 = [];
      const t0 = performance.now();
      let pf = playFrames;
      for (let i = 0; i < nFrames; i++) {
        const { seq, t } = locate(pf);
        housekeeping(seq);
        let g = ensureGpu(seq);
        if (!g) {
          await whenDecoded(seq);
          g = ensureGpu(seq);
        }
        if (!g) throw new Error(`section seq ${seq} not available`);
        renderer.frame(g, t, currentCam(), off, { timing });
        inflight2.push(device.queue.onSubmittedWorkDone());
        if (inflight2.length >= maxInflight) await inflight2.shift();
        pf += scene.fps / 60;
      }
      await Promise.all(inflight2);
      const el = (performance.now() - t0) / 1e3;
      await new Promise((r) => setTimeout(r, 100));
      off.destroy();
      playFrames = pf;
      rafOn = true;
      lastNow = 0;
      requestAnimationFrame(tick);
      return { fps: nFrames / el, frames: nFrames, seconds: el, max_inflight: maxInflight, gpu_timings: summarize(renderer.timingsLog) };
    },
    /** offscreen mode only: copy the current float target into a 2D canvas over the WebGPU canvas (screenshots). */
    async snapshot() {
      rafOn = false;
      await device.queue.onSubmittedWorkDone();
      hud();
      const img = await renderer.readTarget();
      const c2 = document.createElement("canvas");
      c2.width = img.w;
      c2.height = img.h;
      c2.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh";
      const id = new ImageData(img.w, img.h);
      for (let i = 0; i < img.w * img.h; i++) {
        id.data.set(img.rgb.subarray(i * 3, i * 3 + 3), i * 4);
        id.data[i * 4 + 3] = 255;
      }
      c2.getContext("2d").putImageData(id, 0, 0);
      document.body.insertBefore(c2, document.getElementById("hud"));
      return { w: img.w, h: img.h };
    },
    /** render a test camera at frame t into the float target and return 8-bit RGB (base64). */
    async renderTest(idx, t) {
      await allLoaded();
      rafOn = false;
      await device.queue.onSubmittedWorkDone();
      const c = scene.testcams[idx];
      t = (t % total + total) % total;
      const si = scene.sections.findIndex((s) => t >= s.g0 && t < s.g0 + s.nframes);
      let seq = Math.floor(curSeq / nsec) * nsec + si;
      if (seq < curSeq) seq += nsec;
      const tt = t;
      await whenDecoded(seq);
      const g = ensureGpu(seq);
      if (!g) throw new Error(`section seq ${seq} not available (cur ${curSeq}, maxDecoded ${maxDecoded}, decoded [${[...decoded.keys()]}], gpu [${[...gpu.keys()]}])`);
      renderer.frame(g, tt, camFromRt(c.R, c.t, c.fx, c.fy, c.cx, c.cy, c.w, c.h), null);
      const img = await renderer.readTarget();
      const ids = Array.from({ length: Math.min(256, g.ps.n) }, (_, k) => Math.floor(k * g.ps.n / 256));
      const got = await renderer.readWorld(ids);
      let maxErr = 0, checked = 0;
      ids.forEach((i, k) => {
        const ref = evalSplat(g.ps, i, tt);
        if (!ref.alive) return;
        checked++;
        const flat = [...ref.vals[0], ...ref.vals[1], ...ref.vals[2], ...ref.vals[3], ...ref.vals[4]];
        const gpuv = [got[k][0], got[k][1], got[k][2], got[k][4], got[k][5], got[k][6], got[k][7], got[k][8], got[k][9], got[k][10], got[k][11], got[k][12], got[k][13], got[k][14]];
        flat.forEach((v, j) => {
          maxErr = Math.max(maxErr, Math.abs(v - gpuv[j]) / Math.max(1, Math.abs(v)));
        });
      });
      rafOn = true;
      lastNow = 0;
      requestAnimationFrame(tick);
      let bin = "";
      for (let i = 0; i < img.rgb.length; i += 32768) bin += String.fromCharCode(...img.rgb.subarray(i, i + 32768));
      return { w: img.w, h: img.h, rgb_b64: btoa(bin), eval_check: { splats: checked, max_rel_err: maxErr }, n: g.ps.n, seq, t: tt };
    },
    /** P40: render the orbit view (az/elev deg, zoom) or test camera
     *  `testcam` at frame t (fractional allowed) and return the PREMULTIPLIED RGBA target as 8-bit (base64), so the
     *  caller can composite any background; world=true also returns the evaluated world buffer (16 floats per splat). */
    async renderRGBA(o) {
      await allLoaded();
      rafOn = false;
      await device.queue.onSubmittedWorkDone();
      const t = (o.t % total + total) % total;
      const si = scene.sections.findIndex((s) => t >= s.g0 && t < s.g0 + s.nframes);
      let seq = Math.floor(curSeq / nsec) * nsec + si;
      if (seq < curSeq) seq += nsec;
      await whenDecoded(seq);
      const g = ensureGpu(seq);
      if (!g) throw new Error(`section seq ${seq} not available`);
      let cam;
      if (o.testcam !== void 0) {
        const c = scene.testcams[o.testcam];
        cam = camFromRt(c.R, c.t, c.fx, c.fy, c.cx, c.cy, c.w, c.h);
      } else {
        cam = orbitCam(
          scene,
          (o.az ?? 0) * Math.PI / 180,
          (o.elev ?? scene.orbit.elev_deg) * Math.PI / 180,
          o.zoom ?? 1,
          0,
          canvas.width,
          canvas.height
        );
      }
      renderer.frame(g, t, cam, null);
      const px = await renderer.readTargetRGBA(1);
      const u8 = new Uint8Array(px.length);
      for (let i = 0; i < px.length; i++) u8[i] = Math.round(Math.min(1, Math.max(0, px[i])) * 255);
      const b64 = (a) => {
        let s = "";
        for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode(...a.subarray(i, i + 32768));
        return btoa(s);
      };
      let world = null;
      if (o.world) world = b64(new Uint8Array(await renderer.readWorldAll()));
      rafOn = true;
      lastNow = 0;
      requestAnimationFrame(tick);
      return { w: cam.width, h: cam.height, rgba_b64: b64(u8), n: g.ps.n, seq, t, world_b64: world };
    }
  };
  window.__p5 = p5;
}
function summarize(log) {
  if (!log.length) return null;
  const out = {};
  for (const k of Object.keys(log[0])) {
    const v = log.map((r) => r[k]).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) continue;
    out[k] = { median: v[Math.floor(v.length / 2)], p95: v[Math.floor(v.length * 0.95)], mean: v.reduce((a, b) => a + b, 0) / v.length };
  }
  return { samples: log.length, ...out };
}
main().catch((e) => fail(String(e?.stack ?? e)));
