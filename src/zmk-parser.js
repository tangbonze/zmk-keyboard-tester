/**
 * Pure JavaScript ZMK Devicetree, Keymap, and Physical Layout Parser.
 * Works identically in modern browsers (GitHub Pages) and Node.js.
 */

import {
  canonicalZmkKey,
  displayForKey,
  extractModifiedKeycode,
} from "./zmk-keycodes.js";

const SHIELD_ALIASES = {
  crkbd: "corne",
  corne_choc_pro: "corne",
  sweep: "cradio",
  ferris: "ferris",
};

const NON_KEYBOARD_SHIELDS = new Set([
  "nice_view",
  "nice_view_adapter",
  "nice_epaper",
  "oled",
  "settings_reset",
  "zmk_uno",
  "dongle_display",
  "pro_micro",
  "nice_nano",
  "nice_nano_v2",
]);

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dirnamePosix(p) {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? "" : p.slice(0, idx);
}

function basenamePosix(p) {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

function normalizePosixPath(p) {
  const parts = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

// MARK: - Comment Stripping & Preprocessor

export function stripCommentsPreserveNewlines(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  let inStr = false;

  while (i < n) {
    const ch = text[i];
    if (inStr) {
      out.push(ch);
      if (ch === "\\" && i + 1 < n) {
        out.push(text[i + 1]);
        i += 2;
        continue;
      }
      if (ch === '"') inStr = false;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inStr = true;
      out.push(ch);
      i += 1;
    } else if (ch === "/" && i + 1 < n && text[i + 1] === "*") {
      let end = text.indexOf("*/", i + 2);
      end = end === -1 ? n : end + 2;
      const slice = text.slice(i, end);
      const nlCount = (slice.match(/\n/g) || []).length;
      out.push(nlCount ? "\n".repeat(nlCount) : " ");
      i = end;
    } else if (ch === "/" && i + 1 < n && text[i + 1] === "/") {
      const end = text.indexOf("\n", i + 2);
      if (end === -1) {
        i = n;
      } else {
        out.push("\n");
        i = end + 1;
      }
    } else {
      out.push(ch);
      i += 1;
    }
  }
  return out.join("");
}

export function joinBackslashContinuations(text) {
  return text.replace(/\\\r?\n/g, " ");
}

const ZMK_HELPERS_PRELUDE = {
  func: {
    ZMK_LAYER: {
      params: ["name", "layout"],
      body: '/ { keymap { compatible = "zmk,keymap"; name { display-name = "name"; bindings = <layout>; }; }; };',
    },
    ZMK_HOLD_TAP: {
      params: ["name", "props"],
      body: '/ { behaviors { name: name { compatible = "zmk,behavior-hold-tap"; #binding-cells = <2>; props }; }; };',
    },
  },
};

export function preprocessDts(
  text,
  files = {},
  currentPath = "",
  visited = new Set(),
  sharedState = null
) {
  const cleaned = joinBackslashContinuations(stripCommentsPreserveNewlines(text));
  const state = sharedState || {
    objMacros: {},
    funcMacros: { ...ZMK_HELPERS_PRELUDE.func },
    defined: new Set(),
  };
  const outputLines = [];
  const currentDir = dirnamePosix(currentPath);
  // Stack of { active: boolean, parentActive: boolean, seenTrue: boolean }
  const condStack = [];
  const isActive = () => condStack.every((c) => c.active);

  function resolveInclude(inc) {
    const candidates = [];
    if (currentDir) {
      candidates.push(normalizePosixPath(`${currentDir}/${inc}`));
    }
    candidates.push(inc, `config/${inc}`, `include/${inc}`);
    for (const c of candidates) {
      if (Object.prototype.hasOwnProperty.call(files, c)) return c;
    }
    return null;
  }

  for (const line of cleaned.split(/\r?\n/)) {
    const stripped = line.trim();

    if (/^#ifdef\s+([A-Za-z_]\w*)/.test(stripped)) {
      const sym = stripped.match(/^#ifdef\s+([A-Za-z_]\w*)/)[1];
      const cond = state.defined.has(sym);
      const parent = isActive();
      condStack.push({ active: parent && cond, parentActive: parent, seenTrue: cond });
      continue;
    }
    if (/^#ifndef\s+([A-Za-z_]\w*)/.test(stripped)) {
      const sym = stripped.match(/^#ifndef\s+([A-Za-z_]\w*)/)[1];
      const cond = !state.defined.has(sym);
      const parent = isActive();
      condStack.push({ active: parent && cond, parentActive: parent, seenTrue: cond });
      continue;
    }
    if (/^#else\b/.test(stripped)) {
      if (condStack.length > 0) {
        const top = condStack[condStack.length - 1];
        top.active = top.parentActive && !top.seenTrue;
        top.seenTrue = true;
      }
      continue;
    }
    if (/^#endif\b/.test(stripped)) {
      condStack.pop();
      continue;
    }

    if (!isActive()) continue;

    if (stripped.startsWith("#include")) {
      const m = stripped.match(/^#include\s+[<"]([^>"]+)[>"]/);
      if (m) {
        const resolved = resolveInclude(m[1]);
        if (resolved && !visited.has(resolved)) {
          visited.add(resolved);
          const sub = preprocessDts(files[resolved], files, resolved, visited, state);
          outputLines.push(sub.text);
        }
      }
      continue;
    }

    if (stripped.startsWith("#define")) {
      const mf = stripped.match(/^#define\s+([A-Za-z_]\w*)\(([^)]*)\)\s*(.*)$/);
      if (mf) {
        const params = mf[2]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        state.funcMacros[mf[1]] = { params, body: mf[3].trim() };
        state.defined.add(mf[1]);
        continue;
      }
      const mo = stripped.match(/^#define\s+([A-Za-z_]\w*)(?:\s+(.*))?$/);
      if (mo) {
        const body = (mo[2] || "").trim();
        state.defined.add(mo[1]);
        if (body) state.objMacros[mo[1]] = body;
        continue;
      }
      continue;
    }

    if (stripped.startsWith("#")) {
      continue;
    }

    outputLines.push(line);
  }

  let bodyText = outputLines.join("\n");
  if (sharedState) {
    // Only expand at top-level after all includes & defines are collected
    return { text: bodyText, macros: { obj: state.objMacros, func: state.funcMacros } };
  }

  const objMacros = state.objMacros;
  const funcMacros = state.funcMacros;

  // Bounded macro expansion passes
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;

    for (const [fname, { params, body }] of Object.entries(funcMacros)) {
      const re = new RegExp(`\\b${escapeRegExp(fname)}\\s*\\(`, "g");
      let pos = 0;
      const parts = [];
      while (true) {
        re.lastIndex = pos;
        const m = re.exec(bodyText);
        if (!m) {
          parts.push(bodyText.slice(pos));
          break;
        }
        parts.push(bodyText.slice(pos, m.index));
        const argStart = m.index + m[0].length;
        let depth = 1;
        let i = argStart;
        const args = [];
        let curArgStart = argStart;
        while (i < bodyText.length && depth > 0) {
          const c = bodyText[i];
          if (c === "(") depth += 1;
          else if (c === ")") {
            depth -= 1;
            if (depth === 0) {
              args.push(bodyText.slice(curArgStart, i).trim());
              break;
            }
          } else if (c === "," && depth === 1) {
            args.push(bodyText.slice(curArgStart, i).trim());
            curArgStart = i + 1;
          }
          i += 1;
        }
        if (depth === 0) {
          let expanded = body;
          params.forEach((p, idx) => {
            if (idx < args.length) {
              const val = idx === params.length - 1 ? args.slice(idx).join(", ") : args[idx];
              expanded = expanded.replace(new RegExp(`\\b${escapeRegExp(p)}\\b`, "g"), val);
            }
          });
          parts.push(expanded);
          pos = i + 1;
          changed = true;
        } else {
          parts.push(m[0]);
          pos = argStart;
        }
      }
      bodyText = parts.join("");
    }

    const objKeys = Object.keys(objMacros).sort((a, b) => b.length - a.length);
    if (objKeys.length > 0) {
      const re = new RegExp(`\\b(${objKeys.map(escapeRegExp).join("|")})\\b`, "g");
      bodyText = bodyText.replace(re, (tok) => {
        const val = objMacros[tok];
        if (val !== undefined && val !== tok) {
          changed = true;
          return val;
        }
        return tok;
      });
    }

    if (!changed) break;
  }

  return { text: bodyText, macros: { obj: objMacros, func: funcMacros } };
}

// MARK: - Devicetree Blocks & Bindings

export function findMatchingBrace(text, openIdx) {
  let depth = 0;
  let inStr = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\" && i + 1 < text.length) {
        i += 1;
        continue;
      }
      if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
  }
  return text.length - 1;
}

function extractDtsBlocks(text, blockNamePattern) {
  const results = [];
  const re = new RegExp(`(${blockNamePattern})\\s*\\{`, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingBrace(text, openIdx);
    results.push({
      header: m[1].trim(),
      body: text.slice(openIdx + 1, closeIdx),
    });
    re.lastIndex = closeIdx + 1;
  }
  return results;
}

export function extractChosenRefs(text) {
  const refs = {};
  for (const { body } of extractDtsBlocks(text, "\\bchosen\\b")) {
    const mPhys = body.match(/zmk,physical-layout\s*=\s*&([A-Za-z0-9_]+)\s*;/);
    if (mPhys) refs.physicalLayout = mPhys[1];
    const mMat = body.match(/zmk,matrix-transform\s*=\s*&([A-Za-z0-9_]+)\s*;/);
    if (mMat) refs.matrixTransform = mMat[1];
  }
  return refs;
}

export function parseBehaviors(text) {
  const behaviors = {};
  for (const { body } of extractDtsBlocks(text, "(?:[A-Za-z0-9_]+\\s*:\\s*)?behaviors\\b")) {
    const nodeRe = /([A-Za-z0-9_]+)\s*:\s*[A-Za-z0-9_@-]+\s*\{/g;
    let m;
    while ((m = nodeRe.exec(body)) !== null) {
      const openIdx = m.index + m[0].length - 1;
      const closeIdx = findMatchingBrace(body, openIdx);
      const sub = body.slice(openIdx + 1, closeIdx);
      const comp = sub.match(/compatible\s*=\s*"([^"]+)"/);
      if (comp) {
        behaviors[m[1]] = comp[1];
      }
      nodeRe.lastIndex = closeIdx + 1;
    }
  }
  return behaviors;
}

function tokenizeBindingArgs(argStr) {
  const tokens = [];
  let cur = "";
  let depth = 0;
  for (const ch of argStr.trim()) {
    if (ch === "(") {
      depth += 1;
      cur += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (/\s/.test(ch) && depth === 0) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

export function interpretBinding(rawBinding, behaviors = {}) {
  const raw = rawBinding.replace(/\s+/g, " ").trim();
  const m = raw.match(/^&([A-Za-z0-9_]+)(.*)$/);
  if (!m) {
    return {
      raw,
      behavior: "unknown",
      tap: raw,
      hold: null,
      displayTap: raw,
      displayHold: null,
      matchCodes: [],
      holdLayer: null,
      tapLayer: null,
    };
  }

  const beh = m[1];
  const args = tokenizeBindingArgs(m[2]);
  const behCompat = behaviors[beh] || "";

  let tap = null;
  let hold = null;
  let displayTap = "";
  let displayHold = null;
  const matchCodes = [];
  let holdLayer = null;
  let tapLayer = null;

  if (beh === "kp" && args.length >= 1) {
    const code = canonicalZmkKey(args[0]);
    tap = code;
    displayTap = displayForKey(code);
    matchCodes.push(code);
  } else if ((beh === "mt" || beh === "ht" || behCompat.includes("hold-tap")) && args.length >= 2) {
    const holdTok = canonicalZmkKey(args[0]);
    const tapTok = canonicalZmkKey(args[1]);
    tap = tapTok;
    hold = holdTok;
    displayTap = displayForKey(tapTok);
    if (/^\d+$/.test(holdTok)) {
      holdLayer = parseInt(holdTok, 10);
      displayHold = `L${holdTok}`;
    } else {
      displayHold = displayForKey(holdTok);
      matchCodes.push(holdTok);
    }
    matchCodes.unshift(tapTok);
  } else if (beh === "lt" && args.length >= 2) {
    const layerTok = args[0];
    const tapTok = canonicalZmkKey(args[1]);
    tap = tapTok;
    displayTap = displayForKey(tapTok);
    hold = `L${layerTok}`;
    displayHold = `L${layerTok}`;
    if (/^\d+$/.test(layerTok)) holdLayer = parseInt(layerTok, 10);
    matchCodes.push(tapTok);
  } else if (["mo", "to", "tog", "sl"].includes(beh) && args.length >= 1) {
    const layerTok = args[0];
    const prefix = { mo: "MO", to: "TO", tog: "TOG", sl: "SL" }[beh];
    tap = `${prefix}(${layerTok})`;
    displayTap = `${prefix} ${layerTok}`;
    if (/^\d+$/.test(layerTok)) tapLayer = parseInt(layerTok, 10);
  } else if (beh === "sk" && args.length >= 1) {
    const code = canonicalZmkKey(args[0]);
    tap = code;
    displayTap = `*${displayForKey(code)}`;
    matchCodes.push(code);
  } else if (beh === "kt" && args.length >= 1) {
    const code = canonicalZmkKey(args[0]);
    tap = code;
    displayTap = `🔒${displayForKey(code)}`;
    matchCodes.push(code);
  } else if (beh === "trans") {
    tap = "TRANS";
    displayTap = "▽";
  } else if (beh === "none") {
    tap = "NONE";
    displayTap = "";
  } else if (beh === "caps_word") {
    tap = "CAPS_WORD";
    displayTap = "CapsWd";
  } else if (beh === "key_repeat") {
    tap = "REPEAT";
    displayTap = "Repeat";
  } else if (beh === "bt" && args.length >= 1) {
    tap = args.join(" ");
    if (args[0] === "BT_SEL" && args.length > 1) displayTap = `BT ${args[1]}`;
    else if (args[0] === "BT_CLR") displayTap = "BT Clr";
    else displayTap = args[0].replace("BT_", "BT ");
  } else if (beh === "out" && args.length >= 1) {
    tap = args[0];
    displayTap = args[0].replace("OUT_", "");
  } else if (beh === "mkp" && args.length >= 1) {
    tap = args[0];
    displayTap = args[0];
  } else if (beh === "rgb_ug" && args.length >= 1) {
    tap = args.join(" ");
    displayTap = args[0].replace("RGB_", "RGB ");
  } else if (beh === "sys_reset" || beh === "bootloader" || beh === "studio_unlock") {
    tap = beh.toUpperCase();
    displayTap = { sys_reset: "Reset", bootloader: "Boot", studio_unlock: "Studio" }[beh];
  } else {
    tap = args.length ? args.join(" ") : beh;
    displayTap = tap.length <= 8 ? tap : beh;
  }

  // Precompute normalized modified info for fast matching
  const matchDescriptors = matchCodes.map((code) => ({
    code,
    ...extractModifiedKeycode(code),
  }));

  return {
    raw,
    behavior: beh,
    tap,
    hold,
    displayTap,
    displayHold,
    matchCodes,
    matchDescriptors,
    holdLayer,
    tapLayer,
  };
}

export function parseBindingsList(bindingsInner, behaviors = {}) {
  const starts = [];
  let depth = 0;
  for (let i = 0; i < bindingsInner.length; i++) {
    const c = bindingsInner[i];
    if (c === "(") depth += 1;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "&" && depth === 0) starts.push(i);
  }

  const entries = [];
  for (let idx = 0; idx < starts.length; idx++) {
    const s = starts[idx];
    const e = idx + 1 < starts.length ? starts[idx + 1] : bindingsInner.length;
    const chunk = bindingsInner.slice(s, e).trim();
    if (chunk) entries.push(interpretBinding(chunk, behaviors));
  }
  return entries;
}

export function parseCombos(text, behaviors = {}) {
  const combos = [];
  for (const { body } of extractDtsBlocks(text, "(?:[A-Za-z0-9_]+\\s*:\\s*)?combos\\b")) {
    const nodeRe = /([A-Za-z0-9_-]+)\s*\{/g;
    let m;
    while ((m = nodeRe.exec(body)) !== null) {
      const openIdx = m.index + m[0].length - 1;
      const closeIdx = findMatchingBrace(body, openIdx);
      const sub = body.slice(openIdx + 1, closeIdx);
      const kp = sub.match(/\bkey-positions\s*=\s*<([^>]+)>/);
      const bm = sub.match(/\bbindings\s*=\s*<([\s\S]*?)>\s*;/);
      if (kp && bm) {
        const positions = kp[1]
          .trim()
          .split(/\s+/)
          .map((n) => parseInt(n, 10))
          .filter((n) => !Number.isNaN(n));
        const parsed = parseBindingsList(bm[1], behaviors);
        if (positions.length && parsed.length) {
          combos.push({
            name: m[1],
            positions,
            binding: parsed[0],
          });
        }
      }
      nodeRe.lastIndex = closeIdx + 1;
    }
  }
  return combos;
}

export function parseKeymapLayers(keymapText, files = {}, keymapPath = "") {
  const { text: expanded, macros } = preprocessDts(keymapText, files, keymapPath);
  const chosen = extractChosenRefs(expanded);
  const behaviors = parseBehaviors(expanded);
  const combos = parseCombos(expanded, behaviors);

  const keymapBlocks = extractDtsBlocks(expanded, "(?:[A-Za-z0-9_]+\\s*:\\s*)?keymap\\b");
  const searchSpace = keymapBlocks.length
    ? keymapBlocks.map((b) => b.body).join("\n")
    : expanded;

  const layers = [];
  let pos = 0;
  const nodeRe = /(?:([A-Za-z0-9_]+)\s*:\s*)?([A-Za-z0-9_-]+)\s*\{/g;
  while (pos < searchSpace.length) {
    nodeRe.lastIndex = pos;
    const m = nodeRe.exec(searchSpace);
    if (!m) break;
    const nodeName = m[2];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingBrace(searchSpace, openIdx);
    const body = searchSpace.slice(openIdx + 1, closeIdx);
    pos = closeIdx + 1;

    if (["keymap", "chosen", "behaviors", "combos", "macros"].includes(nodeName)) {
      continue;
    }

    const bm = body.match(/\bbindings\s*=\s*<([\s\S]*?)>\s*;/);
    if (!bm) continue;

    const dn = body.match(/(?:display-name|label)\s*=\s*"([^"]+)"/);
    const displayName = dn
      ? dn[1]
      : nodeName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const bindings = parseBindingsList(bm[1], behaviors);
    layers.push({
      index: layers.length,
      nodeName,
      name: displayName,
      rawBindings: bm[1],
      bindings,
    });
  }

  const includes = [...keymapText.matchAll(/#include\s+[<"]([^>"]+)[>"]/g)].map((m) => m[1]);

  return { chosen, behaviors, combos, layers, includes, macros };
}

// MARK: - Physical Layout Extractors

export function parsePhysicalLayoutsFromDts(text) {
  const cleaned = stripCommentsPreserveNewlines(text);
  const layouts = [];
  const nodeRe = /(?:([A-Za-z0-9_]+)\s*:\s*)?([A-Za-z0-9_-]+)\s*\{/g;
  let pos = 0;
  while (pos < cleaned.length) {
    nodeRe.lastIndex = pos;
    const m = nodeRe.exec(cleaned);
    if (!m) break;
    const label = m[1] || m[2];
    const nodeName = m[2];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingBrace(cleaned, openIdx);
    const body = cleaned.slice(openIdx + 1, closeIdx);

    if (body.includes('compatible = "zmk,physical-layout"') || body.includes("key_physical_attrs")) {
      const km = body.match(/\bkeys\s*=([\s\S]*?);/);
      if (km) {
        const attrRe =
          /<&key_physical_attrs\s+(\(?-?\d+\)?)\s+(\(?-?\d+\)?)\s+(\(?-?\d+\)?)\s+(\(?-?\d+\)?)\s+(\(?-?\d+\)?)\s+(\(?-?\d+\)?)\s+(\(?-?\d+\)?)\s*>/g;
        const keys = [];
        let am;
        while ((am = attrRe.exec(km[1])) !== null) {
          const toU = (s) => parseFloat(s.replace(/[()]/g, "")) / 100.0;
          keys.push({
            index: keys.length,
            w: toU(am[1]),
            h: toU(am[2]),
            x: toU(am[3]),
            y: toU(am[4]),
            r: toU(am[5]),
            rx: toU(am[6]),
            ry: toU(am[7]),
          });
        }
        if (keys.length > 0) {
          const dn = body.match(/display-name\s*=\s*"([^"]+)"/);
          layouts.push({
            id: label,
            name: dn ? dn[1] : nodeName,
            source: "zmk,physical-layout",
            keys,
          });
        }
      }
      pos = closeIdx + 1;
    } else {
      pos = m.index + m[0].length;
    }
  }
  return layouts;
}

export function parseInfoJsonLayouts(text, filename = "info.json") {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object" || !data.layouts || typeof data.layouts !== "object") {
    return [];
  }

  const results = [];
  for (const [lname, lobj] of Object.entries(data.layouts)) {
    if (!lobj || !Array.isArray(lobj.layout) || lobj.layout.length === 0) continue;
    const keys = [];
    let valid = true;
    for (let i = 0; i < lobj.layout.length; i++) {
      const item = lobj.layout[i];
      if (!item || typeof item.x !== "number" || typeof item.y !== "number") {
        valid = false;
        break;
      }
      const x = Number(item.x);
      const y = Number(item.y);
      keys.push({
        index: i,
        row: item.row !== undefined ? Number(item.row) : null,
        col: item.col !== undefined ? Number(item.col) : null,
        w: Number(item.w ?? 1),
        h: Number(item.h ?? 1),
        x,
        y,
        r: Number(item.r ?? 0),
        rx: Number(item.rx ?? x),
        ry: Number(item.ry ?? y),
      });
    }
    if (valid && keys.length) {
      results.push({
        id: lname,
        name: `${data.keyboard_name || filename} (${lname})`,
        source: "info.json",
        keys,
      });
    }
  }
  return results;
}

export function parseMatrixTransformLayouts(text) {
  const cleaned = stripCommentsPreserveNewlines(text);
  const layouts = [];
  const nodeRe = /(?:([A-Za-z0-9_]+)\s*:\s*)?([A-Za-z0-9_-]+)\s*\{/g;
  let pos = 0;
  while (pos < cleaned.length) {
    nodeRe.lastIndex = pos;
    const m = nodeRe.exec(cleaned);
    if (!m) break;
    const label = m[1] || m[2];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingBrace(cleaned, openIdx);
    const body = cleaned.slice(openIdx + 1, closeIdx);
    if (body.includes("zmk,matrix-transform")) {
      const mm = body.match(/\bmap\s*=\s*<([\s\S]*?)>\s*;/);
      if (mm) {
        const coords = [...mm[1].matchAll(/RC\(\s*(\d+)\s*,\s*(\d+)\s*\)/g)].map((rm) => [
          parseInt(rm[1], 10),
          parseInt(rm[2], 10),
        ]);
        if (coords.length > 0) {
          const maxCol = Math.max(...coords.map((c) => c[1]));
          const splitCol = maxCol >= 7 ? Math.floor((maxCol + 1) / 2) : null;
          const keys = coords.map(([r, c], i) => ({
            index: i,
            row: r,
            col: c,
            w: 1,
            h: 1,
            x: c + (splitCol !== null && c >= splitCol ? 0.8 : 0),
            y: r,
            r: 0,
            rx: 0,
            ry: 0,
          }));
          layouts.push({
            id: label,
            name: `${label} (Matrix Transform)`,
            source: "zmk,matrix-transform",
            keys,
          });
        }
      }
    }
    pos = closeIdx + 1;
  }
  return layouts;
}

export function deriveLayoutFromKeymapLines(rawBindings) {
  const lines = rawBindings.split(/\r?\n/).filter((ln) => ln.includes("&"));
  const rows = [];
  for (const ln of lines) {
    const matches = [...ln.matchAll(/&[A-Za-z0-9_]+/g)].map((m) => ({
      col: m.index,
      tok: m[0],
    }));
    if (matches.length) rows.push(matches);
  }

  if (rows.length === 0) {
    const count = (rawBindings.match(/&[A-Za-z0-9_]+/g) || []).length;
    const cols = Math.min(12, Math.max(1, count));
    const keys = Array.from({ length: count }, (_, i) => ({
      index: i,
      w: 1,
      h: 1,
      x: i % cols,
      y: Math.floor(i / cols),
      r: 0,
      rx: 0,
      ry: 0,
    }));
    return { id: "auto_grid", name: "Auto Grid", source: "keymap-grid", keys };
  }

  const maxKeysInRow = Math.max(...rows.map((r) => r.length));
  const keys = [];
  let idx = 0;

  rows.forEach((row, y) => {
    const offsetX = row.length < maxKeysInRow ? (maxKeysInRow - row.length) / 2.0 : 0.0;
    let splitIdx = null;
    if (row.length >= 4) {
      const gaps = [];
      for (let j = 0; j < row.length - 1; j++) {
        gaps.push(row[j + 1].col - row[j].col);
      }
      const sortedGaps = [...gaps].sort((a, b) => a - b);
      const medianGap = sortedGaps[Math.floor((sortedGaps.length - 1) / 2)];
      const maxGap = Math.max(...gaps);
      const maxAt = gaps.indexOf(maxGap);
      const mid = Math.floor(row.length / 2);
      if (maxGap > medianGap * 1.25 && maxAt >= mid - 2 && maxAt <= mid + 1) {
        splitIdx = maxAt + 1;
      }
    }

    row.forEach((_, j) => {
      let splitShift = splitIdx !== null && j >= splitIdx ? 0.8 : 0.0;
      if (splitIdx === null && maxKeysInRow >= 8 && row.length === maxKeysInRow && j >= row.length / 2) {
        splitShift = 0.8;
      }
      keys.push({
        index: idx++,
        w: 1,
        h: 1,
        x: offsetX + j + splitShift,
        y,
        r: 0,
        rx: 0,
        ry: 0,
      });
    });
  });

  return {
    id: "keymap_visual",
    name: "Keymap Visual Grid",
    source: "keymap-visual",
    keys,
  };
}

export function normalizeLayoutBounds(layout) {
  const keys = layout.keys || [];
  if (keys.length === 0) return { ...layout, widthU: 1, heightU: 1 };

  // Calculate visual bounding corners for each key, accounting for rotation (r, rx, ry)
  function getKeyVisualCorners(k) {
    const w = Number(k.w ?? 1);
    const h = Number(k.h ?? 1);
    const r = Number(k.r ?? 0);
    const rx = Number(k.rx ?? k.x);
    const ry = Number(k.ry ?? k.y);
    const corners = [
      { x: k.x, y: k.y },
      { x: k.x + w, y: k.y },
      { x: k.x + w, y: k.y + h },
      { x: k.x, y: k.y + h },
    ];
    if (!r || Math.abs(r) < 0.001) return corners;
    const rad = (r * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return corners.map((pt) => ({
      x: rx + (pt.x - rx) * cos - (pt.y - ry) * sin,
      y: ry + (pt.x - rx) * sin + (pt.y - ry) * cos,
    }));
  }

  let minVisualX = Infinity;
  let minVisualY = Infinity;
  let maxVisualX = -Infinity;
  let maxVisualY = -Infinity;

  for (const k of keys) {
    const corners = getKeyVisualCorners(k);
    for (const c of corners) {
      minVisualX = Math.min(minVisualX, c.x);
      minVisualY = Math.min(minVisualY, c.y);
      maxVisualX = Math.max(maxVisualX, c.x);
      maxVisualY = Math.max(maxVisualY, c.y);
    }
  }

  const padX = 0.2;
  const padY = 0.2;
  const shiftX = -minVisualX + padX;
  const shiftY = -minVisualY + padY;

  const normKeys = keys.map((k) => {
    const nx = Math.round((k.x + shiftX) * 1000) / 1000;
    const ny = Math.round((k.y + shiftY) * 1000) / 1000;
    const nrx = Math.round(((k.rx ?? k.x) + shiftX) * 1000) / 1000;
    const nry = Math.round(((k.ry ?? k.y) + shiftY) * 1000) / 1000;
    return { ...k, x: nx, y: ny, rx: nrx, ry: nry };
  });

  return {
    ...layout,
    keys: normKeys,
    widthU: Math.max(1, Math.round((maxVisualX - minVisualX + padX * 2) * 1000) / 1000),
    heightU: Math.max(1, Math.round((maxVisualY - minVisualY + padY * 2) * 1000) / 1000),
  };
}

// MARK: - build.yaml & west.yml Parsers

export function parseBuildYaml(text) {
  const targets = [];
  let cur = {};
  for (const line of text.split(/\r?\n/)) {
    let s = line.trim();
    if (!s || s.startsWith("#")) continue;
    if (s.startsWith("- ")) {
      if (Object.keys(cur).length) {
        targets.push(cur);
        cur = {};
      }
      s = s.slice(2).trim();
    }
    const m = s.match(/^(board|shield|snippet|cmake-args)\s*:\s*(.+)$/);
    if (m) {
      cur[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  if (Object.keys(cur).length) targets.push(cur);
  return targets;
}

export function extractShieldCandidates(buildTargets, keymapFilename) {
  const rawNames = [];
  for (const t of buildTargets) {
    if (t.shield) {
      for (const tok of t.shield.split(/\s+/)) {
        if (!NON_KEYBOARD_SHIELDS.has(tok)) rawNames.push(tok);
      }
    }
    if (t.board) rawNames.push(t.board);
  }
  const baseKeymap = basenamePosix(keymapFilename).replace(/\.keymap$/i, "");
  rawNames.push(baseKeymap);

  const candidates = [];
  const seen = new Set();
  const add = (name) => {
    const low = (name || "").trim().toLowerCase();
    if (low && !seen.has(low) && !NON_KEYBOARD_SHIELDS.has(low)) {
      seen.add(low);
      candidates.push(low);
    }
  };

  for (const raw0 of rawNames) {
    // Strip Zephyr HWMv2 @revision//qualifier syntax (e.g. corneish_zen_left@2.0.0//zmk)
    const raw = raw0.replace(/@.*$/, "").replace(/\/\/.*$/, "");
    add(raw);
    const stripped = raw.replace(/_(left|right|central|peripheral|dongle)$/i, "");
    add(stripped);
    if (SHIELD_ALIASES[stripped]) add(SHIELD_ALIASES[stripped]);
    for (const part of stripped.split("_")) {
      if (SHIELD_ALIASES[part]) add(SHIELD_ALIASES[part]);
    }
  }
  return candidates;
}

export function parseWestYml(text) {
  const remotes = {};
  const projects = [];
  let section = null;
  let cur = {};

  const flush = () => {
    if (!Object.keys(cur).length) return;
    if (section === "remotes" && cur.name && cur["url-base"]) {
      remotes[cur.name] = cur["url-base"];
    } else if (section === "projects") {
      projects.push(cur);
    }
    cur = {};
  };

  for (const line of text.split(/\r?\n/)) {
    let s = line.trim();
    if (!s || s.startsWith("#")) continue;
    if (s.startsWith("remotes:")) {
      flush();
      section = "remotes";
      continue;
    }
    if (s.startsWith("projects:")) {
      flush();
      section = "projects";
      continue;
    }
    if (s.startsWith("- ")) {
      flush();
      s = s.slice(2).trim();
    }
    const m = s.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
    if (m) {
      cur[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  flush();

  const repos = [];
  for (const p of projects) {
    const base = remotes[p.remote || ""] || "";
    const repoPath = p["repo-path"] || p.name || "";
    const url = p.url || (base && repoPath ? `${base.replace(/\/$/, "")}/${repoPath}` : "");
    const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
    if (m && !(m[1] === "zmkfirmware" && m[2] === "zmk")) {
      repos.push({
        owner: m[1],
        repo: m[2],
        revision: p.revision || "HEAD",
      });
    }
  }
  return repos;
}

export function pickBestLayout(candidates, targetKeyCount, preferredId = null) {
  if (!candidates || candidates.length === 0) return null;
  const exact = candidates.filter((c) => c.keys.length === targetKeyCount);
  if (preferredId) {
    const exactMatch = exact.find((c) => c.id === preferredId);
    if (exactMatch) return exactMatch;
    const anyMatch = candidates.find((c) => c.id === preferredId);
    if (anyMatch) return anyMatch;
  }
  if (exact.length > 0) return exact[0];
  return null;
}

/**
 * Assemble a complete parsed ZMK config object from an in-memory map of {path: text}.
 * Optional async hooks `fetchExternalLayouts(shieldCandidates, includes, targetKeyCount, chosenLayoutId, westRepos)`
 * can be supplied by the browser loader to fetch upstream ZMK or west.yml module layouts over CORS.
 */
export async function buildZmkConfigResult({
  files,
  repoLabel,
  preferredKeymap = null,
  fetchExternalLayouts = null,
}) {
  const includedKeymaps = new Set();
  for (const [p, txt] of Object.entries(files)) {
    if (!p.toLowerCase().endsWith(".keymap")) continue;
    for (const m of txt.matchAll(/#include\s+[<"]([^>"]+\.keymap)[>"]/gi)) {
      includedKeymaps.add(basenamePosix(m[1]).toLowerCase());
    }
  }

  const keymapFiles = Object.keys(files)
    .filter((p) => p.toLowerCase().endsWith(".keymap"))
    .sort((a, b) => {
      const aInc = includedKeymaps.has(basenamePosix(a).toLowerCase()) ? 1 : 0;
      const bInc = includedKeymaps.has(basenamePosix(b).toLowerCase()) ? 1 : 0;
      if (aInc !== bInc) return aInc - bInc;
      const aCfg = a.startsWith("config/") ? 0 : 1;
      const bCfg = b.startsWith("config/") ? 0 : 1;
      if (aCfg !== bCfg) return aCfg - bCfg;
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    });

  if (keymapFiles.length === 0) {
    throw new Error("未找到 .keymap 文件，请确认链接指向的是有效的 zmk-config 仓库或 .keymap 文件。");
  }

  const chosenKeymap =
    preferredKeymap && Object.prototype.hasOwnProperty.call(files, preferredKeymap)
      ? preferredKeymap
      : keymapFiles[0];

  const keymapData = parseKeymapLayers(files[chosenKeymap], files, chosenKeymap);
  if (!keymapData.layers || keymapData.layers.length === 0) {
    throw new Error(`无法从 ${chosenKeymap} 中解析出任何按键层 (keymap layers)。`);
  }

  const targetKeyCount = keymapData.layers[0].bindings.length;
  const chosenLayoutId = keymapData.chosen.physicalLayout || null;
  const chosenTransformId = keymapData.chosen.matrixTransform || null;

  const buildTargets = [];
  const westRepos = [];
  for (const [p, txt] of Object.entries(files)) {
    const base = basenamePosix(p);
    if (base === "build.yaml" || base === "build.yml") {
      buildTargets.push(...parseBuildYaml(txt));
    } else if (base === "west.yml") {
      westRepos.push(...parseWestYml(txt));
    }
  }

  const shieldCandidates = extractShieldCandidates(buildTargets, chosenKeymap);

  // Stage 1: Repo-local physical layouts & info.json
  const localLayouts = [];
  const localTransforms = [];
  for (const [p, txt] of Object.entries(files)) {
    const low = p.toLowerCase();
    if (low.endsWith(".dtsi") || low.endsWith(".dts") || low.endsWith(".overlay") || low.endsWith(".keymap")) {
      localLayouts.push(...parsePhysicalLayoutsFromDts(txt));
      localTransforms.push(...parseMatrixTransformLayouts(txt));
    } else if (low.endsWith(".json")) {
      localLayouts.push(...parseInfoJsonLayouts(txt, p));
    }
  }

  let resolvedLayout = pickBestLayout(localLayouts, targetKeyCount, chosenLayoutId);

  // Stage 2 & 3: External west.yml modules & upstream zmkfirmware/zmk
  if (!resolvedLayout && fetchExternalLayouts) {
    resolvedLayout = await fetchExternalLayouts({
      shieldCandidates,
      includes: keymapData.includes,
      targetKeyCount,
      chosenLayoutId,
      chosenTransformId,
      westRepos,
    });
  }

  // Stage 4: Local matrix-transform fallback
  if (!resolvedLayout) {
    resolvedLayout = pickBestLayout(localTransforms, targetKeyCount, chosenTransformId);
  }

  // Stage 5: Visual line-by-line keymap fallback
  if (!resolvedLayout) {
    resolvedLayout = deriveLayoutFromKeymapLines(keymapData.layers[0].rawBindings);
  }

  const cleanLayers = keymapData.layers.map((lyr) => ({
    index: lyr.index,
    nodeName: lyr.nodeName,
    name: lyr.name,
    bindings: lyr.bindings,
  }));

  return {
    repoLabel,
    keymapPath: chosenKeymap,
    availableKeymaps: keymapFiles,
    shields: shieldCandidates,
    keyCount: targetKeyCount,
    combos: keymapData.combos,
    layout: normalizeLayoutBounds(resolvedLayout),
    layers: cleanLayers,
  };
}
