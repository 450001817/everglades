"""Builds EGDigits: a blocky pixel font for the numbers 0-9, drawn so 2 and 5 can't be confused.
Run: python3 tools/make_digits_font.py   (needs fontTools)"""
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

D = {
 '0': [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
 '1': ["..#..", ".##..", "#.#..", "..#..", "..#..", "..#..", "#####"],
 '2': [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
 '3': ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
 '4': ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
 '5': ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
 '6': ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
 '7': ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
 '8': [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
 '9': [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
}
UPM, PX = 1000, 104          # one "pixel" = 104 units, digits are 7 pixels tall
NAMES = {str(i): n for i, n in enumerate(['zero','one','two','three','four','five','six','seven','eight','nine'])}

def build(bold, path, style):
    fb = FontBuilder(UPM, isTTF=True)
    order = ['.notdef', 'space'] + list(NAMES.values())
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({0x20: 'space', **{ord(d): NAMES[d] for d in D}})
    glyphs, metrics = {}, {}
    w = 5 + (1 if bold else 0)           # bold: every pixel also fills its right neighbour
    adv = (w + 1) * PX + PX // 2
    p = TTGlyphPen(None); glyphs['.notdef'] = p.glyph(); metrics['.notdef'] = (adv, 0)
    p = TTGlyphPen(None); glyphs['space'] = p.glyph(); metrics['space'] = (adv, 0)
    for d, rows in D.items():
        pen = TTGlyphPen(None)
        for r, row in enumerate(rows):
            bits = [c == '#' for c in row]
            if bold: bits = [bits[i] or (i > 0 and bits[i - 1]) for i in range(5)] + [bits[4]]
            x = 0
            while x < len(bits):              # one rectangle per horizontal run of pixels
                if not bits[x]: x += 1; continue
                x2 = x
                while x2 < len(bits) and bits[x2]: x2 += 1
                x0, x1 = PX // 2 + x * PX, PX // 2 + x2 * PX
                y1 = (7 - r) * PX + 3; y0 = (6 - r) * PX - 3   # tiny overlap so rows don't show seams
                pen.moveTo((x0, y0)); pen.lineTo((x0, y1)); pen.lineTo((x1, y1)); pen.lineTo((x1, y0)); pen.closePath()
                x = x2
        glyphs[NAMES[d]] = pen.glyph(); metrics[NAMES[d]] = (adv, PX // 2)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=900, descent=-220)
    fb.setupNameTable({'familyName': 'EGDigits', 'styleName': style})
    fb.setupOS2(sTypoAscender=900, sTypoDescender=-220, usWinAscent=900, usWinDescent=220, usWeightClass=700 if bold else 400)
    fb.setupPost(); fb.setupMaxp()
    fb.save(path)

build(False, 'public/fonts/EGDigits-Regular.ttf', 'Regular')
build(True, 'public/fonts/EGDigits-Bold.ttf', 'Bold')
print('ok')
