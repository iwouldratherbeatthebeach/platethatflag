// Flag That Plate — reading a plate from a photo, in the browser.
//
// Tesseract run on a whole photo reads the small print ("Issued by and property of…") and misses
// the big plate characters, so this finds the plate's row of characters first and reads only that:
//
//   1. Draw the photo at a working size and look for blobs shaped like characters, dark on light
//      and light on dark, at three window sizes, then for rows of 4 to 12 such blobs of a similar
//      height side by side.
//   2. For each likely row, turn the full-size photo so the row is level, threshold each character
//      inside its own box and redraw only its strokes, black on white. Read that as one line of
//      A-Z and 0-9, in up to five drawings (sizes, widths, soft edges), because Tesseract's mistakes
//      change with the drawing.
//   3. Turn what was read into plate candidates (2-3 letters and 2-4 digits, either way round,
//      fixing O/0, I/1, B/8, S/5 and Z/2 by position) and score them, highest when the code exists
//      in plates.csv. A plate is only called clear when it scores high, two drawings put it first
//      and no other reading comes close.
//   4. If the whole photo gives nothing usable, find spots with the plate's pale blue and crimson
//      and read those up close: a plate is often too small to find in a photo of a whole car.
//
// The image work is plain JavaScript on canvas pixels; tesseract.js is the only library and loads
// on first use. Nothing leaves the browser.

const TESSERACT_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/* ---------------------------------------------------------------- candidates (pure) */

// Characters OCR mixes up, mapped to what they must be at a letter or a digit position.
const AS_LETTER = { 0: "O", 1: "I", 2: "Z", 4: "A", 5: "S", 6: "G", 7: "T", 8: "B" };
const AS_DIGIT = { O: "0", Q: "0", D: "0", U: "0", C: "0", I: "1", L: "1", J: "1", T: "7", Z: "2", S: "5", B: "8", G: "6", A: "4" };
// The first of three letters is usually the role letter: D, C or S. UN plates put a D last.
const AS_ROLE = { O: "D", 0: "D", Q: "D", G: "C", 6: "C", 5: "S" };
const AS_UN_ROLE = { O: "D", 0: "D", Q: "D" };
// Letters the reader confuses on plates: J and T read as I, V read as Y (seen on real DC plates).
// A code that isn't listed is tried again with one of them swapped, and kept if that makes a
// listed code. Only these: plates.csv is not complete (LN, on many DC plates, is missing), so a
// wider swap turns real, unlisted codes into listed wrong ones (DLN into DLM). A swapped reading
// is a guess and is never looked up without asking.
const LOOKALIKE = { I: "JT", Y: "V" };
const SWAP_COST = 10;
// What a fix costs: shapes that are nearly the same in plate lettering are cheap to swap.
const FIX_COST = { O: 4, 0: 4, Q: 6, D: 6, I: 6, 1: 6, L: 8, B: 10, 8: 10, S: 10, 5: 10, Z: 10, 2: 10, G: 10, 6: 10 };
const fixCost = (ch) => FIX_COST[ch] ?? 14;

// How common each layout is. Letters first: 3 letters + 4 digits today, 3 + 3 on older and
// motorcycle plates, 3 + 2 on low serials (DTG 76), 2 letters only when a separately boxed role
// letter was missed. Serial first: 4 digits + 3 letters, as on UN plates in New York (1034 CYD).
const LAYOUT = {
  letters: { "3+4": 30, "3+3": 24, "3+2": 16, "2+4": 12, "2+3": 6 },
  serial: { "4+3": 28, "3+3": 20, "4+2": 10, "3+2": 4 }
};

/**
 * How a row is redrawn for each read: character height in px, horizontal stretch, soft edges.
 * Chosen by reading real plate photos every way: the plain drawing reads most plates, widened
 * soft lettering fixes the narrow W and M, and a smaller soft drawing suits small, blurry plates.
 */
export const VARIANTS = [
  { targetH: 56, stretch: 1, soft: false },
  { targetH: 56, stretch: 1.6, soft: true },
  { targetH: 40, stretch: 1, soft: true },
  { targetH: 76, stretch: 1.3, soft: true },
  { targetH: 64, stretch: 1.6, soft: false }
];

/**
 * A plate that scores at least this in one read, and that two drawings put first, is looked up
 * without asking. Clear real reads score about 100; the best wrong reads seen in testing, 80.
 */
export const CONFIDENT = 86;

