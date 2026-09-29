"""离线解析 GLB：计算每个构件实例的世界包围盒，输出几何真值报告。
不依赖浏览器，不需要解压 Draco（用 accessor 的 min/max）。"""
import json
import math
import pathlib
import struct
import sys

GLB = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else
                   r'E:\AI-project\Zcode_project\18_xidagongqiaozhaobiao\compressed-平南三桥-仅桥（22版）.glb')
OUT = pathlib.Path(__file__).parent


def read_glb(p):
    with open(p, 'rb') as f:
        magic, ver, length = struct.unpack('<4sII', f.read(12))
        assert magic == b'glTF', magic
        clen, ctype = struct.unpack('<I4s', f.read(8))
        j = json.loads(f.read(clen))
    return j


def mat_mul(a, b):
    r = [0.0] * 16
    for i in range(4):
        for k in range(4):
            r[i * 4 + k] = sum(a[i * 4 + t] * b[t * 4 + k] for t in range(4))
    return r


def trs_matrix(node):
    if 'matrix' in node:
        return list(node['matrix'])
    t = node.get('translation', [0, 0, 0])
    r = node.get('rotation', [0, 0, 0, 1])
    s = node.get('scale', [1, 1, 1])
    x, y, z, w = r
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z
    m = [
        (1 - 2 * (yy + zz)) * s[0], 2 * (xy - wz) * s[0], 2 * (xz + wy) * s[0], 0,
        2 * (xy + wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz - wx) * s[1], 0,
        2 * (xz - wy) * s[2], 2 * (yz + wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
        t[0], t[1], t[2], 1,
    ]
    return m


def xf(m, p):
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])


j = read_glb(GLB)
accessors = j['accessors']
meshes = j['meshes']
nodes = j['nodes']
scenes = j['scenes']
root_idx = j['scene']

instances = []          # (mesh_idx, world_aabb, tris)
missing_minmax = 0


def tris_of(mi):
    t = 0
    for pr in meshes[mi].get('primitives', []):
        if 'indices' in pr:
            t += accessors[pr['indices']]['count'] // 3
        else:
            t += accessors[pr['attributes']['POSITION']]['count'] // 3
    return t


def walk(ni, parent):
    global missing_minmax
    n = nodes[ni]
    world = mat_mul(parent, trs_matrix(n))
    if 'mesh' in n:
        mi = n['mesh']
        corners = []
        for pr in meshes[mi].get('primitives', []):
            acc = accessors[pr['attributes']['POSITION']]
            if 'min' not in acc or 'max' not in acc:
                missing_minmax += 1
                continue
            lo, hi = acc['min'], acc['max']
            for cx in (lo[0], hi[0]):
                for cy in (lo[1], hi[1]):
                    for cz in (lo[2], hi[2]):
                        corners.append(xf(world, (cx, cy, cz)))
        if corners:
            xs = [c[0] for c in corners]; ys = [c[1] for c in corners]; zs = [c[2] for c in corners]
            instances.append((mi, (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)), tris_of(mi), ni))
    for c in n.get('children', []):
        walk(c, world)


I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
for r in scenes[root_idx]['nodes']:
    walk(r, I)

print(f'节点 {len(nodes)}  网格 {len(meshes)}  实例(有几何) {len(instances)}  缺 min/max 的图元 {missing_minmax}')
tris_total = sum(t for _, _, t, _ in instances)
uniq = {}
for mi, bb, t, _ in instances:
    uniq[mi] = t
print(f'唯一几何 {len(uniq)} 个，唯一面片 {sum(uniq.values()):,}')
print(f'实例面片合计 {tris_total:,}（渲染量）')

