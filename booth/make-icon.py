# Draws Booth Video's icon: two monitors, Next (green) above Live (red),
# on a dark rounded square. Run: python3 booth/make-icon.py
from PIL import Image, ImageDraw
import os

here = os.path.dirname(os.path.abspath(__file__))
S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((40, 40, S - 40, S - 40), radius=210, fill=(24, 26, 31, 255))
d.rounded_rectangle((40, 40, S - 40, S - 40), radius=210, outline=(124, 195, 255, 255), width=18)

def monitor(box, colour):
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, radius=28, fill=(10, 11, 13, 255), outline=colour, width=34)
    # a camera on its stand inside
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    d.rounded_rectangle((cx - 70, cy - 52, cx + 40, cy + 30), radius=16, fill=(236, 238, 241, 255))
    d.polygon([(cx + 40, cy - 22), (cx + 92, cy - 50), (cx + 92, cy + 8), (cx + 40, cy)], fill=(236, 238, 241, 255))
    d.rectangle((cx - 22, cy + 30, cx - 6, cy + 66), fill=(236, 238, 241, 255))
    d.rounded_rectangle((cx - 66, cy + 62, cx + 38, cy + 80), radius=8, fill=(236, 238, 241, 255))

monitor((180, 190, 844, 500), (76, 187, 90, 255))
monitor((180, 560, 844, 870), (229, 72, 59, 255))

os.makedirs(os.path.join(here, 'assets'), exist_ok=True)
img.save(os.path.join(here, 'assets', 'icon.png'))
img.save(os.path.join(here, 'build', 'icon.png'))
img.save(os.path.join(here, 'assets', 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
