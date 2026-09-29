"""二次分析：定位撑大包围盒的离群构件，给出稳健包围盒（分位数）与真实桥体范围。"""
import json
import pathlib
import struct
import sys

GLB = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else
                   r'E:\AI-project\Zcode_project\18_xidagongqiaozhaobiao\compressed-平南三桥-仅桥（22版）.glb')


def read_glb(p):
    with open(p, 'rb') as f:
        f.read(12)
        clen, _ = struct.unpack('<I4s', f.read(8))
        return json.loads(f.read(clen))


def mat_mul(a, b):
    r = [0.0] * 16
    for i in range(4):
        for k in range(4):
            r[i * 4 + k] = sum(a[i * 4 + t] * b[t * 4 + k] for t in range(4))
    return r


def trs_matrix(node):
    if 'matrix' in node:
        return list(node['matrix'])
    t = node.get('translation', [0, 0, 0]); r = node.get('rotation', [0, 0, 0, 1]); s = node.get('scale', [1, 1, 1])
    x, y, z, w = r
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z
    return [(1 - 2 * (yy + zz)) * s[0], 2 * (xy - wz) * s[0], 2 * (xz + wy) * s[0], 0,
            2 * (xy + wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz - wx) * s[1], 0,
            2 * (xz - wy) * s[2], 2 * (yz + wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
            t[0], t[1], t[2], 1]


def xf(m, p):
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14])


j = read_glb(GLB)
acc, meshes, nodes = j['accessors'], j['meshes'], j['nodes']
inst = []


def tris_of(mi):
    t = 0
    for pr in meshes[mi].get('primitives', []):
        t += (acc[pr['indices']]['count'] // 3) if 'indices' in pr else (acc[pr['attributes']['POSITION']]['count'] // 3)
    return t


def walk(ni, parent, path):
    n = nodes[ni]
    world = mat_mul(parent, trs_matrix(n))
    if 'mesh' in n:
        mi = n['mesh']
        cs = []
        for pr in meshes[mi].get('primitives', []):
            a = acc[pr['attributes']['POSITION']]
            if 'min' not in a:
                continue
            lo, hi = a['min'], a['max']
            for cx in (lo[0], hi[0]):
                for cy in (lo[1], hi[1]):
                    for cz in (lo[2], hi[2]):
                        cs.append(xf(world, (cx, cy, cz)))
        if cs:
            xs = [c[0] for c in cs]; ys = [c[1] for c in cs]; zs = [c[2] for c in cs]
            inst.append({'node': ni, 'mesh': mi, 'tris': tris_of(mi), 'path': path[:6],
                         'bb': (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)),
                         'name': n.get('name')})
    for c in n.get('children', []):
        walk(c, world, path + [n.get('name')])


I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
for r in j['scenes'][j['scene']]['nodes']:
    walk(r, I, [])

N = len(inst)
print(f'实例 {N}')


def pct(vals, q):
    v = sorted(vals)
    return v[max(0, min(len(v) - 1, int(len(v) * q)))]


print('\n各轴中心坐标分位数（用于识别离群）：')
for ax, i in (('X', 0), ('Y', 1), ('Z', 2)):
    c = [(it['bb'][i] + it['bb'][i + 3]) / 2 for it in inst]
    print(f'  {ax}: min={min(c):12.1f}  p1={pct(c,0.01):12.1f}  p50={pct(c,0.5):12.1f}  p99={pct(c,0.99):12.1f}  max={max(c):12.1f}')

# 用"构件尺寸"识别离群：长宽比异常大的（轴线、标注、场地线）
print('\n尺寸最大的 12 个构件（可能撑大包围盒）：')
for it in sorted(inst, key=lambda r: -max(r['bb'][3] - r['bb'][0], r['bb'][4] - r['bb'][1], r['bb'][5] - r['bb'][2]))[:12]:
    b = it['bb']
    print(f"  node#{it['node']:5d} name={str(it['name'])[:18]:18s} tris={it['tris']:8,d} "
          f"size=({b[3]-b[0]:10.1f},{b[4]-b[1]:9.1f},{b[5]-b[2]:9.1f}) z[{b[2]:9.1f},{b[5]:9.1f}]")

# 稳健范围：用面片加权，取 p0.5~p99.5 的中心范围，并给出"主体"包围盒
def robust(axis_i, qlo=0.005, qhi=0.995):
    los = [it['bb'][axis_i] for it in inst]; his = [it['bb'][axis_i + 3] for it in inst]
    return pct(los, qlo), pct(his, qhi)


print('\n原始包围盒 vs 稳健包围盒（p0.5 ~ p99.5）：')
raw = [(min(it['bb'][i] for it in inst), max(it['bb'][i + 3] for it in inst)) for i in (0, 1, 2)]
rob = [robust(i) for i in (0, 1, 2)]
for k, ax in enumerate('XYZ'):
    print(f'  {ax}: raw [{raw[k][0]:11.1f},{raw[k][1]:11.1f}] len={raw[k][1]-raw[k][0]:10.1f}   '
          f'robust [{rob[k][0]:11.1f},{rob[k][1]:11.1f}] len={rob[k][1]-rob[k][0]:10.1f}')

# 只看"有面片"的构件（tris>0）的分布
solid = [it for it in inst if it['tris'] > 0]
print(f'\n有面片的实例 {len(solid)}（占 {len(solid)/N*100:.1f}%）')
for k, ax in enumerate('XYZ'):
    lo = min(it['bb'][k] for it in solid); hi = max(it['bb'][k + 3] for it in solid)
    print(f'  {ax}: [{lo:11.1f},{hi:11.1f}] len={hi-lo:10.1f}')

# 沿 X 分箱统计"有面片"构件数，看跨度方向是否连续
if solid:
    x0 = min(it['bb'][0] for it in solid); x1 = max(it['bb'][3] for it in solid)
    print('\n沿 X 的构件数分布（20 箱，仅有面片构件）：')
    for k in range(20):
        a, b_ = x0 + (x1 - x0) * k / 20, x0 + (x1 - x0) * (k + 1) / 20
        sel = [it for it in solid if it['bb'][0] < b_ and it['bb'][3] > a]
        t = sum(it['tris'] for it in sel)
        print(f'  x {a:11.1f}..{b_:11.1f}  件数 {len(sel):5d}  面片 {t:11,d}  ' + '#' * int(36 * len(sel) / len(solid) * 3))
