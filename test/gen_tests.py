#!/usr/bin/env python3
"""生成 5 张测试/示例封面（1280x720）+ 分析分辨率(480x270)原始 RGBA 供 Node 自测。
1 bad-small-lowcontrast  字小 + 低对比（灰底灰字）
2 good-big-highcontrast  大字 + 高对比（深底白/黄字）
3 cluttered              画面杂乱（形状/线条/碎字铺满，几乎无留白）
4 whitespace             留白过多（大白底、中央一小行字）
5 good-cover             合格封面（渐变底、大标题、适中副标题）
"""
import json, math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

random.seed(42)
BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
W, H = 1280, 720
OUT = "/home/hatch/workspace/products/micro-factory/cover-check/samples"

def font(path, size):
    return ImageFont.truetype(path, size, index=2)

# ---------- 1. 字小低对比 ----------
img = Image.new("RGB", (W, H), (143, 143, 143))
d = ImageDraw.Draw(img, "RGBA")
for i in range(60):  # 柔和色块，制造一点"忙"但不至于满屏噪点
    x, y = random.randint(0, W), random.randint(0, H)
    r = random.randint(60, 200)
    v = random.randint(125, 165)
    d.ellipse([x - r, y - r, x + r, y + r], fill=(v, v, v, 60))
img = img.filter(ImageFilter.GaussianBlur(18))
d = ImageDraw.Draw(img)
d.text((90, 300), "今天分享一个很多人都不知道的小技巧", font=font(REG, 21), fill=(198, 198, 198))
d.text((90, 345), "看完记得收藏", font=font(REG, 19), fill=(188, 188, 188))
img.save(f"{OUT}/bad-small-lowcontrast.png")

# ---------- 2. 大字高对比 ----------
img = Image.new("RGB", (W, H), (18, 24, 48))
d = ImageDraw.Draw(img)
d.rectangle([0, 640, W, 720], fill=(245, 197, 66))
d.text((80, 120), "新手必看", font=font(BOLD, 150), fill=(255, 255, 255))
d.text((80, 320), "手机摄影技巧", font=font(BOLD, 150), fill=(245, 197, 66))
img.save(f"{OUT}/good-big-highcontrast.png")

# ---------- 3. 画面杂乱 ----------
img = Image.new("RGB", (W, H), (210, 205, 190))
d = ImageDraw.Draw(img)
colors = [(200, 60, 50), (50, 90, 200), (40, 160, 90), (230, 150, 30), (120, 60, 180), (60, 60, 60)]
for i in range(46):
    c = random.choice(colors)
    x, y = random.randint(0, W - 160), random.randint(0, H - 100)
    kind = i % 3
    if kind == 0:
        d.rectangle([x, y, x + random.randint(60, 220), y + random.randint(30, 90)], outline=c, width=5)
    elif kind == 1:
        r = random.randint(25, 70)
        d.ellipse([x, y, x + r * 2, y + r * 2], outline=c, width=5)
    else:
        d.line([x, y, x + random.randint(80, 260), y + random.randint(-70, 70)], fill=c, width=5)
words = ["必看", "干货", "教程", "合集", "第3期", "福利", "技巧", "避坑", "全集", "更新"]
for i in range(16):
    x, y = random.randint(10, W - 200), random.randint(10, H - 60)
    d.text((x, y), random.choice(words), font=font(BOLD, random.choice([26, 30, 34])), fill=random.choice(colors))
img.save(f"{OUT}/cluttered.png")

# ---------- 4. 留白过多 ----------
img = Image.new("RGB", (W, H), (250, 250, 248))
d = ImageDraw.Draw(img)
d.text((490, 330), "我的旅行记录", font=font(REG, 30), fill=(60, 60, 60))
d.ellipse([600, 420, 680, 500], outline=(150, 150, 150), width=3)
img.save(f"{OUT}/whitespace.png")

# ---------- 5. 合格封面 ----------
img = Image.new("RGB", (W, H))
px = img.load()
for yy in range(H):
    for xx in range(W):
        t = (xx / W * 0.6 + yy / H * 0.4)
        px[xx, yy] = (int(16 + 20 * t), int(62 + 40 * t), int(78 + 60 * t))
d = ImageDraw.Draw(img, "RGBA")
for i in range(10):
    x, y = random.randint(700, W), random.randint(0, 300)
    r = random.randint(50, 130)
    d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 14))
img = img.filter(ImageFilter.GaussianBlur(6))
d = ImageDraw.Draw(img)
d.rectangle([90, 150, 106, 470], fill=(245, 197, 66))
d.text((140, 160), "3 分钟学会", font=font(BOLD, 104), fill=(255, 255, 255))
d.text((140, 300), "剪出电影感 vlog", font=font(BOLD, 104), fill=(255, 255, 255))
d.text((140, 480), "零基础友好 · 附素材包", font=font(REG, 42), fill=(205, 228, 235))
img.save(f"{OUT}/good-cover.png")

# ---------- 导出分析分辨率原始像素 ----------
names = ["bad-small-lowcontrast", "good-big-highcontrast", "cluttered", "whitespace", "good-cover"]
manifest = {}
for name in names:
    im = Image.open(f"{OUT}/{name}.png").convert("RGBA").resize((640, 360), Image.BILINEAR)
    raw = im.tobytes()
    with open(f"/home/hatch/workspace/products/micro-factory/cover-check/test/{name}.rgba", "wb") as f:
        f.write(raw)
    manifest[name] = {"width": 640, "height": 360}
with open("/home/hatch/workspace/products/micro-factory/cover-check/test/manifest.json", "w") as f:
    json.dump(manifest, f)
print("done:", ", ".join(names))
