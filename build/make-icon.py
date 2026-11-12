# Draws the Universal PTZ Controller logo: a neon line-art U holding a PTZ
# camera on its stand, with a pan arrow, in the style of the Broadcast
# Controller logo. Run from the project root:
#
#   python3 build/make-icon.py
#
# Needs Pillow (pip install pillow). Writes:
#   build/icon.png              1024px, used by the installers
#   assets/icon.png, icon.ico   window and taskbar icon
#   frontend/src/assets/logo.png  logo in the app's top bar

import math
from PIL import Image, ImageDraw, ImageFilter, ImageChops

SS = 2
S = 1024 * SS
BG = (28, 33, 39)
k = lambda v: int(round(v * SS))

def arc(cx, cy, r, a0, a1, n=160):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]

BOX = (k(225), k(150), k(799), k(905))  # area the mark fills, for the gradient

def rrect(d, x0, y0, x1, y1, r, w):
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, outline=255, width=w)

def dot(d, x, y, r):
    d.ellipse([x - r, y - r, x + r, y + r], fill=255)

def mark(d, w):
    cx, cy = k(512), k(515)
    # The U: the camera's yoke, five parallel lines like the B.
    for i in range(5):
        r = k(160 + i * 27)
        top = k(170)
        pts = [(cx - r, top), (cx - r, cy)] + [(cx + r * math.cos(math.radians(180 - j * 180 / 160)),
                                                cy + r * math.sin(math.radians(180 - j * 180 / 160))) for j in range(161)] + [(cx + r, top)]
        d.line(pts, fill=255, width=w, joint='curve')
        for p in (pts[0], pts[-1]):
            dot(d, p[0], p[1], w / 2)

    # The camera head, seen from the front: two parallel rounded outlines.
    hx, hy = cx, k(448)
    hw, hh = k(124), k(76)
    rrect(d, hx - hw, hy - hh, hx + hw, hy + hh, k(40), w)
    g = k(22)
    rrect(d, hx - hw + g, hy - hh + g, hx + hw - g, hy + hh - g, k(24), w)
    # The camera's own stand, inside the U: a short neck and a two-line foot.
    neck_top = hy + hh
    for dx in (-k(18), k(18)):
        d.line([(hx + dx, neck_top), (hx + dx, neck_top + k(40))], fill=255, width=w)
    for n, half in enumerate((k(92), k(66))):
        y = neck_top + k(52) + n * k(24)
        d.line([(hx - half, y), (hx + half, y)], fill=255, width=w)
        dot(d, hx - half, y, w / 2)
        dot(d, hx + half, y, w / 2)
    # Lens: one ring with a glint, not a target.
    R = k(42)
    d.ellipse([hx - R, hy - R, hx + R, hy + R], outline=255, width=w)
    dot(d, hx - k(13), hy - k(13), k(11))
    # Tally light: a short bar on top of the head, where BZB cameras have it.
    ty = hy - hh - k(20)
    d.line([(hx - k(26), ty), (hx + k(26), ty)], fill=255, width=w)
    dot(d, hx - k(26), ty, w / 2)
    dot(d, hx + k(26), ty, w / 2)

    # Pan arrow over the camera.
    pts = arc(hx, hy + k(10), k(196), 240, 300, 80)
    d.line(pts, fill=255, width=w, joint='curve')
    for (ex, ey), ang, sgn in ((pts[0], 240, -1), (pts[-1], 300, 1)):
        t = math.radians(ang + 90 * sgn)
        size = k(32)
        tip = (ex + size * 0.55 * math.cos(t), ey + size * 0.55 * math.sin(t))
        a1, a2 = t + math.radians(145), t - math.radians(145)
        d.polygon([tip, (ex + size * math.cos(a1), ey + size * math.sin(a1)),
                   (ex + size * math.cos(a2), ey + size * math.sin(a2))], fill=255)

def gradient(c1, c2, c3):
    x0, y0, x1, y1 = BOX
    g = Image.new('RGB', (64, 64))
    px = g.load()
    for y in range(64):
        for x in range(64):
            t = (x / 63 + (1 - y / 63)) / 2      # bottom-left 0 -> top-right 1
            a, b, u = (c1, c2, t / 0.5) if t < 0.5 else (c2, c3, (t - 0.5) / 0.5)
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * u) for i in range(3))
    full = Image.new('RGB', (S, S), c2)
    full.paste(g.resize((x1 - x0, y1 - y0), Image.BICUBIC), (x0, y0))
    return full

def render(colors, out):
    mask = Image.new('L', (S, S), 0)
    mark(ImageDraw.Draw(mask), k(11))
    # Centre the mark vertically (it spans roughly y 150 to 785).
    mask = ImageChops.offset(mask, 0, k(44))
    grad = gradient(*colors)
    black = Image.new('RGB', (S, S), (0, 0, 0))
    lines = Image.composite(grad, black, mask)
    wide = lines.filter(ImageFilter.GaussianBlur(k(28)))
    mid = lines.filter(ImageFilter.GaussianBlur(k(10)))
    bg = Image.new('RGB', (S, S), BG)
    vig = Image.new('L', (S, S), 0)
    ImageDraw.Draw(vig).ellipse([k(150), k(150), k(874), k(874)], fill=70)
    vig = vig.filter(ImageFilter.GaussianBlur(k(150)))
    bg = Image.composite(Image.new('RGB', (S, S), (40, 46, 53)), bg, vig)
    img = ImageChops.add(bg, ImageChops.multiply(wide, Image.new('RGB', (S, S), (235,) * 3)))
    img = ImageChops.add(img, ImageChops.multiply(mid, Image.new('RGB', (S, S), (200,) * 3)))
    # Lines in full colour with a slightly whiter core, like neon tubes.
    tube = ImageChops.add(lines, Image.new('RGB', (S, S), (55, 55, 55)))
    img = Image.composite(tube, img, mask)
    img.resize((1024, 1024), Image.LANCZOS).save(out)

# Cyan to blue-violet to magenta (option B).
COLORS = ((34, 211, 238), (99, 102, 241), (217, 70, 239))

if __name__ == '__main__':
    render(COLORS, 'build/icon.png')
    big = Image.open('build/icon.png')
    big.resize((512, 512), Image.LANCZOS).save('assets/icon.png')
    big.save('assets/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    big.resize((256, 256), Image.LANCZOS).save('frontend/src/assets/logo.png')
    print('Wrote build/icon.png, assets/icon.png, assets/icon.ico, frontend/src/assets/logo.png')