/**
 * Readings that score below this are noise, not plates: on 192 street photos of diplomatic cars,
 * every right reading scored 56 or more, and signs, grilles and fences mostly under 45.
 */
export const FLOOR = 45;

function fixed(chars, kind) {
  let subs = 0;
  let cost = 0;
  const out = [];
  for (const ch of chars) {
    const ok = kind === "letter" ? /[A-Z]/.test(ch) : /[0-9]/.test(ch);
    if (ok) out.push(ch);
    else {
      const swap = kind === "letter" ? AS_LETTER[ch] : AS_DIGIT[ch];
      if (!swap) return null;
      out.push(swap);
      subs++;
      cost += fixCost(ch);
    }
  }
  return { text: out.join(""), subs, cost };
}

/** How strongly the letters point at a real plates.csv code. */
function codeScore(letters, index) {
  const map = index?.map;
  if (!map) return 0;
  if (letters.length === 3) {
    if (map.has(letters)) return 40; // a role and a country, e.g. DCY
    if (/^[DCS]/.test(letters) && map.has(letters.slice(1))) return 20; // role letter + a known country code
    if (letters.endsWith("D") && map.has(letters.slice(0, 2))) return 20; // UN plates put the D last
    return 0;
  }
  if (letters.length === 2) return map.has(letters) ? 20 : 0;
  return 0;
}

/**
 * Letter readings to try: as read (digits fixed to letters), and, when that makes a listed code,
 * with a misread role letter fixed (the first, D, C or S, before a serial; the UN's trailing D
 * after one, as in 1034 CYD), or one look-alike letter swapped (DIB 0215 -> DJB).
 */
function letterReadings(chars, index, { serialFirst = false } = {}) {
  const plain = fixed(chars, "letter");
  const out = plain ? [plain] : [];
  if (chars.length !== 3 || !plain) return out;
  const listed = (text) => Boolean(index?.map?.has(text));
  const add = (text, subs, cost) => {
    if (listed(text) && !out.some((o) => o.text === text)) out.push({ text, subs, cost });
  };
  if (!serialFirst && AS_ROLE[chars[0]]) {
    const rest = fixed(chars.slice(1), "letter");
    if (rest) add(AS_ROLE[chars[0]] + rest.text, rest.subs + 1, rest.cost + fixCost(chars[0]));
  }
  if (serialFirst && AS_UN_ROLE[chars[2]]) {
    const rest = fixed(chars.slice(0, 2), "letter");
    if (rest) add(rest.text + AS_UN_ROLE[chars[2]], rest.subs + 1, rest.cost + fixCost(chars[2]));
  }
  if (!listed(plain.text)) {
    for (let i = 0; i < 3; i++) {
      // a zero in a letter's place can be a D or a C as well as an O (SPD 36 read as SP0 36)
      const swaps = (chars[i] === "0" ? "DC" : "") + (LOOKALIKE[plain.text[i]] || "");
      for (const swap of swaps) {
        const text = plain.text.slice(0, i) + swap + plain.text.slice(i + 1);
        if (listed(text) && !out.some((o) => o.text === text)) out.push({ text, subs: plain.subs + 1, cost: plain.cost + SWAP_COST, guess: true });
      }
    }
  }
  return out;
}

/**
 * Plate candidates in a piece of OCR text, best first.
 * Diplomatic plates read as 2-3 letters then 3-4 digits (DCY 0477, DJZ 832, and DL 0416 when the
 * separate role letter is missed), or serial first, as on UN plates in New York (1034 CYD). Every
 * run of 5-7 characters on a line is tried both ways round with each split, characters are fixed by
 * position (each fix costs), and the result is scored: layout, whether the code exists in
 * plates.csv, how much of the line it explains, and Tesseract's confidence.
 */
