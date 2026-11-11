"""Rewrites the Keystone rule on ReferenceCardFront.png using letters cut from the card itself.
Usage: python3 make_refcard.py <original front png> <output png>"""
import sys
from collections import Counter
import numpy as np
from PIL import Image, ImageDraw
from refcard_glyphs import load, ink, segments

src, out = sys.argv[1], sys.argv[2]
img = load(src)
INK = ink(img)

def baseline(y0, y1, segs):
    bottoms = []
    for a, b in segs:
        rows = np.where(INK[y0:y1, a:b].any(axis=1))[0]
        bottoms.append(y0 + rows.max())
    return Counter(bottoms).most_common(1)[0][0]

# (line box, text without spaces matching each ink segment)
SOURCES = [
    ((421, 460), "card’spopulationtokenstoany"),
    ((463, 502), "adjacentregionsinacontinuous"),
    ((754, 793), "becomesthiscard’sImpactvalue."),
    ((713, 752), "Keystone:TheInvasiveRisk"),
]
UP, DOWN = 34, 9          # glyph band above / below the baseline
glyphs, gaps, spaces = {}, [], []
for (y0, y1), text in SOURCES:
    segs = segments(img, 55, 715, y0, y1)
    assert len(segs) == len(text), (text, len(segs))
    base = baseline(y0, y1, segs)
    for i, ((a, b), ch) in enumerate(zip(segs, text)):
        glyphs.setdefault(ch, img.crop((a, base - UP, b, base + DOWN + 1)))
        if i:
            g = a - segs[i - 1][1]
            (spaces if g > 10 else gaps).append(g)
# Wipe anything above the ascender line / below the baseline that leaked in from neighbouring lines.
paper = tuple(np.array(img.convert('RGB'))[740, 300])
DESC = set('pgyqj(),')
for ch, g in list(glyphs.items()):
    g = g.copy(); d = ImageDraw.Draw(g)
    d.rectangle((0, 0, g.width, 2), fill=paper + (255,))
    if ch not in DESC: d.rectangle((0, UP + 2, g.width, g.height), fill=paper + (255,))
    glyphs[ch] = g
GAP = Counter(gaps).most_common(1)[0][0]
SPACE = Counter(spaces).most_common(1)[0][0]

# "1" from the numbered list at the top of the card
segs = segments(img, 55, 715, 80, 121)
b1 = baseline(80, 121, segs[:1])
glyphs['1'] = img.crop((segs[0][0], b1 - UP, segs[0][1], b1 + DOWN + 1))

# A hyphen/minus in the same pixel style: one font-pixel tall bar at mid x-height
e = np.array(glyphs['e'].convert('RGB')).astype(int).sum(axis=2) < 450
erows = np.where(e.any(axis=1))[0]
mid = (erows.min() + erows.max()) // 2
dash = Image.new('RGBA', (16, UP + DOWN + 1), paper + (255,))
ImageDraw.Draw(dash).rectangle((0, mid - 2, 15, mid + 1), fill=(4, 7, 7, 255))
glyphs['-'] = dash

# Keep the bold "Keystone:" label exactly as printed
ky0, ky1 = 713, 752
ksegs = segments(img, 55, 715, ky0, ky1)
kbase = baseline(ky0, ky1, ksegs)
label_end = ksegs[8][1]                                   # end of "Keystone:"
label = img.crop((55, kbase - UP, label_end, kbase + DOWN + 1))
next_base = baseline(754, 793, segments(img, 55, 715, 754, 793))

def render(text):
    parts, x = [], 0
    for ch in text:
        if ch == ' ': x += SPACE - GAP; continue
        g = glyphs[ch]
        parts.append((x, g)); x += g.width + GAP
    return parts, x - GAP

line1 = "Invasive Risk -1 per"
line2 = "native token in this region."
p1, w1 = render(line1)
p2, w2 = render(line2)
x1 = label_end + SPACE
print('line1 ends at', x1 + w1, ' line2 ends at', 63 + w2, '(card text area ends ~710)')

out_img = img.copy()
d = ImageDraw.Draw(out_img)
d.rectangle((55, ky0 - 2, 712, 795), fill=paper + (255,))     # wipe the old two lines
out_img.paste(label, (55, kbase - UP))
for x, g in p1: out_img.paste(g, (x1 + x, kbase - UP))
for x, g in p2: out_img.paste(g, (63 + x, next_base - UP))
out_img.save(out)
