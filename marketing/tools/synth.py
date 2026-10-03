"""動画用の音を、その場で作る（自作なので著作権フリー）。
軽いチップチューン風の曲 ＋ 具材が乗った「ぽん」 ＋ 崩れる「ガシャーン」 ＋ 締めのジングル。
使い方: python3 synth.py events.json out.wav"""
import json, math, random, struct, sys, wave

ev = json.load(open(sys.argv[1]))
SR = 44100
N = int(ev["total"] * SR) + SR // 2
buf = [0.0] * N
random.seed(7)

def note(f, t0, dur, vol, kind="sq", slide=0.0):
    i0 = int(t0 * SR); n = int(dur * SR); ph = 0.0
    for i in range(n):
        if i0 + i >= N: break
        ff = f * (1 + slide * i / n); ph += ff / SR
        x = ph % 1.0
        if kind == "sq": s = 1.0 if x < 0.5 else -1.0
        elif kind == "tri": s = 4 * abs(x - 0.5) - 1
        else: s = math.sin(2 * math.pi * ph)
        env = min(1.0, i / (0.004 * SR)) * (1 - i / n) ** 1.6
        buf[i0 + i] += s * vol * env

def noise(t0, dur, vol, decay=6.0):
    i0 = int(t0 * SR); n = int(dur * SR); lp = 0.0
    for i in range(n):
        if i0 + i >= N: break
        lp += 0.35 * (random.uniform(-1, 1) - lp)
        buf[i0 + i] += lp * vol * math.exp(-decay * i / n)

hz = lambda m: 440 * 2 ** ((m - 69) / 12)
# 曲：140BPM、C - Am - F - G のくり返し
beat = 60 / 140
prog = [(48, [60, 64, 67]), (45, [57, 60, 64]), (41, [57, 60, 65]), (43, [59, 62, 67])]
def playing(t):  # 曲を流す時間帯（bgmResume があれば、崩れた後に再開）
    return t < ev["bgmStop"] - 0.01 or (ev.get("bgmResume") is not None and ev["bgmResume"] <= t < ev["end"] - 0.05)
t, k = 0.0, 0
while t < ev["total"]:
    if not playing(t):
        t += beat / 2; k += 1; continue
    root, ch = prog[(k // 8) % 4]
    eighth = beat / 2
    note(hz(root - 12 + (12 if k % 2 else 0)), t, eighth * 0.9, 0.10, "sq")
    note(hz(ch[k % 3] + 12), t, eighth * 0.8, 0.045, "tri")
    if k % 2 == 0: note(110, t, 0.12, 0.35, "sin", slide=-0.6)   # キック
    else: noise(t, 0.05, 0.10, 9)                                   # ハイハット
    t += eighth; k += 1
# 具材が乗るたびに「ぽん」（だんだん高く）
for i, lt in enumerate(ev["lands"]):
    note(hz(72 + i * 2), lt, 0.12, 0.22, "sin", slide=0.25)
# 画面をタップした音・メッセージが届いた音
for tt in ev.get("taps", []): noise(tt, 0.03, 0.25, 12); note(1800, tt, 0.03, 0.08, "sin")
for tm in ev.get("msgs", []): note(hz(88), tm, 0.07, 0.10, "sin"); note(hz(93), tm + 0.07, 0.10, 0.10, "sin")
# 崩れる音
c = ev["crash"]
note(70, c, 0.5, 0.5, "sin", slide=-0.5); noise(c, 0.9, 0.55, 4)
for j in range(5): note(hz(84 - j * 3), c + 0.08 + j * 0.07, 0.09, 0.12, "sq")
# 締めのジングル
e = ev["end"] + 0.1
for j, m in enumerate([72, 76, 79, 84]): note(hz(m), e + j * 0.11, 0.25 if j < 3 else 0.7, 0.13, "sq")
note(hz(48), e + 0.33, 0.8, 0.12, "tri")

peak = max(abs(x) for x in buf) or 1
g = 0.89 / peak
with wave.open(sys.argv[2], "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x * g)) * 32767)) for x in buf))
print("audio ok", round(N / SR, 1), "s")
