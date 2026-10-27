// Run with: node --test tests/*.test.mjs
// Photo reading: turning OCR text into plate candidates, and finding a row of characters in pixels.
// (Tesseract itself only runs in the browser; these cover everything around it.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePlates } from "../assets/js/plates.js";
import {
  plateCandidates, mergeCandidates, isConfident, CONFIDENT, otsu, adaptiveMask, blobs, mainStrokes, findPlateLines,
  plateColourSpots
} from "../assets/js/reader.js";

const index = parsePlates(readFileSync(new URL("../plates.csv", import.meta.url), "utf8"));
const best = (text, confidence = 80) => plateCandidates(text, index, { confidence })[0]?.plate || "";

test("a clean read becomes the plate", () => {
  assert.equal(best("DCY0477"), "DCY0477");
  assert.equal(best("DCY 0477\n"), "DCY0477");
  assert.equal(best("DUA0206"), "DUA0206");
});

test("O/0, I/1 and B/8 are fixed by position", () => {
  assert.equal(best("DWBOOO1"), "DWB0001"); // O read for 0 in the serial
  assert.equal(best("0WB0001"), "DWB0001"); // the role letter D read as 0
  assert.equal(best("DLO416"), "DL0416"); // the role letter was missed; the code DL exists
});

test("stray marks around the plate and in the gap are skipped", () => {
  assert.equal(best("IDCY04771"), "DCY0477");
  assert.equal(best("DCY-0477"), "DCY0477");
  assert.equal(best("DCYO0477"), "DCY0477"); // a speck in the gap read as O
});

test("three-digit plates read as they are", () => {
  assert.equal(best("DJZ832"), "DJZ832");
  assert.equal(best("CD\nDJZ832"), "DJZ832");
});

test("plates with the serial first read as they are (UN plates in New York)", () => {
  assert.equal(best("1034CYD"), "1034CYD");
  assert.equal(best("1034 CYD"), "1034CYD");
  assert.equal(best("IO34CYD"), "1034CYD"); // I and O read for 1 and 0 in the serial (was IO 340)
  assert.equal(best("1034CY0"), "1034CYD"); // the UN's D read as 0
  assert.equal(best("NEW YORK CITY\n1034 CYD\nSILVER STAR"), "1034CYD"); // frame text around it
  // letters first still wins where it fits: the trailing-D fix only applies after a serial
  assert.equal(best("DLO416"), "DL0416");
});

test("two-digit serials read as they are, and only from real digits", () => {
  assert.equal(best("DTG76"), "DTG76");
  assert.equal(best("DTG 76"), "DTG76");
  assert.equal(best("SP036"), "SPD36"); // the D of SPD read as 0
  assert.equal(best("DN404"), "DNA04"); // the A read as 4
  assert.equal(best("DIPLOMAT"), ""); // the band is not DJP 10
});

test("a look-alike letter is swapped only into a listed code, and only as a guess", () => {
  const read = (text) => plateCandidates(text, index, { confidence: 95 });
  assert.equal(best("DIB0215"), "DJB0215"); // J read as I
  assert.equal(best("SYF0283"), "SVF0283"); // V read as Y
  assert.equal(best("DLN0965"), "DLN0965"); // LN isn't listed, but nothing is swapped into it
  const twice = mergeCandidates([read("DIB0215"), read("DIB0215")]);
  assert.equal(twice[0].plate, "DJB0215");
  assert.equal(twice[0].guess, true);
  assert.equal(isConfident(twice[0]), false, "a guess is never looked up without asking");
});

test("reads that disagree on the serial are not clear", () => {
  const read = (text) => plateCandidates(text, index, { confidence: 70 });
  // three drawings read 9115 as I115, one read it right and scored higher
  const merged = mergeCandidates([read("DRLI115"), read("DRLI115"), read("DRL9115"), read("DRLI115")]);
  assert.equal(merged[0].contested, true);
  assert.equal(isConfident(merged[0]), false);
});

test("the plate's colours point at where it is", () => {
  // a grey street, a dark car, and a small plate: pale blue under a crimson band
  const W = 480, H = 320;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const paint = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = (y * W + x) * 4; rgba[p] = r; rgba[p + 1] = g; rgba[p + 2] = b; rgba[p + 3] = 255; }
  };
  paint(0, 0, W, H, [128, 130, 133]);
  paint(80, 120, 400, 300, [30, 32, 36]);
  paint(300, 238, 340, 244, [168, 12, 40]); // the band
  paint(300, 244, 340, 258, [169, 218, 232]); // the field
  paint(20, 20, 200, 60, [120, 160, 230]); // a strong blue sign, too saturated to be a plate
  const [spot] = plateColourSpots(rgba, W, H);
  assert.ok(spot, "a spot was found");
  assert.ok(Math.abs(spot.x - 320 / W) < 0.03 && Math.abs(spot.y - 251 / H) < 0.04, JSON.stringify(spot));
});