export function plateCandidates(text, index, { confidence = 0, bonus = 0 } = {}) {
  const found = new Map();
  const lines = String(text || "")
    .toUpperCase()
    .split(/\n+/)
    .map((line) => line.replace(/[^A-Z0-9]/g, ""))
    .filter((line) => line.length >= 5);

  for (const line of lines) {
    for (let start = 0; start < line.length; start++) {
      for (const lettersFirst of [true, false]) {
        for (const letterCount of [3, 2]) {
          // gap = 1 skips one stray mark read in the space between the letters and the digits
          for (const gap of [0, 1]) {
            for (const digitCount of [4, 3, 2]) {
              if (digitCount === 2 && !(lettersFirst && letterCount === 3)) continue; // DTG 76 only
              const end = start + letterCount + gap + digitCount;
              if (end > line.length) continue;
              const letterAt = lettersFirst ? start : start + digitCount + gap;
              const digitAt = lettersFirst ? start + letterCount + gap : start;
              const digits = fixed(line.slice(digitAt, digitAt + digitCount), "digit");
              if (!digits) continue;
              // a two-digit serial must be read as digits: "DIPLOMAT" is not DJP 10
              if (digitCount === 2 && digits.subs) continue;
              const layout = lettersFirst
                ? LAYOUT.letters[`${letterCount}+${digitCount}`]
                : LAYOUT.serial[`${digitCount}+${letterCount}`];
              for (const letters of letterReadings(line.slice(letterAt, letterAt + letterCount), index, { serialFirst: !lettersFirst })) {
                const plate = lettersFirst ? letters.text + digits.text : digits.text + letters.text;
                const extra = line.length - (end - start);
                const score = Math.round(
                  layout +
                    codeScore(letters.text, index) -
                    (letters.cost + digits.cost) -
                    8 * gap +
                    (extra === 0 ? 10 : -3 * extra) +
                    Math.max(0, Math.min(100, confidence)) * 0.2 +
                    bonus
                );
                const prev = found.get(plate);
                // a guess only while every way of reading it needed a swapped letter
                const guess = Boolean(letters.guess) && (!prev || prev.guess);
                if (!prev || prev.score < score) found.set(plate, { plate, score, subs: letters.subs + digits.subs, guess });
                else prev.guess = guess;
              }
            }
          }
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

/**
 * Merge candidate lists from several reads. `best` is the plate's best score in any one read;
 * `score`, used to rank, adds a little for each further read that found it (at most three), so a
 * plate read again and again ranks higher but never looks clearer than its best single read.
 * `tops` counts the reads that put it first, which is what "two reads agree" means.
 */
export function mergeCandidates(lists) {
  const byPlate = new Map();
  for (const list of lists) {
    list.forEach((c, i) => {
      const prev = byPlate.get(c.plate);
      if (!prev) byPlate.set(c.plate, { ...c, best: c.score, reads: 1, tops: i === 0 ? 1 : 0 });
      else {
        prev.reads += 1;
        if (i === 0) prev.tops += 1;
        prev.best = Math.max(prev.best, c.score);
        prev.guess = Boolean(prev.guess && c.guess);
      }
    });
  }
  for (const c of byPlate.values()) c.score = c.best + 4 * Math.min(3, c.reads - 1);
  const sorted = [...byPlate.values()].sort((a, b) => b.score - a.score || b.tops - a.tops);
  // a rival: another plate of the same length that one read scored nearly as high (DRL 9115
  // against DRL 1115). The reads disagree, so the first one is not clear.
  const [top, ...rest] = sorted;
  if (top) top.contested = rest.some((c) => c.plate.length === top.plate.length && c.best >= top.best - RIVAL_MARGIN);
  return sorted;
}

/** How close a rival's best read may come before the top plate stops counting as clear. */
export const RIVAL_MARGIN = 6;

/**
 * Clear enough to look up without asking: one read alone scored high, at least two reads put it
 * first, no rival came close, and it was read as it stands rather than guessed by swapping a
 * look-alike letter. Repeats do not count toward the bar: a weak reading repeated by many
 * drawings (DWB001 for DWB 0001) is still weak.
 */
export function isConfident(candidate) {
  return Boolean(candidate && candidate.best >= CONFIDENT && candidate.tops >= 2 && !candidate.contested && !candidate.guess);
}

/* ---------------------------------------------------------------- image work (pure, on pixel arrays) */

/** Luma, 0-255, one byte per pixel. */
export function toGray(rgba, width, height) {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  }
  return gray;
}

/** Summed-area table of a gray image, (width + 1) x (height + 1). */
export function integralImage(gray, width, height) {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y++) {
    let row = 0;
    for (let x = 1; x <= width; x++) {
      row += gray[(y - 1) * width + (x - 1)];
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + row;
    }
  }
  return integral;
}

/**
 * Adaptive threshold (Bradley): a pixel is foreground when it is clearly darker (or lighter) than
 * the mean of the window around it. Returns 1 for foreground, 0 for background.
 */
export function adaptiveMask(gray, width, height, { dark = true, radius = 0, t = 0.15, integral = null } = {}) {
  const r = radius || Math.max(8, Math.round(Math.max(width, height) / 16));
  integral = integral || integralImage(gray, width, height);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      const count = (x1 - x0) * (y1 - y0);
      const sum =
        integral[y1 * (width + 1) + x1] - integral[y0 * (width + 1) + x1] -
        integral[y1 * (width + 1) + x0] + integral[y0 * (width + 1) + x0];
      const mean = sum / count;
      const v = gray[y * width + x];
      mask[y * width + x] = dark ? (v < mean * (1 - t) ? 1 : 0) : (v > mean * (1 + t) && v > 60 ? 1 : 0);
    }
  }
  return mask;
}

/** 8-connected blobs of a mask: [{ id, x0, y0, x1, y1, n }], plus each pixel's blob id in `label`. */
export function labelBlobs(mask, width, height) {
  const label = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  const out = [];
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let top = 0;
    stack[top++] = start;
    label[start] = next;
    let x0 = width, y0 = height, x1 = 0, y1 = 0, n = 0;
    while (top) {
      const p = stack[--top];
      const x = p % width;
      const y = (p - x) / width;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (mask[q] && !label[q]) {
            label[q] = next;
            stack[top++] = q;
          }
        }
      }
    }
    out.push({ id: next, x0, y0, x1, y1, n });
  }
  return { blobs: out, label };
}

