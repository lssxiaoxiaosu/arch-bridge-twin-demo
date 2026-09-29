"""三次分析：剔除退化图元后的稳健几何真值（供前端归一化/分类/测点挂接使用）。"""
import json
import pathlib
import struct
import sys

GLB = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else
                   r'E:\AI-project\Zcode_project\18_xidagongqiaozhaobiao\compressed-平南三桥-仅桥（22版）.glb')
OUT = pathlib.Path(__file__).parent


def read_glb(p):
    with open(p, 'rb') as f:
        f.read(12); clen, _ = struct.unpack('<I4s', f.read(8)); return json.loads(f.read(clen))


def mm(a, b):
    r = [0.0] * 16
    for i in range(4):
        for k in range(4):
            r[i * 4 + k] = sum(a[i * 4 + t] * b[t * 4 + k] for t in range(4))
    return r


def trs(n):
    if 'matrix' in n:
        return list(n['matrix'])
    t = n.get('translation', [0, 0, 0]); q = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
    x, y, z, w = q
    return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y - w * z) * s[0], 2 * (x * z + w * y) * s[0], 0,
            2 * (x * y + w * z) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z - w * x) * s[1], 0,
            2 * (x * z - w * y) * s[2], 2 * (y * z + w * x) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
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


def walk(ni, parent):
    n = nodes[ni]; world = mm(parent, trs(n))
    if 'mesh' in n and tris_of(n['mesh']) >= 4:          # 关键：剔除退化图元（CAD 线段）
        cs = []
        for pr in meshes[n['mesh']].get('primitives', []):
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
            inst.append({'mesh': n['mesh'], 'tris': tris_of(n['mesh']),
                         'bb': (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))})
    for c in n.get('children', []):
        walk(c, world)


I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
for r in j['scenes'][j['scene']]['nodes']:
    walk(r, I)

lo = [min(it['bb'][i] for it in inst) for i in (0, 1, 2)]
hi = [max(it['bb'][i + 3] for it in inst) for i in (0, 1, 2)]
size = [hi[i] - lo[i] for i in range(3)]
tris = sum(it['tris'] for it in inst)
print(f'剔除退化图元后：实例 {len(inst)}  面片 {tris:,}')
print(f'包围盒 X[{lo[0]:.1f},{hi[0]:.1f}] len={size[0]:.1f}')
print(f'        Y[{lo[1]:.1f},{hi[1]:.1f}] len={size[1]:.1f}')
print(f'        Z[{lo[2]:.1f},{hi[2]:.1f}] len={size[2]:.1f}')
print(f'比例：高/跨={size[1]/size[0]:.3f}  宽/跨={size[2]/size[0]:.3f}   （矢跨比 1/4 应约 0.25）')

# 拱顶包络（全部 32 箱）
NX = 32
env = [-1e18] * NX; low = [1e18] * NX; cnt = [0] * NX
for it in inst:
    i0 = max(0, min(NX - 1, int((it['bb'][0] - lo[0]) / size[0] * NX)))
    i1 = max(0, min(NX - 1, int((it['bb'][3] - lo[0]) / size[0] * NX)))
    for i in range(i0, i1 + 1):
        env[i] = max(env[i], it['bb'][4]); low[i] = min(low[i], it['bb'][1]); cnt[i] += 1
print('\n沿跨度的上/下包络与构件数：')
for i in range(NX):
    if cnt[i] == 0:
        print(f'  {i:2d} x={lo[0]+ (i+0.5)/NX*size[0]:9.1f}   —')
        continue
    print(f'  {i:2d} x={lo[0]+ (i+0.5)/NX*size[0]:9.1f}  yTop={env[i]:8.1f} yBot={low[i]:8.1f} 件数={cnt[i]:5d}')

# Z 分布：找两片拱肋
zc = sorted((it['bb'][2] + it['bb'][5]) / 2 for it in inst)
print('\nZ 中心分位数：', ' '.join(f'p{int(q*100)}={zc[int(len(zc)*q)]:.0f}' for q in (0.02, 0.1, 0.25, 0.5, 0.75, 0.9, 0.98))
      )
# Y 分布（修正后）
yc = sorted((it['bb'][1] + it['bb'][4]) / 2 for it in inst)
print('Y 中心分位数：', ' '.join(f'p{int(q*100)}={yc[int(len(yc)*q)]:.0f}' for q in (0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99)))

srt = sorted((it['tris'] for it in inst), reverse=True)
print('\n面片预算（按构件面片数降序保留）：')
for k in (50, 100, 200, 400, 800, 1200, 1600, 2400):
    if k <= len(srt):
        print(f'  保留 {k:5d} 件 → {sum(srt[:k]):12,d} 面片（{sum(srt[:k])/tris*100:5.1f}%）')

(OUT / 'model_truth.json').write_text(json.dumps({
    'bbox': {'x': [lo[0], hi[0]], 'y': [lo[1], hi[1]], 'z': [lo[2], hi[2]]},
    'instances': len(inst), 'triangles': tris,
    'envelope': [[lo[0] + (i + 0.5) / NX * size[0], env[i], low[i], cnt[i]] for i in range(NX)],
}, ensure_ascii=False, indent=1), encoding='utf-8')
print('\n已写出 model_truth.json')