test("small print never turns into a confident plate", () => {
  for (const text of ["Issued By And Property Of The 10 - 07", "becAL Issuet by", "DIPLOMAT", "UNITED STATES DEPARTMENT OF STATE"]) {
    const top = plateCandidates(text, index, { confidence: 90 })[0];
    assert.ok(!top || top.score < 40, `${text} -> ${top && top.plate} ${top && top.score}`);
  }
});

test("a code that exists outranks one that does not", () => {
  const [first, second] = plateCandidates("DCY0477", index, { confidence: 80 });
  assert.equal(first.plate, "DCY0477");
  assert.ok(first.score - second.score >= 10);
});

test("two agreeing reads are needed to look a plate up without asking", () => {
  const read = (text) => plateCandidates(text, index, { confidence: 85 });
  const once = mergeCandidates([read("DCY0477")]);
  assert.equal(once[0].plate, "DCY0477");
  assert.ok(once[0].score >= CONFIDENT);
  assert.equal(isConfident(once[0]), false, "one read is not enough");
  const twice = mergeCandidates([read("DCY0477"), read("DCY 0477")]);
  assert.equal(twice[0].tops, 2);
  assert.equal(isConfident(twice[0]), true);
  const disagree = mergeCandidates([read("DCY0477"), read("DCY0471")]);
  assert.equal(disagree[0].tops, 1);
  assert.equal(isConfident(disagree[0]), false);
});

test("a weak reading repeated by many drawings is still not clear", () => {
  const weak = plateCandidates("DCY047", index, { confidence: 30 }); // a digit lost: 3 + 3
  assert.equal(weak[0].plate, "DCY047");
  assert.ok(weak[0].score < CONFIDENT, `single read scores ${weak[0].score}`);
  const merged = mergeCandidates(Array.from({ length: 8 }, () => weak));
  assert.equal(merged[0].tops, 8);
  assert.equal(merged[0].best, weak[0].score);
  assert.equal(merged[0].score, weak[0].score + 12, "repeats add at most 12 to the ranking");
  assert.equal(isConfident(merged[0]), false);
});

/* ---------------------------------------------------------------- pixels */
// A tiny raster: a light plate with dark ring-shaped "characters" on one row, plus noise.
function plateImage({ width = 320, height = 160, chars = 7, charW = 22, charH = 48, gap = 12, y = 56, x = 40, slope = 0 } = {}) {
  const gray = new Uint8ClampedArray(width * height).fill(210);
  for (let c = 0; c < chars; c++) {
    const left = x + c * (charW + gap);
    const top = Math.round(y + slope * (left - x));
    for (let yy = top; yy < top + charH; yy++) {
      for (let xx = left; xx < left + charW; xx++) {
        const edge = xx - left < 5 || left + charW - 1 - xx < 5 || yy - top < 5 || top + charH - 1 - yy < 5;
        if (edge) gray[yy * width + xx] = 30;
      }
    }
  }
  // a thin dark line under the row, like the plate's frame
  for (let xx = 10; xx < width - 10; xx++) gray[(y + charH + 40) * width + xx] = 40;
  return { gray, width, height };
}

test("Otsu splits a two-level image between the levels", () => {
  const cut = otsu(Uint8ClampedArray.from([...new Array(50).fill(30), ...new Array(50).fill(210)]));
  assert.ok(cut >= 30 && cut < 210);
});

test("adaptive threshold and blobs find each dark character", () => {
  const { gray, width, height } = plateImage();
  const mask = adaptiveMask(gray, width, height, { dark: true, radius: 20 });
  const found = blobs(mask, width, height).filter((b) => b.y1 - b.y0 + 1 >= 40);
  assert.equal(found.length, 7);
});

test("findPlateLines finds the row of characters, level or tilted", () => {
  for (const slope of [0, 0.12]) {
    const { gray, width, height } = plateImage({ slope });
    const [line] = findPlateLines(gray, width, height);
    assert.ok(line, `a row at slope ${slope}`);
    assert.equal(line.count, 7);
    assert.ok(Math.abs(line.charH - 48) <= 2);
    assert.equal(line.polarity, "dark");
  }
});

test("findPlateLines finds light characters on a dark plate too", () => {
  const { gray, width, height } = plateImage();
  for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i];
  const [line] = findPlateLines(gray, width, height);
  assert.ok(line);
  assert.equal(line.count, 7);
  assert.equal(line.polarity, "light");
});

test("mainStrokes keeps the character and drops slivers of the frame", () => {
  const w = 30, h = 50;
  const mask = new Uint8Array(w * h);
  for (let y = 8; y < 44; y++) for (let x = 8; x < 22; x++) mask[y * w + x] = 1; // the character
  for (let x = 0; x < w; x++) mask[(h - 1) * w + x] = 1; // frame along the bottom edge
  mask[2 * w + 3] = 1; // a speck
  const out = mainStrokes(mask, w, h);
  assert.equal(out[20 * w + 15], 1);
  assert.equal(out[(h - 1) * w + 5], 0);
  assert.equal(out[2 * w + 3], 0);
});