/** 8-connected blobs of a mask: [{ id, x0, y0, x1, y1, n }]. */
export function blobs(mask, width, height) {
  return labelBlobs(mask, width, height).blobs;
}

/**
 * Keep the character in a small thresholded crop and drop what sits around it: specks, and slivers
 * of the plate's frame or banner along the crop's edges. Returns a new mask.
 */
export function mainStrokes(mask, width, height) {
  const { blobs: parts, label } = labelBlobs(mask, width, height);
  if (!parts.length) return mask;
  const biggest = Math.max(...parts.map((p) => p.n));
  const keep = new Set();
  for (const p of parts) {
    const w = p.x1 - p.x0 + 1;
    const h = p.y1 - p.y0 + 1;
    const edgeSliver = (p.y0 === 0 || p.y1 === height - 1) && h < height * 0.3 && w > width * 0.5;
    const sideSliver = (p.x0 === 0 || p.x1 === width - 1) && w < width * 0.2 && p.n < biggest * 0.5;
    if (p.n >= biggest * 0.25 && !edgeSliver && !sideSliver) keep.add(p.id);
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) if (label[i] && keep.has(label[i])) out[i] = 1;
  return out;
}

/** A mask grown by one pixel in every direction (keeps the soft edge around each stroke). */
function grow(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < width) out[yy * width + xx] = 1;
        }
      }
    }
  }
  return out;
}

/** Slope of the row (dy per dx through the characters' centres), for straightening it. */
function rowSlope(chars) {
  if (chars.length < 2) return 0;
  const xs = chars.map((c) => (c.x0 + c.x1) / 2);
  const ys = chars.map((c) => (c.y0 + c.y1) / 2);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den ? num / den : 0;
}

function charLike(b, width, height, minH) {
  const w = b.x1 - b.x0 + 1;
  const h = b.y1 - b.y0 + 1;
  if (h < minH || h > height * 0.9) return false;
  if (b.x0 === 0 || b.y0 === 0 || b.x1 === width - 1 || b.y1 === height - 1) return false;
  const aspect = w / h;
  if (aspect < 0.08 || aspect > 1.3) return false;
  const fill = b.n / (w * h);
  return fill > 0.12 && fill < 0.95;
}

/** Group character blobs into rows: neighbours of a similar height, side by side on one baseline. */
function rows(chars) {
  chars.sort((a, b) => a.x0 - b.x0);
  const parent = chars.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < chars.length; i++) {
    const a = chars[i];
    const ha = a.y1 - a.y0 + 1;
    let best = -1;
    let bestGap = Infinity;
    for (let j = i + 1; j < chars.length; j++) {
      const b = chars[j];
      const hb = b.y1 - b.y0 + 1;
      const hmax = Math.max(ha, hb);
      const gap = b.x0 - a.x1;
      if (gap > 1.6 * hmax) {
        if (b.x0 - a.x1 > 3 * hmax) break;
        continue;
      }
      if (gap < -0.2 * hmax) continue;
      if (Math.min(ha, hb) / hmax < 0.65) continue;
      const ca = (a.y0 + a.y1) / 2;
      const cb = (b.y0 + b.y1) / 2;
      if (Math.abs(ca - cb) > 0.35 * hmax) continue;
      if (gap < bestGap) {
        bestGap = gap;
        best = j;
      }
    }
    if (best >= 0) parent[find(best)] = find(i);
  }
  const groups = new Map();
  chars.forEach((c, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(c);
  });
  return [...groups.values()];
}

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Rows of characters that could be a plate's main line, best first:
 * [{ x, y, w, h, charH, count, polarity, score, chars }] in the image's own pixels, where `chars`
 * are the character blobs of the row.
 */
