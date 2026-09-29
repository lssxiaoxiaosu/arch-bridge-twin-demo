"""对比两种降载策略：按构件尺寸剔除 vs 按面片预算保留。"""
import json
import pathlib
import struct

GLB = pathlib.Path(r'E:\AI-project\Zcode_project\18_xidagongqiaozhaobiao\compressed-平南三桥-仅桥（22版）.glb')


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
    if 'mesh' in n:
        t = tris_of(n['mesh'])
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
            inst.append({'tris': t, 'bb': (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))})
    for c in n.get('children', []):
        walk(c, world)


I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
for r in j['scenes'][j['scene']]['nodes']:
    walk(r, I)

solid = [it for it in inst if it['tris'] >= 4]
lo = [min(it['bb'][i] for it in solid) for i in (0, 1, 2)]
hi = [max(it['bb'][i + 3] for it in solid) for i in (0, 1, 2)]
span = hi[0] - lo[0]
T = sum(it['tris'] for it in solid)
print(f'有效实例 {len(solid)}  总面片 {T:,}  跨度 {span:.1f}')

print('\n【策略一】按"最大尺寸 / 跨度"剔除微小零件：')
for thr in (0.0, 0.002, 0.005, 0.01, 0.02, 0.04, 0.08):
    keep = [it for it in solid if max(it['bb'][3] - it['bb'][0], it['bb'][4] - it['bb'][1], it['bb'][5] - it['bb'][2]) >= thr * span]
    kt = sum(it['tris'] for it in keep)
    print(f'  尺寸≥{thr*100:5.1f}% 跨度 → 保留 {len(keep):5d} 件（{len(keep)/len(solid)*100:5.1f}%）  面片 {kt:12,d}（{kt/T*100:5.1f}%）')

print('\n【策略二】按面片预算保留最大构件：')
srt = sorted(solid, key=lambda r: -r['tris'])
for k in (100, 200, 400, 600, 900, 1400):
    kt = sum(it['tris'] for it in srt[:k])
    print(f'  保留最大 {k:5d} 件 → 面片 {kt:12,d}（{kt/T*100:5.1f}%）')
