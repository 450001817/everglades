"""Builds the Co-op boss card for The Anaconda in the same notebook style as the role cards.
Uses the archived Anaconda role card only as a page template (frame, portrait, map); all rules text is new.
Usage: python3 make_boss_card.py <TheAnaconda.png template> <out.png>"""
import sys
from PIL import Image, ImageDraw
from pixelfont import draw_text, text_width, wrap

PAPER, RED, INK = (252, 251, 239, 255), (237, 28, 36, 255), (0, 0, 0, 255)
src, out = sys.argv[1], sys.argv[2]
card = Image.open(src).convert('RGBA')
d = ImageDraw.Draw(card)

# wipe the old ability text (left page) and the old objectives (right page, below "OBJECTIVES!")
d.rectangle((36, 434, 494, 714), fill=PAPER)
d.rectangle((538, 68, 1012, 320), fill=PAPER)

# ---- left page: how the boss behaves ----
cx = 262
def centered(text, y, scale, color, bold=False):
    draw_text(card, cx - text_width(text, scale, bold) // 2, y, text, scale, color, bold)
centered('BOSS RULES:', 442, 5, RED, bold=True)
rules = [
    "Plays 1 Invasive card after each player's turn.",
    'Wins a trick: travels to the highest Risk biome.',
    'Predatory: eats only Natives.',
    'Migratory: moves next door to the most Natives.',
]
y = 488
for para in rules:
    for line in wrap(para, 3, 450):
        centered(line, y, 3, INK); y += 28
    y += 4
assert y < 716, f'left text too long ({y})'

# ---- right page: objectives ----
x0, y = 545, 76
objectives = [('5pts:', 'For each map objective the players miss.'),
              ('5pts:', 'For each trick won.'),
              ('3pts:', 'For each region with an Invasive majority.')]
for pts, text in objectives:
    x = draw_text(card, x0, y, pts, 4, RED, bold=True) + 12
    lines = wrap(text, 3, 1000 - x)
    first = lines[0]
    draw_text(card, x, y + 4, first, 3, INK)
    rest = text[len(first):].strip()
    y += 36
    for line in wrap(rest, 3, 1000 - x) if rest else []:
        draw_text(card, x, y, line, 3, INK); y += 30
    y += 5
draw_text(card, x0, y + 2, 'The Anaconda wins all ties.', 3, RED)
y += 30
assert y < 330, f'objectives too long ({y})'

# ---- a "CO-OP BOSS" stamp on the photo corner ----
label = 'CO-OP BOSS'
w = text_width(label, 3, True) + 22
stamp = Image.new('RGBA', (w, 40), (0, 0, 0, 0))
sd = ImageDraw.Draw(stamp)
sd.rectangle((0, 0, w - 1, 39), fill=RED)
sd.rectangle((3, 3, w - 4, 36), outline=PAPER, width=3)
draw_text(stamp, 11, 9, label, 3, PAPER, bold=True)
stamp = stamp.rotate(8, expand=True, resample=Image.NEAREST)
card.alpha_composite(stamp, (262, 40))
card.save(out)
print('ok', y)