export function findPlateLines(gray, width, height, { minH = 0 } = {}) {
  const minCharH = minH || Math.max(8, Math.round(Math.min(width, height) / 90));
  const integral = integralImage(gray, width, height);
  const side = Math.max(width, height);
  // A wide window suits big characters (a close-up). A narrow one keeps a small plate in a wide
  // shot from turning into one bright patch against a dark car.
  const passes = [];
  for (const radius of [Math.round(side / 16), Math.max(8, Math.round(side / 48)), Math.max(6, Math.round(side / 96))]) {
    for (const polarity of ["dark", "light"]) passes.push({ radius, polarity });
  }
  const lines = [];
  for (const { radius, polarity } of passes) {
    const mask = adaptiveMask(gray, width, height, { dark: polarity === "dark", radius, integral });
    const chars = blobs(mask, width, height).filter((b) => charLike(b, width, height, minCharH));
    for (const group of rows(chars)) {
      if (group.length < 4 || group.length > 12) continue;
      const heights = group.map((c) => c.y1 - c.y0 + 1);
      const charH = median(heights);
      const spread = Math.sqrt(heights.reduce((s, h) => s + (h - charH) ** 2, 0) / heights.length) / charH;
      const x0 = Math.min(...group.map((c) => c.x0));
      const y0 = Math.min(...group.map((c) => c.y0));
      const x1 = Math.max(...group.map((c) => c.x1));
      const y1 = Math.max(...group.map((c) => c.y1));
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      if (w < charH * 1.5) continue;
      const n = group.length;
      const countScore = n >= 6 && n <= 8 ? 30 : n === 5 || n === 9 ? 20 : n === 4 ? 10 : 4;
      lines.push({ x: x0, y: y0, w, h, charH, count: n, polarity, spread, countScore, chars: group });
    }
  }
  const tallest = Math.max(1, ...lines.map((l) => l.charH));
  for (const l of lines) {
    const cx = (l.x + l.w / 2) / width - 0.5;
    const cy = (l.y + l.h / 2) / height - 0.5;
    l.score = Math.round(l.countScore + 30 * (l.charH / tallest) - 25 * l.spread + 6 * (1 - Math.min(1, Math.hypot(cx, cy) * 1.5)));
  }
  lines.sort((a, b) => b.score - a.score);
  // drop rows that mostly repeat a better one (the same characters found in both polarities)
  const kept = [];
  for (const l of lines) {
    const overlaps = kept.some((k) => {
      const ix = Math.max(0, Math.min(k.x + k.w, l.x + l.w) - Math.max(k.x, l.x));
      const iy = Math.max(0, Math.min(k.y + k.h, l.y + l.h) - Math.max(k.y, l.y));
      return ix * iy > 0.6 * Math.min(k.w * k.h, l.w * l.h);
    });
    if (!overlaps) kept.push(l);
  }
  return kept;
}

/**
 * Where a diplomatic plate may be in a photo, by colour: plate-shaped patches of the plate's pale
 * blue field, ranked by size and by how much crimson band sits just above them. `rgba` is a small
 * copy of the photo (480 px wide). Returns up to `max` spots, { x, y } from 0 to 1, best first.
 */
