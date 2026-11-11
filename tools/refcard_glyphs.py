"""Cut letters out of text already printed on the reference card, so new wording matches the card's pixel font."""
from PIL import Image
import numpy as np

def load(path):
    return Image.open(path).convert('RGBA')

def ink(img):
    a = np.array(img.convert('RGB')).astype(int)
    return a.sum(axis=2) < 450   # dark-ish (includes anti-aliased edges)

def text_lines(img, x0, x1, y0, y1):
    """Find horizontal text lines (y ranges) inside a box."""
    m = ink(img)[y0:y1, x0:x1].any(axis=1)
    lines, start = [], None
    for i, v in enumerate(m):
        if v and start is None: start = i
        if not v and start is not None: lines.append((y0 + start, y0 + i)); start = None
    if start is not None: lines.append((y0 + start, y1))
    return lines

def segments(img, x0, x1, y0, y1, min_gap=1):
    """Split a line into ink segments separated by blank columns."""
    m = ink(img)[y0:y1, x0:x1].any(axis=0)
    segs, start, gap = [], None, 0
    for i, v in enumerate(m):
        if v:
            if start is None: start = i
            gap = 0
        elif start is not None:
            segs.append((x0 + start, x0 + i)); start = None
    if start is not None: segs.append((x0 + start, x1))
    return segs