xs0 = min(b[0] for _, b, _, _ in instances); xs1 = max(b[3] for _, b, _, _ in instances)
ys0 = min(b[1] for _, b, _, _ in instances); ys1 = max(b[4] for _, b, _, _ in instances)
zs0 = min(b[2] for _, b, _, _ in instances); zs1 = max(b[5] for _, b, _, _ in instances)
print(f'\n总包围盒 X {xs0:.1f}..{xs1:.1f} ({(xs1-xs0):.1f})  Y {ys0:.1f}..{ys1:.1f} ({(ys1-ys0):.1f})  Z {zs0:.1f}..{zs1:.1f} ({(zs1-zs0):.1f})')

# 长轴判定
spans = {'X': xs1 - xs0, 'Y': ys1 - ys0, 'Z': zs1 - zs0}
print('尺寸比  Y/span=%.3f  Z/span=%.3f  (span=%s)' % (
    (ys1 - ys0) / max(spans['X'], spans['Z']), (zs1 - zs0) / max(spans['X'], spans['Z']),
    'X' if spans['X'] >= spans['Z'] else 'Z'))

# 竖向分布：按中心高度统计面片与件数
H = ys1 - ys0
bins = 24
cnt = [0] * bins; tri = [0] * bins
for _, b, t, _ in instances:
    cy = (b[1] + b[4]) / 2
    k = min(bins - 1, int((cy - ys0) / H * bins))
    cnt[k] += 1; tri[k] += t
print('\n竖向分布（自下而上 24 段）：段号  件数  面片')
for k in range(bins):
    bar = '#' * int(40 * tri[k] / max(tri) if max(tri) else 0)
    print(f'  {k:2d}  {cnt[k]:5d}  {tri[k]:12,d}  {bar}')

# 拱顶包络：沿跨度分箱取最大 y
NX = 32
env = [-1e9] * NX
for _, b, t, _ in instances:
    i0 = max(0, min(NX - 1, int((b[0] - xs0) / (xs1 - xs0) * NX)))
    i1 = max(0, min(NX - 1, int((b[3] - xs0) / (xs1 - xs0) * NX)))
    for i in range(i0, i1 + 1):
        env[i] = max(env[i], b[4])
print('\n上包络（沿跨度 32 箱的最高点 y）：')
for i in range(0, NX, 2):
    print(f'  x={xs0 + (i + 0.5) / NX * (xs1 - xs0):8.1f}  y={env[i]:8.1f}')

# 最大构件 TOP15
big = sorted(instances, key=lambda r: -r[2])[:15]
print('\n面片最多的 15 个实例：')
for mi, b, t, ni in big:
    print(f'  mesh#{mi:5d} tris={t:10,d}  AABB x[{b[0]:8.1f},{b[3]:8.1f}] y[{b[1]:7.1f},{b[4]:7.1f}] z[{b[2]:7.1f},{b[5]:7.1f}]')

# 三角形分布：有多少比例在小构件里
srt = sorted((t for _, _, t, _ in instances), reverse=True)
for k in (50, 100, 200, 400, 800, 1600, 3200):
    if k <= len(srt):
        print(f'  保留最大 {k:5d} 件 → 面片 {sum(srt[:k]):12,d}（占 {sum(srt[:k])/tris_total*100:5.1f}%）')

# 输出给前端用的真值 JSON
truth = {
    'span': {'min': xs0, 'max': xs1, 'axis': 'X' if spans['X'] >= spans['Z'] else 'Z'},
    'bbox': {'x': [xs0, xs1], 'y': [ys0, ys1], 'z': [zs0, zs1]},
    'instances': len(instances), 'uniqueGeometries': len(uniq), 'instanceTriangles': tris_total,
    'envelope': [[xs0 + (i + 0.5) / NX * (xs1 - xs0), env[i]] for i in range(NX)],
    'yHistogram': [{'bin': k, 'count': cnt[k], 'tris': tri[k]} for k in range(bins)],
    'topInstances': [{'mesh': mi, 'tris': t, 'aabb': b} for mi, b, t, _ in big],
}
(OUT / 'model_truth.json').write_text(json.dumps(truth, ensure_ascii=False, indent=1), encoding='utf-8')
print('\n已写出 model_truth.json')