export function plateColourSpots(rgba, width, height, max = 3) {
  const blue = new Uint8Array(width * height);
  const red = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < blue.length; i++, p += 4) {
    const r = rgba[p] / 255, g = rgba[p + 1] / 255, b = rgba[p + 2] / 255;
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b), sat = hi ? (hi - lo) / hi : 0;
    let hue = 0;
    if (hi !== lo) {
      if (hi === r) hue = 60 * (((g - b) / (hi - lo)) % 6);
      else if (hi === g) hue = 60 * ((b - r) / (hi - lo) + 2);
      else hue = 60 * ((r - g) / (hi - lo) + 4);
    }
    if (hue < 0) hue += 360;
    if (hue >= 175 && hue <= 215 && sat >= 0.12 && sat <= 0.65 && hi >= 0.5) blue[i] = 1;
    if ((hue <= 12 || hue >= 340) && sat >= 0.45 && hi >= 0.25) red[i] = 1;
  }
  const spots = [];
  for (const part of labelBlobs(blue, width, height).blobs) {
    const w = part.x1 - part.x0 + 1;
    const h = part.y1 - part.y0 + 1;
    if (part.n < 25 || w < 10 || w / h < 1.2 || w / h > 4 || part.n / (w * h) < 0.35) continue;
    const band = Math.max(2, Math.round(h * 0.45));
    let crimson = 0;
    for (let y = Math.max(0, part.y0 - band); y < Math.min(height, part.y0 + 2); y++) {
      for (let x = part.x0; x <= part.x1; x++) crimson += red[y * width + x];
    }
    const share = crimson / (w * (band + 2));
    spots.push({ x: (part.x0 + w / 2) / width, y: (part.y0 + h / 2) / height, score: part.n * (0.3 + share) });
  }
  return spots.sort((a, b) => b.score - a.score).slice(0, max).map(({ x, y }) => ({ x, y }));
}

/** Otsu's threshold for a gray array. */
export function otsu(gray) {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = i;
    }
  }
  return threshold;
}

/* ---------------------------------------------------------------- browser glue */

let tesseractReady;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tesseractReady) {
    tesseractReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TESSERACT_SRC;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error("Tesseract missing")));
      script.onerror = () => {
        tesseractReady = null;
        script.remove();
        reject(new Error("Tesseract failed to load"));
      };
      document.head.append(script);
    });
  }
  return tesseractReady;
}

let workerReady;
let progressSink = null;
/** One worker for the whole visit: the language data loads once. */
function getWorker() {
  if (!workerReady) {
    workerReady = loadTesseract()
      .then((Tesseract) =>
        Tesseract.createWorker("eng", 1, {
          logger: (m) => {
            if (progressSink && m && typeof m.progress === "number") progressSink(m);
          }
        })
      )
      .then(async (worker) => {
        await worker.setParameters({
          tessedit_pageseg_mode: "7",
          tessedit_char_whitelist: ALPHANUM,
          user_defined_dpi: "300"
        });
        return worker;
      })
      .catch((error) => {
        workerReady = null;
        throw error;
      });
  }
  return workerReady;
}

/** Start loading the reader early, e.g. while the file picker is open. */
export function warmUp() {
  return getWorker().then(() => true, () => false);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not an image this browser can open"));
    };
    img.src = url; // an <img> applies the photo's EXIF rotation when drawn
  });
}

function canvas(width, height) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

/** Draw part of the photo at a working size; returns its gray pixels and the scale used. */
function sample(img, region, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(region.w, region.h));
  const c = canvas(region.w * scale, region.h * scale);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(img, region.x, region.y, region.w, region.h, 0, 0, c.width, c.height);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  return { gray: toGray(data, c.width, c.height), width: c.width, height: c.height, scale };
}


/**
 * Redraw one row of characters for Tesseract. The photo is turned so the row is level, each
 * character found is thresholded inside its own box, and only its main strokes are drawn, black on
 * white and `targetH` px tall. Plate lettering is tall and narrow, so `stretch` widens it, which
 * Tesseract reads more reliably; `soft` keeps grey edges, which suits small, blurry characters.
 * Borders, the banner, bolts and stickers around the row never reach the reader.
 */
export function lineImage(img, region, line, scale, { targetH = 56, stretch = 1, soft = false } = {}) {
  const charH = line.charH / scale; // in photo pixels
  const theta = Math.atan(rowSlope(line.chars)); // how far the row is turned
  const k = Math.min(targetH / charH, 1600 / ((line.w / scale) * stretch + charH)); // photo -> output, vertical
  const kx = k * stretch;
  const cos = Math.cos(-theta);
  const sin = Math.sin(-theta);

  // 1. An upright copy of the row: the photo turned about the row's centre so the row is level,
  //    already at the output scale.
  const cx = region.x + (line.x + line.w / 2) / scale;
  const cy = region.y + (line.y + line.h / 2) / scale;
  const halfW = line.w / scale / 2 + charH;
  const halfH = line.h / scale / 2 + charH * 0.6;
  const upright = canvas(2 * halfW * kx, 2 * halfH * k);
  const ug = upright.getContext("2d", { willReadFrequently: true });
  ug.imageSmoothingQuality = "high";
  ug.setTransform(kx, 0, 0, k, upright.width / 2, upright.height / 2);
  ug.rotate(-theta);
  ug.translate(-cx, -cy);
  const reach = halfW + halfH; // enough of the photo around the row to fill the turned copy
  const sx = Math.max(0, cx - reach);
  const sy = Math.max(0, cy - reach);
  const sw = Math.min(img.naturalWidth, cx + reach) - sx;
  const sh = Math.min(img.naturalHeight, cy + reach) - sy;
  ug.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh);
  const uw = upright.width;
  const uh = upright.height;
  let gray = toGray(ug.getImageData(0, 0, uw, uh).data, uw, uh);
  if (line.polarity === "light") gray = gray.map((v) => 255 - v); // light on dark: flip it

  // 2. Each character's box in the upright copy.
  const boxes = line.chars.map((c) => {
    const px = region.x + (c.x0 + c.x1 + 1) / 2 / scale - cx;
    const py = region.y + (c.y0 + c.y1 + 1) / 2 / scale - cy;
    const ux = (cos * px - sin * py) * kx + uw / 2;
    const uy = (sin * px + cos * py) * k + uh / 2;
    const m = 0.1 * (c.y1 - c.y0 + 1); // a little background around the character, view pixels
    const hw = (((c.x1 - c.x0 + 1) / 2 + m) / scale) * kx;
    const hh = (((c.y1 - c.y0 + 1) / 2 + m) / scale) * k;
    const x0 = Math.max(0, Math.round(ux - hw));
    const y0 = Math.max(0, Math.round(uy - hh));
    const x1 = Math.min(uw, Math.round(ux + hw));
    const y1 = Math.min(uh, Math.round(uy + hh));
    return { x0, y0, x1, y1 };
  }).filter((b) => b.x1 - b.x0 > 1 && b.y1 - b.y0 > 1);

  const minX = Math.min(...boxes.map((b) => b.x0));
  const maxX = Math.max(...boxes.map((b) => b.x1));
  const minY = Math.min(...boxes.map((b) => b.y0));
  const maxY = Math.max(...boxes.map((b) => b.y1));
  const pad = 24;
  const out = canvas(maxX - minX + 2 * pad, maxY - minY + 2 * pad);
  const o = out.getContext("2d", { willReadFrequently: true });
  o.fillStyle = "#fff";
  o.fillRect(0, 0, out.width, out.height);
  const page = o.getImageData(0, 0, out.width, out.height);

  // 3. Threshold each character inside its own box, keep its main strokes, draw it.
  for (const b of boxes) {
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const cell = new Uint8ClampedArray(bw * bh);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) cell[y * bw + x] = gray[(b.y0 + y) * uw + b.x0 + x];
    }
    const cut = otsu(cell);
    const ink = new Uint8Array(cell.length);
    let inkSum = 0, inkN = 0, paperSum = 0, paperN = 0;
    for (let i = 0; i < cell.length; i++) {
      if (cell[i] <= cut) { ink[i] = 1; inkSum += cell[i]; inkN++; } else { paperSum += cell[i]; paperN++; }
    }
    const strokes = mainStrokes(ink, bw, bh);
    const near = soft ? grow(strokes, bw, bh) : strokes;
    const inkLevel = inkN ? inkSum / inkN : 0;
    const span = (paperN ? paperSum / paperN : 255) - inkLevel || 1;
    for (let y = 0; y < bh; y++) {
      const yy = b.y0 - minY + pad + y;
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        if (!near[i]) continue;
        // 0 = ink, 255 = paper; soft keeps the anti-aliased edge of each stroke
        const v = soft ? Math.max(0, Math.min(255, (255 * (cell[i] - inkLevel)) / span)) : 0;
        const p = (yy * out.width + (b.x0 - minX + pad + x)) * 4;
        const value = Math.min(page.data[p], v);
        page.data[p] = page.data[p + 1] = page.data[p + 2] = value;
      }
    }
  }
  o.putImageData(page, 0, 0);
  return out;
}

/**
 * Read a plate from a photo.
 *   file      the image the person picked
 *   index     parsePlates() output, to prefer codes that exist
 *   focus     optional { x, y } from 0 to 1: look near this point (the person tapped the plate)
 *   onProgress(fraction, label)
 *   debug     keep the images Tesseract read and the rows found, for testing
 * When the whole photo gives nothing usable, up to three spots with the plate's colours are read
 * up close. Resolves to { best, confident, candidates, reads, width, height }; best may be null.
 * Reads run one at a time (they share one worker): a second photo waits for the first.
 */
let queue = Promise.resolve();
export function readPlate(file, options = {}) {
  const job = queue.then(() => readOne(file, options));
  queue = job.catch(() => {});
  return job;
}

async function readOne(file, { index, focus = null, onProgress = () => {}, debug = false } = {}) {
  onProgress(0.02, "Opening the photo");
  const photo = await loadImage(file);
  try {
    onProgress(0.05, "Loading the reader");
    const worker = await getWorker();
    const reads = [];
    const lists = [];
    const seen = [];
    const best = () => mergeCandidates(lists)[0];
    const usable = () => (best()?.best ?? -Infinity) >= FLOOR;

    // Read one part of the photo: find its rows of characters, then read each row as drawn and,
    // if that gives no clear plate, again wider, smaller and larger, because Tesseract's mistakes
    // change with the drawing. Stops at the first clear plate.
    const readRegion = async (region, from, to) => {
      const view = sample(photo.img, region, 1400);
      const lines = findPlateLines(view.gray, view.width, view.height).slice(0, 4);
      seen.push(...lines);
      const passes = lines.length * VARIANTS.length;
      let done = 0;
      progressSink = (m) => {
        if (m.status === "recognizing text") onProgress(from + (to - from) * Math.min(1, (done + m.progress) / Math.max(1, passes)), "Reading the plate");
      };
      for (const line of lines) {
        const bonus = Math.round(line.score / 10);
        for (const variant of VARIANTS) {
          const image = lineImage(photo.img, region, line, view.scale, variant);
          // a data URL, not the canvas: tesseract.js turns a canvas into a blob with toBlob(),
          // which some browsers delay by up to a second
          const { data } = await worker.recognize(image.toDataURL("image/png"));
          done++;
          reads.push({ text: data.text, confidence: data.confidence, line, variant, region, image: debug ? image : undefined });
          const list = plateCandidates(data.text, index, { confidence: data.confidence, bonus });
          lists.push(list);
          if (!list.length && variant === VARIANTS[0]) break; // nothing plate-like in this row: next row
          if (isConfident(best())) return true;
        }
      }
      return false;
    };

    onProgress(0.12, "Looking for the plate");
    const whole = { x: 0, y: 0, w: photo.width, h: photo.height };
    let clear = await readRegion(focus ? around(photo, focus) : whole, 0.2, focus ? 0.95 : 0.6);

    // A plate that is small in the photo (a whole car, from across the street) is often missed at
    // the size the photo is searched at. Look for the plate's own colours, then read up to three
    // such spots up close, as if the person had tapped them.
    if (!focus && !clear && !usable()) {
      onProgress(0.62, "Looking closer");
      const spots = plateColourSpots(...colourSample(photo.img, photo.width, photo.height), 3);
      for (const [i, spot] of spots.entries()) {
        const from = 0.62 + (0.33 * i) / spots.length;
        clear = await readRegion(around(photo, spot), from, from + 0.33 / spots.length);
        if (clear || usable()) break;
      }
    }
    progressSink = null;

    // below the floor a reading is noise (a sign, a grille), not a plate
    const candidates = mergeCandidates(lists).filter((c) => c.best >= FLOOR);
    onProgress(1, "Done");
    return {
      best: candidates[0] || null,
      confident: isConfident(candidates[0]),
      candidates: candidates.slice(0, 5),
      reads,
      width: photo.width,
      height: photo.height,
      lines: debug ? seen : undefined
    };
  } finally {
    progressSink = null;
    URL.revokeObjectURL(photo.url);
  }
}

/** The part of the photo around a point (from 0 to 1) that a tap, or a colour spot, reads. */
function around(photo, point) {
  const w = Math.round(photo.width * 0.5);
  const h = Math.round(photo.height * 0.35);
  const x = Math.round(Math.min(Math.max(0, point.x * photo.width - w / 2), photo.width - w));
  const y = Math.round(Math.min(Math.max(0, point.y * photo.height - h / 2), photo.height - h));
  return { x, y, w, h };
}

/** The photo drawn 480 px wide, for the colour search: [rgba, width, height]. */
function colourSample(img, width, height) {
  const c = canvas(480, (480 * height) / width);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, c.width, c.height);
  return [g.getImageData(0, 0, c.width, c.height).data, c.width, c.height];
}
