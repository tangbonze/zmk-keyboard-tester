/**
 * ZMK Keyboard Tester - Main Application Controller & Interactive Renderer.
 */

import { loadZmkFromFileList, loadZmkFromGitHub, loadZmkFromRawText } from "./github-loader.js?v=8";
import { formatMessage } from "./i18n.js?v=8";
import { KeyboardController } from "./keyboard-lock.js?v=8";
import { SerialMatrixMonitor } from "./matrix-serial.js?v=8";
import { ZmkStudioBleClient } from "./zmk-studio-ble.js?v=8";
import { SoundBeeper } from "./sound.js?v=8";
import { displayForKey, extractModifiedKeycode } from "./zmk-keycodes.js?v=8";

const soundBeeper = new SoundBeeper();

const SAMPLE_CORNE_KEYMAP = `
#include <behaviors.dtsi>
#include <dt-bindings/zmk/keys.h>
#include <dt-bindings/zmk/bt.h>

/ {
    behaviors {
        hm: homerow_mods {
            compatible = "zmk,behavior-hold-tap";
            #binding-cells = <2>;
            tapping-term-ms = <200>;
            flavor = "tap-preferred";
            bindings = <&kp>, <&kp>;
        };
    };

    keymap {
        compatible = "zmk,keymap";

        default_layer {
            display-name = "Base";
            bindings = <
&kp TAB   &kp Q       &kp W       &kp E        &kp R         &kp T       &kp Y   &kp U         &kp I        &kp O       &kp P          &kp BSPC
&kp LCTRL &hm LGUI A  &hm LALT S  &hm LCTRL D  &hm LSHFT F   &kp G       &kp H   &hm RSHFT J   &hm RCTRL K  &hm RALT L  &hm RGUI SEMI  &kp SQT
&kp LSHFT &kp Z       &kp X       &kp C        &kp V         &kp B       &kp N   &kp M         &kp COMMA    &kp DOT     &kp FSLH       &kp ESC
                                  &kp LGUI     &mo 1         &kp SPACE   &kp RET &mo 2         &kp RALT
            >;
        };

        lower_layer {
            display-name = "Number & Nav";
            bindings = <
&kp TAB    &kp N1     &kp N2     &kp N3     &kp N4     &kp N5       &kp N6    &kp N7    &kp N8    &kp N9     &kp N0   &kp BSPC
&trans     &bt BT_SEL 0 &bt BT_SEL 1 &bt BT_SEL 2 &trans &trans     &kp LEFT  &kp DOWN  &kp UP    &kp RIGHT  &trans   &trans
&kp LSHFT  &kp F1     &kp F2     &kp F3     &kp F4     &kp F5       &kp F6    &kp F7    &kp F8    &kp F9     &kp F10  &kp F11
                                 &kp LGUI   &trans     &kp SPACE    &kp RET   &trans    &kp RALT
            >;
        };

        raise_layer {
            display-name = "Symbol & Media";
            bindings = <
&kp TAB    &kp EXCL   &kp AT     &kp HASH   &kp DLLR   &kp PRCNT    &kp CARET  &kp AMPS  &kp STAR  &kp LPAR  &kp RPAR  &kp DEL
&kp LCTRL  &kp C_MUTE &kp C_VOL_DN &kp C_VOL_UP &kp C_PP &trans     &kp MINUS  &kp EQUAL &kp LBKT  &kp RBKT  &kp BSLH  &kp GRAVE
&kp LSHFT  &trans     &trans     &trans     &trans     &trans       &kp UNDER  &kp PLUS  &kp LBRC  &kp RBRC  &kp PIPE  &kp TILDE
                                 &kp LGUI   &trans     &kp SPACE    &kp RET    &trans    &kp RALT
            >;
        };
    };
};
`;

const PRESET_CONFIGS = [
  {
    labelKey: "presetCorne",
    url: "https://github.com/zmkfirmware/zmk/blob/main/app/boards/shields/corne/corne.keymap",
  },
  {
    labelKey: "presetSofle",
    url: "https://github.com/zmkfirmware/zmk/blob/main/app/boards/shields/sofle/sofle.keymap",
  },
  {
    labelKey: "presetLily58",
    url: "https://github.com/zmkfirmware/zmk/blob/main/app/boards/shields/lily58/lily58.keymap",
  },
  {
    labelKey: "presetCradio",
    url: "https://github.com/zmkfirmware/zmk/blob/main/app/boards/shields/cradio/cradio.keymap",
  },
];

// MARK: - Application State

const appState = {
  lang: "zh",
  theme: "dark",
  isLoading: false,
  config: null,
  activeLayerIndex: 0,
  autoSwitchLayer: true,
  showTestedMarks: true,
  showKeyIndices: false,
  // Map of "layerIdx:keyIdx" -> "primary" | "hold"
  activeKeyVisuals: new Map(),
  // Map of physicalCode -> [{ layerIdx, keyIdx }] so keyup cleanly releases keys even after auto-layer switch
  heldCodeMatches: new Map(),
  testedPhysicalKeys: new Set(),
  testedLayerKeys: new Set(),
  eventLog: [],
  lastKeyEvent: null,
  lastBanner: null,
  unitPx: 54,
  selectedKeyIdx: null,
  lockStatus: {
    interceptEnabled: true,
    isTypingInInput: false,
    isFullscreenLocked: false,
    keyboardLockSupported: false,
    hidSupported: false,
  },
  hidDevices: [],
};

function t(key, params = {}) {
  return formatMessage(appState.lang, key, params);
}

// MARK: - DOM Elements

const els = {
  repoUrlInput: document.getElementById("repoUrlInput"),
  loadBtn: document.getElementById("loadBtn"),
  tokenInput: document.getElementById("tokenInput"),
  advancedToggleBtn: document.getElementById("advancedToggleBtn"),
  advancedPanel: document.getElementById("advancedPanel"),
  folderInput: document.getElementById("folderInput"),
  fileInput: document.getElementById("fileInput"),
  rawModal: document.getElementById("rawModal"),
  openRawModalBtn: document.getElementById("openRawModalBtn"),
  closeRawModalBtn: document.getElementById("closeRawModalBtn"),
  rawKeymapText: document.getElementById("rawKeymapText"),
  loadRawBtn: document.getElementById("loadRawBtn"),
  loadDemoBtn: document.getElementById("loadDemoBtn"),
  presetBar: document.getElementById("presetBar"),
  branchSelect: document.getElementById("branchSelect"),
  branchSelectWrap: document.getElementById("branchSelectWrap"),
  keymapSelect: document.getElementById("keymapSelect"),
  keymapSelectWrap: document.getElementById("keymapSelectWrap"),
  statusBanner: document.getElementById("statusBanner"),
  interceptToggle: document.getElementById("interceptToggle"),
  fullscreenLockBtn: document.getElementById("fullscreenLockBtn"),
  lockBadge: document.getElementById("lockBadge"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  langToggleBtn: document.getElementById("langToggleBtn"),
  connectBleBtn: document.getElementById("connectBleBtn"),
  bleBadge: document.getElementById("bleBadge"),
  connectSerialBtn: document.getElementById("connectSerialBtn"),
  serialBadge: document.getElementById("serialBadge"),
  devicesList: document.getElementById("devicesList"),
  metaRepo: document.getElementById("metaRepo"),
  metaLayout: document.getElementById("metaLayout"),
  metaCoverage: document.getElementById("metaCoverage"),
  resetTestedBtn: document.getElementById("resetTestedBtn"),
  soundToggle: document.getElementById("soundToggle"),
  showIndicesToggle: document.getElementById("showIndicesToggle"),
  keyboardStage: document.getElementById("keyboardStage"),
  keyboardCanvas: document.getElementById("keyboardCanvas"),
  activeModsBar: document.getElementById("activeModsBar"),
  lockHint: document.getElementById("lockHint"),
  inspectorCard: document.getElementById("inspectorCard"),
  eventLogList: document.getElementById("eventLogList"),
  clearLogBtn: document.getElementById("clearLogBtn"),
};

// MARK: - Key Matching Logic

function resolveEffectiveBinding(layerIdx, keyIdx) {
  const layers = appState.config?.layers || [];
  let cur = layers[layerIdx]?.bindings?.[keyIdx];
  if (!cur) return null;
  if (cur.behavior === "trans" && layerIdx !== 0) {
    const base = layers[0]?.bindings?.[keyIdx];
    if (base) return { ...base, inheritedFromBase: true };
  }
  return cur;
}

function findMatchesInLayer(ev, layerIdx) {
  const layer = appState.config?.layers?.[layerIdx];
  if (!layer) return [];

  const exactModified = [];
  const primaryMatches = [];
  const holdMatches = [];

  const activeMods = new Set(ev.modifiers || []);
  if (ev.shiftKey) activeMods.add("LSHFT");
  if (ev.ctrlKey) activeMods.add("LCTRL");
  if (ev.altKey) activeMods.add("LALT");
  if (ev.metaKey) activeMods.add("LGUI");

  const modEquivalent = (expectedMod) => {
    if (activeMods.has(expectedMod)) return true;
    if (expectedMod === "LSHFT" && activeMods.has("RSHFT")) return true;
    if (expectedMod === "RSHFT" && activeMods.has("LSHFT")) return true;
    if (expectedMod === "LCTRL" && activeMods.has("RCTRL")) return true;
    if (expectedMod === "RCTRL" && activeMods.has("LCTRL")) return true;
    if (expectedMod === "LALT" && activeMods.has("RALT")) return true;
    if (expectedMod === "RALT" && activeMods.has("LALT")) return true;
    if (expectedMod === "LGUI" && activeMods.has("RGUI")) return true;
    if (expectedMod === "RGUI" && activeMods.has("LGUI")) return true;
    return false;
  };

  for (let i = 0; i < layer.bindings.length; i++) {
    const b = resolveEffectiveBinding(layerIdx, i);
    if (!b || !b.matchDescriptors) continue;

    // 1. Check modified keycodes like EXCL (Shift + N1) or LC(C) (Ctrl + C)
    let matchedModified = false;
    for (const desc of b.matchDescriptors) {
      if (desc.mods && desc.mods.length > 0 && desc.base === ev.zmk) {
        if (desc.mods.every(modEquivalent)) {
          exactModified.push({ layerIdx, keyIdx: i, kind: "primary", binding: b });
          matchedModified = true;
          break;
        }
      }
    }
    if (matchedModified) continue;

    // 2. Direct tap match
    if (b.tap) {
      const tapInfo = extractModifiedKeycode(b.tap);
      if (tapInfo.mods.length === 0 && tapInfo.base === ev.zmk) {
        primaryMatches.push({ layerIdx, keyIdx: i, kind: "primary", binding: b });
        continue;
      }
    }

    // 3. Hold match (for &mt, &hm, etc.)
    if (b.hold && b.holdLayer === null) {
      const holdInfo = extractModifiedKeycode(b.hold);
      if (holdInfo.mods.length === 0 && holdInfo.base === ev.zmk) {
        holdMatches.push({ layerIdx, keyIdx: i, kind: "hold", binding: b });
      }
    }
  }

  if (exactModified.length > 0) return exactModified;
  if (primaryMatches.length > 0) return primaryMatches;
  return holdMatches;
}

function handleKeyEvent(ev) {
  if (!appState.config) return;

  const codeKey = ev.code || ev.zmk;

  if (ev.action === "down") {
    let matches = [];
    const totalLayers = appState.config.layers.length;
    for (let l = 0; l < totalLayers; l++) {
      const found = findMatchesInLayer(ev, l);
      if (found.length > 0) {
        matches = found;
        break;
      }
    }

    const prevTestedCount = appState.testedPhysicalKeys.size;

    // Track matches for this physical code so keyUp cleans up cleanly
    appState.heldCodeMatches.set(codeKey, matches);

    for (const m of matches) {
      appState.activeKeyVisuals.set(m.keyIdx, m.kind);
      appState.testedPhysicalKeys.add(m.keyIdx);
      appState.testedLayerKeys.add(`${m.layerIdx}:${m.keyIdx}`);
    }

    if (!ev.isRepeat) {
      const justFinishedAll =
        appState.config.keyCount > 0 &&
        prevTestedCount < appState.config.keyCount &&
        appState.testedPhysicalKeys.size === appState.config.keyCount;
      if (justFinishedAll) {
        soundBeeper.beepCompleted();
      } else {
        soundBeeper.beepKey({ matched: matches.length > 0 });
      }
      pushEventLog(ev, matches);
    }
    appState.lastKeyEvent = { ...ev, matched: matches.length > 0 };
    updateKeyVisualStates();
    updateCoverageMeta();
    renderActiveModifiers(ev.modifiers || []);
    if (matches.length > 0) {
      appState.selectedKeyIdx = matches[0].keyIdx;
      renderInspector(matches[0].keyIdx, appState.lastKeyEvent);
    } else {
      renderInspector(appState.selectedKeyIdx, appState.lastKeyEvent);
    }
  } else if (ev.action === "up") {
    const prevMatches = appState.heldCodeMatches.get(codeKey) || [];
    appState.heldCodeMatches.delete(codeKey);
    for (const m of prevMatches) {
      appState.activeKeyVisuals.delete(m.keyIdx);
    }
    // Sweep any active physical key whose binding across layers matches ev.zmk
    for (const keyIdx of Array.from(appState.activeKeyVisuals.keys())) {
      const layers = appState.config.layers || [];
      let matched = false;
      for (let l = 0; l < layers.length; l++) {
        const b = resolveEffectiveBinding(l, keyIdx);
        if (b && (b.tap === ev.zmk || b.hold === ev.zmk)) {
          matched = true;
          break;
        }
      }
      if (matched) appState.activeKeyVisuals.delete(keyIdx);
    }
    updateKeyVisualStates();
    renderActiveModifiers(ev.modifiers || []);
  }
}

// MARK: - Rendering

function computeUnitSize() {
  if (!appState.config) return;
  const stageRect = els.keyboardStage.getBoundingClientRect();
  const availW = Math.max(320, stageRect.width - 48);
  const availH = Math.max(220, stageRect.height - 48);
  const { widthU, heightU } = appState.config.layout;
  const byW = availW / Math.max(1, widthU);
  const byH = availH / Math.max(1, heightU);
  appState.unitPx = Math.max(32, Math.min(72, Math.floor(Math.min(byW, byH))));
}

function renderKeyboard() {
  const cfg = appState.config;
  if (!cfg) return;

  computeUnitSize();
  const u = appState.unitPx;
  const gap = Math.max(4, Math.round(u * 0.08));
  const { keys, widthU, heightU } = cfg.layout;

  els.keyboardCanvas.innerHTML = "";
  els.keyboardCanvas.style.width = `${Math.round(widthU * u)}px`;
  els.keyboardCanvas.style.height = `${Math.round(heightU * u)}px`;

  keys.forEach((k, idx) => {
    const keyEl = document.createElement("button");
    keyEl.type = "button";
    keyEl.className = "keycap";
    keyEl.dataset.keyIdx = String(idx);
    if (appState.selectedKeyIdx === idx) keyEl.classList.add("is-selected");

    const wPx = Math.max(20, Math.round(k.w * u - gap));
    const hPx = Math.max(20, Math.round(k.h * u - gap));
    const xPx = k.x * u;
    const yPx = k.y * u;

    keyEl.style.left = `${xPx}px`;
    keyEl.style.top = `${yPx}px`;
    keyEl.style.width = `${wPx}px`;
    keyEl.style.height = `${hPx}px`;

    if (k.r && Math.abs(k.r) > 0.01) {
      const ox = (k.rx - k.x) * u;
      const oy = (k.ry - k.y) * u;
      keyEl.style.transformOrigin = `${ox}px ${oy}px`;
      keyEl.style.transform = `rotate(${k.r}deg)`;
    }

    // Optional physical key index badge
    const idxEl = document.createElement("span");
    idxEl.className = "keycap-idx";
    idxEl.textContent = String(idx);
    if (!appState.showKeyIndices) idxEl.classList.add("hidden");
    keyEl.appendChild(idxEl);

    // Tested check dot
    const dotEl = document.createElement("span");
    dotEl.className = "keycap-tested-dot";
    keyEl.appendChild(dotEl);

    keyEl.title = `#${idx}`;
    keyEl.addEventListener("click", () => {
      appState.selectedKeyIdx = idx;
      renderInspector(idx, appState.lastKeyEvent);
      updateKeyVisualStates();
      // Keep focus off button so Space/Enter stay intercepted
      keyEl.blur();
    });

    els.keyboardCanvas.appendChild(keyEl);
  });

  updateKeyVisualStates();
}

function updateKeyVisualStates() {
  const keyEls = els.keyboardCanvas.querySelectorAll(".keycap");
  for (const el of keyEls) {
    const idx = Number(el.dataset.keyIdx);
    const visualKind = appState.activeKeyVisuals.get(idx);
    el.classList.toggle("is-active", visualKind === "primary");
    el.classList.toggle("is-hold-active", visualKind === "hold");
    el.classList.toggle(
      "is-tested",
      appState.showTestedMarks && appState.testedPhysicalKeys.has(idx)
    );
    el.classList.toggle("is-selected", appState.selectedKeyIdx === idx);
  }
}

function updateCoverageMeta() {
  if (!appState.config) {
    els.metaCoverage.textContent = t("metaCoverage", { tested: 0, total: 0, pct: 0 });
    return;
  }
  const total = appState.config.keyCount;
  const tested = appState.testedPhysicalKeys.size;
  const pct = total > 0 ? Math.round((tested / total) * 100) : 0;
  els.metaCoverage.textContent = t("metaCoverage", { tested, total, pct });
}

function renderActiveModifiers(mods) {
  if (!mods || mods.length === 0) {
    els.activeModsBar.innerHTML = `<span class="muted">${escapeHtml(t("modsEmpty"))}</span>`;
    return;
  }
  els.activeModsBar.innerHTML = mods
    .map((m) => `<span class="mod-pill">${escapeHtml(displayForKey(m))} (${escapeHtml(m)})</span>`)
    .join("");
}

function renderInspector(keyIdx, lastEvent) {
  const interceptedBadge = lastEvent
    ? `<span class="tag ${lastEvent.intercepted ? "tag-ok" : "tag-warn"}">${escapeHtml(
        lastEvent.intercepted ? t("inspInterceptedYes") : t("inspInterceptedNo")
      )}</span>`
    : `<span class="muted">—</span>`;

  const matchBadge = lastEvent
    ? `<span class="tag ${lastEvent.matched ? "tag-ok" : "tag-warn"}">${escapeHtml(
        lastEvent.matched ? t("inspMatchedYes") : t("inspMatchedNo")
      )}</span>`
    : `<span class="muted">—</span>`;

  const rows = [
    `<div class="insp-row"><span>${escapeHtml(t("inspLastKey"))}</span><strong>${escapeHtml(
      lastEvent?.zmk || "—"
    )}</strong></div>`,
    `<div class="insp-row"><span>${escapeHtml(t("inspBrowserCode"))}</span><code>${escapeHtml(
      lastEvent?.code || "—"
    )}</code></div>`,
    `<div class="insp-row"><span>${escapeHtml(t("inspInterception"))}</span>${interceptedBadge}</div>`,
    `<hr class="insp-sep"/>`,
    `<div class="insp-row"><span>${escapeHtml(t("inspPosition"))}</span><strong>${
      keyIdx !== null && keyIdx !== undefined ? `#${keyIdx}` : "—"
    }</strong></div>`,
    `<div class="insp-row"><span>${escapeHtml(t("inspMatched"))}</span>${matchBadge}</div>`,
  ];

  els.inspectorCard.innerHTML = rows.join("");
}

function renderEventLog() {
  if (appState.eventLog.length === 0) {
    els.eventLogList.innerHTML = `<div class="muted">${escapeHtml(t("eventLogEmpty"))}</div>`;
    return;
  }
  els.eventLogList.innerHTML = appState.eventLog
    .map(
      (item) => `
      <div class="log-item ${item.matched ? "is-matched" : ""}">
        <span class="log-time">${item.ts}</span>
        <span class="log-key">${escapeHtml(item.zmk)}</span>
        <span class="log-match">${escapeHtml(item.matchStr || t("unmatchedKey"))}</span>
      </div>`
    )
    .join("");
}

function pushEventLog(ev, matches) {
  const matchStr =
    matches.length > 0
      ? matches.map((m) => `#${m.keyIdx}`).join(", ")
      : "";

  appState.eventLog.unshift({
    ts: new Date().toLocaleTimeString(appState.lang === "zh" ? "zh-CN" : "en-US", { hour12: false }),
    zmk: ev.zmk,
    code: ev.code,
    matchStr,
    matched: matches.length > 0,
    intercepted: ev.intercepted,
  });
  if (appState.eventLog.length > 40) appState.eventLog.length = 40;
  renderEventLog();
}

function renderLockStatus(status) {
  appState.lockStatus = status;
  els.interceptToggle.checked = status.interceptEnabled;

  if (!status.interceptEnabled) {
    els.lockBadge.className = "lock-badge is-off";
    els.lockBadge.textContent = t("lockBadgeOff");
  } else if (status.isTypingInInput) {
    els.lockBadge.className = "lock-badge is-paused";
    els.lockBadge.textContent = t("lockBadgePaused");
  } else if (status.isFullscreenLocked) {
    els.lockBadge.className = "lock-badge is-locked";
    els.lockBadge.textContent = t("lockBadgeLocked");
  } else {
    els.lockBadge.className = "lock-badge is-active";
    els.lockBadge.textContent = t("lockBadgeActive");
  }

  els.fullscreenLockBtn.textContent = status.isFullscreenLocked
    ? t("btnFullscreenExit")
    : status.keyboardLockSupported
      ? t("btnFullscreenEnter")
      : t("btnFullscreenMode");
}

function renderDevices(devices) {
  appState.hidDevices = devices;
  if (!devices || devices.length === 0) {
    els.devicesList.innerHTML = `<span class="device-pill is-muted">${escapeHtml(t("devicesEmptyHint"))}</span>`;
    return;
  }
  els.devicesList.innerHTML = devices
    .map(
      (d) =>
        `<span class="device-pill is-connected" title="VID: ${d.vendorId} PID: ${d.productId}">⌨️ ${escapeHtml(
          d.name
        )}</span>`
    )
    .join("");
}

function setBanner(msgOrKey, type = "info", params = null) {
  if (!msgOrKey) {
    appState.lastBanner = null;
    els.statusBanner.classList.add("hidden");
    return;
  }
  appState.lastBanner = { msgOrKey, type, params };
  els.statusBanner.className = `status-banner is-${type}`;
  els.statusBanner.textContent = params !== null ? t(msgOrKey, params) : msgOrKey;
}

function renderPresets() {
  els.presetBar.innerHTML = "";
  PRESET_CONFIGS.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-chip";
    btn.textContent = t(p.labelKey);
    btn.addEventListener("click", () => {
      els.repoUrlInput.value = p.url;
      loadFromUrlInput();
      btn.blur();
    });
    els.presetBar.appendChild(btn);
  });
}

function applyTheme(theme) {
  appState.theme = theme === "light" ? "light" : "dark";
  if (appState.theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  els.themeToggleBtn.textContent =
    appState.theme === "light" ? t("themeToDark") : t("themeToLight");
  els.themeToggleBtn.title = t("themeTitle");
  try {
    localStorage.setItem("zmk_tester_theme", appState.theme);
  } catch {
    // ignore
  }
}

function applyLanguage(lang) {
  appState.lang = lang === "en" ? "en" : "zh";
  document.documentElement.lang = appState.lang === "zh" ? "zh-CN" : "en";
  document.title = t("pageTitle");

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });

  els.lockHint.innerHTML = t("lockHintHtml");
  els.langToggleBtn.textContent = t("langToggleText");
  els.langToggleBtn.title = t("langTitle");
  els.themeToggleBtn.textContent =
    appState.theme === "light" ? t("themeToDark") : t("themeToLight");
  els.themeToggleBtn.title = t("themeTitle");
  els.loadBtn.textContent = appState.isLoading ? t("loadingBtn") : t("loadBtn");

  if (typeof studioBleClient !== "undefined" && studioBleClient) {
    if (!studioBleClient.bleSupported) {
      els.connectBleBtn.title = t("studioBleUnsupported");
    } else {
      els.connectBleBtn.title = "";
    }
    if (studioBleClient.isConnected) {
      els.connectBleBtn.textContent = t("disconnectStudioBleBtn");
      els.bleBadge.textContent = t("studioBleConnectedBadge");
    } else {
      els.connectBleBtn.textContent = t("connectStudioBleBtn");
    }
  }

  if (typeof serialMonitor !== "undefined" && serialMonitor) {
    if (!serialMonitor.serialSupported) {
      els.connectSerialBtn.title = t("serialUnsupported");
    } else {
      els.connectSerialBtn.title = "";
    }
    if (serialMonitor.isConnected) {
      els.connectSerialBtn.textContent = t("disconnectSerialBtn");
      els.serialBadge.textContent = t("serialConnectedBadge");
    } else {
      els.connectSerialBtn.textContent = t("connectSerialBtn");
    }
  }

  renderPresets();
  renderDevices(appState.hidDevices);
  renderLockStatus(appState.lockStatus);
  renderActiveModifiers(keyboardCtrl ? Array.from(keyboardCtrl.activeModifiers) : []);
  renderInspector(appState.selectedKeyIdx, appState.lastKeyEvent);
  renderEventLog();
  updateCoverageMeta();

  if (appState.config) {
    const cfg = appState.config;
    const repoLabel = cfg.isDemo ? t("demoRepoLabel") : cfg.repoLabel;
    els.metaRepo.textContent = `${repoLabel} · ${cfg.keymapPath}`;
    els.metaLayout.textContent = t("metaLayoutPrefix", {
      name: cfg.layout.name,
      source: cfg.layout.source,
    });
    renderKeyboard();
  }

  if (appState.lastBanner && appState.lastBanner.params !== null) {
    setBanner(appState.lastBanner.msgOrKey, appState.lastBanner.type, appState.lastBanner.params);
  }

  try {
    localStorage.setItem("zmk_tester_lang", appState.lang);
  } catch {
    // ignore
  }
}

function applyLoadedConfig(cfg, sourceUrl = null) {
  appState.config = cfg;
  appState.activeLayerIndex = 0;
  appState.activeKeyVisuals.clear();
  appState.heldCodeMatches.clear();
  appState.testedPhysicalKeys.clear();
  appState.testedLayerKeys.clear();
  appState.selectedKeyIdx = null;

  const repoLabel = cfg.isDemo ? t("demoRepoLabel") : cfg.repoLabel;
  const branchTag = cfg.currentBranch ? ` (${cfg.currentBranch})` : "";
  els.metaRepo.textContent = `${repoLabel}${branchTag} · ${cfg.keymapPath}`;
  els.metaLayout.textContent = t("metaLayoutPrefix", {
    name: cfg.layout.name,
    source: cfg.layout.source,
  });
  updateCoverageMeta();

  // Populate branch selector if multiple branches exist in repo
  if (cfg.branches && cfg.branches.length > 1) {
    els.branchSelectWrap.classList.remove("hidden");
    els.branchSelect.innerHTML = cfg.branches
      .map(
        (b) =>
          `<option value="${escapeHtml(b)}"${b === cfg.currentBranch ? " selected" : ""}>${escapeHtml(
            b
          )}${b === cfg.defaultBranch ? " (default)" : ""}</option>`
      )
      .join("");
  } else {
    els.branchSelectWrap.classList.add("hidden");
  }

  // Populate keymap selector if multiple .keymap files exist in repo
  if (cfg.availableKeymaps && cfg.availableKeymaps.length > 1) {
    els.keymapSelectWrap.classList.remove("hidden");
    els.keymapSelect.innerHTML = cfg.availableKeymaps
      .map(
        (kp) =>
          `<option value="${escapeHtml(kp)}"${kp === cfg.keymapPath ? " selected" : ""}>${escapeHtml(
            kp
          )}</option>`
      )
      .join("");
  } else {
    els.keymapSelectWrap.classList.add("hidden");
  }

  renderKeyboard();
  renderInspector(null, appState.lastKeyEvent);

  if (sourceUrl) {
    try {
      localStorage.setItem("zmk_tester_last_url", sourceUrl);
    } catch {
      // ignore storage errors
    }
  }
  setBanner("bannerLoaded", "success", {
    repo: `${repoLabel}${branchTag}`,
    count: cfg.keyCount,
    layers: cfg.layers.length,
  });
}

// MARK: - Loading Handlers

async function loadFromUrlInput(preferredKeymap = null, preferredBranch = null) {
  const url = els.repoUrlInput.value.trim();
  if (!url) {
    setBanner("bannerNeedUrl", "warn", {});
    return;
  }
  const token = els.tokenInput.value.trim() || null;
  appState.isLoading = true;
  els.loadBtn.disabled = true;
  els.loadBtn.textContent = t("loadingBtn");

  if (preferredBranch) {
    setBanner("bannerBranchSwitching", "info", { branch: preferredBranch });
  } else {
    setBanner("bannerLoading", "info", { url });
  }

  try {
    const cfg = await loadZmkFromGitHub(url, { token, preferredKeymap, preferredBranch });
    let effectiveUrl = url;
    if (cfg.owner && cfg.repo && cfg.currentBranch) {
      effectiveUrl = `https://github.com/${cfg.owner}/${cfg.repo}/tree/${cfg.currentBranch}`;
      els.repoUrlInput.value = effectiveUrl;
      try {
        const u = new URL(window.location.href);
        u.searchParams.set("config", effectiveUrl);
        window.history.replaceState({}, "", u.toString());
      } catch {
        // ignore history errors
      }
    }
    applyLoadedConfig(cfg, effectiveUrl);
    els.repoUrlInput.blur();
  } catch (err) {
    setBanner("bannerLoadError", "error", { msg: err.message });
  } finally {
    appState.isLoading = false;
    els.loadBtn.disabled = false;
    els.loadBtn.textContent = t("loadBtn");
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// MARK: - Bootstrap & Event Wiring

function handleSerialStatusChange(status) {
  if (status.isConnected) {
    els.serialBadge.classList.remove("hidden");
    els.serialBadge.textContent = t("serialConnectedBadge");
    els.connectSerialBtn.textContent = t("disconnectSerialBtn");
    setBanner("serialConnectedMsg", "success");
  } else {
    els.serialBadge.classList.add("hidden");
    els.connectSerialBtn.textContent = t("connectSerialBtn");
  }
}

function handleSerialMatrixEvent(ev) {
  if (!appState.config?.layout?.keys) return;

  const keys = appState.config.layout.keys;
  let targetIdx = -1;

  // 1. Direct match by ZMK kscan physical position index if present
  if (ev.position !== null && ev.position !== undefined && ev.position >= 0 && ev.position < keys.length) {
    targetIdx = ev.position;
  } else {
    // 2. Match by row & col
    targetIdx = keys.findIndex((k) => k.row === ev.row && k.col === ev.col);
  }

  const isMatched = targetIdx >= 0;
  const eventLabel = `[R${ev.row}C${ev.col}]`;

  if (ev.pressed) {
    if (isMatched) {
      appState.activeKeyVisuals.set(targetIdx, "primary");
      appState.testedPhysicalKeys.add(targetIdx);
      appState.selectedKeyIdx = targetIdx;
      soundBeeper.beepKey({ matched: true });
    } else {
      soundBeeper.beepKey({ matched: false });
    }

    appState.lastKeyEvent = {
      action: "down",
      zmk: eventLabel,
      code: `Row:${ev.row} Col:${ev.col}`,
      matched: isMatched,
      intercepted: true,
      source: "serial-matrix",
    };

    pushEventLog(
      {
        zmk: `${t("serialLogTag")} ${eventLabel}`,
        code: `Row:${ev.row} Col:${ev.col}`,
        intercepted: true,
      },
      isMatched ? [{ keyIdx: targetIdx }] : []
    );

    updateKeyVisualStates();
    updateCoverageMeta();
    renderInspector(isMatched ? targetIdx : appState.selectedKeyIdx, appState.lastKeyEvent);
  } else {
    if (isMatched) {
      appState.activeKeyVisuals.delete(targetIdx);
      updateKeyVisualStates();
    }
  }
}

function handleStudioBleStatusChange(status) {
  if (status.isConnected) {
    els.bleBadge.classList.remove("hidden");
    els.bleBadge.textContent = t("studioBleConnectedBadge");
    els.connectBleBtn.textContent = t("disconnectStudioBleBtn");
    setBanner("studioBleConnectedMsg", "success", { name: status.deviceName });
  } else {
    els.bleBadge.classList.add("hidden");
    els.connectBleBtn.textContent = t("connectStudioBleBtn");
  }
}

const studioBleClient = new ZmkStudioBleClient({
  onStatusChange: handleStudioBleStatusChange,
  onFrameReceived: (frame) => {
    console.log("ZMK Studio BLE frame received, bytes:", frame.length);
  },
});

const serialMonitor = new SerialMatrixMonitor({
  onMatrixEvent: handleSerialMatrixEvent,
  onStatusChange: handleSerialStatusChange,
});

const keyboardCtrl = new KeyboardController({
  onKeyEvent: handleKeyEvent,
  onStatusChange: renderLockStatus,
  onDevicesChange: renderDevices,
});

function init() {
  // Restore theme & language preferences
  let initTheme = "dark";
  let initLang = (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  try {
    const savedTheme = localStorage.getItem("zmk_tester_theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      initTheme = savedTheme;
    } else if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
      initTheme = "light";
    }
    const savedLang = localStorage.getItem("zmk_tester_lang");
    if (savedLang === "zh" || savedLang === "en") {
      initLang = savedLang;
    }
  } catch {
    // ignore storage errors
  }

  applyTheme(initTheme);
  applyLanguage(initLang);

  // Top-right theme & language toggles
  els.themeToggleBtn.addEventListener("click", () => {
    applyTheme(appState.theme === "dark" ? "light" : "dark");
    els.themeToggleBtn.blur();
  });

  els.langToggleBtn.addEventListener("click", () => {
    applyLanguage(appState.lang === "zh" ? "en" : "zh");
    els.langToggleBtn.blur();
  });

  // Load button & Enter in URL input
  els.loadBtn.addEventListener("click", () => loadFromUrlInput());
  els.repoUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadFromUrlInput();
    }
  });
  els.repoUrlInput.addEventListener("focus", () => renderLockStatus({ ...appState.lockStatus, isTypingInInput: true }));
  els.repoUrlInput.addEventListener("blur", () => renderLockStatus({ ...appState.lockStatus, isTypingInInput: keyboardCtrl.isTypingInInput() }));
  els.tokenInput.addEventListener("focus", () => renderLockStatus({ ...appState.lockStatus, isTypingInInput: true }));
  els.tokenInput.addEventListener("blur", () => renderLockStatus({ ...appState.lockStatus, isTypingInInput: keyboardCtrl.isTypingInInput() }));

  // Branch switcher
  els.branchSelect.addEventListener("change", () => {
    loadFromUrlInput(null, els.branchSelect.value);
    els.branchSelect.blur();
  });

  // Keymap switcher for multi-keymap repos
  els.keymapSelect.addEventListener("change", () => {
    const activeBranch = els.branchSelectWrap.classList.contains("hidden")
      ? null
      : els.branchSelect.value || null;
    loadFromUrlInput(els.keymapSelect.value, activeBranch);
    els.keymapSelect.blur();
  });

  // Advanced panel toggle
  els.advancedToggleBtn.addEventListener("click", () => {
    els.advancedPanel.classList.toggle("hidden");
    els.advancedToggleBtn.blur();
  });

  // Local folder / file upload
  els.folderInput.addEventListener("change", async () => {
    if (!els.folderInput.files?.length) return;
    try {
      const cfg = await loadZmkFromFileList(els.folderInput.files);
      applyLoadedConfig(cfg);
    } catch (err) {
      setBanner("bannerLocalError", "error", { msg: err.message });
    }
  });

  els.fileInput.addEventListener("change", async () => {
    if (!els.fileInput.files?.length) return;
    try {
      const cfg = await loadZmkFromFileList(els.fileInput.files);
      applyLoadedConfig(cfg);
    } catch (err) {
      setBanner("bannerFileError", "error", { msg: err.message });
    }
  });

  // Paste raw .keymap modal
  els.openRawModalBtn.addEventListener("click", () => {
    els.rawModal.classList.remove("hidden");
    els.rawKeymapText.focus();
  });
  els.closeRawModalBtn.addEventListener("click", () => {
    els.rawModal.classList.add("hidden");
  });
  els.loadRawBtn.addEventListener("click", async () => {
    const txt = els.rawKeymapText.value.trim();
    if (!txt) return;
    try {
      const cfg = await loadZmkFromRawText(txt);
      els.rawModal.classList.add("hidden");
      applyLoadedConfig(cfg);
    } catch (err) {
      setBanner("bannerParseError", "error", { msg: err.message });
    }
  });

  // Demo config button
  els.loadDemoBtn.addEventListener("click", async () => {
    const cfg = await loadZmkFromRawText(SAMPLE_CORNE_KEYMAP, "corne.keymap");
    cfg.isDemo = true;
    applyLoadedConfig(cfg);
    els.loadDemoBtn.blur();
  });

  // Interception controls
  els.interceptToggle.addEventListener("change", () => {
    keyboardCtrl.setInterceptEnabled(els.interceptToggle.checked);
    els.interceptToggle.blur();
  });

  els.fullscreenLockBtn.addEventListener("click", () => {
    if (appState.lockStatus.isFullscreenLocked || document.fullscreenElement) {
      keyboardCtrl.exitFullscreenLock();
    } else {
      keyboardCtrl.enterFullscreenLock();
    }
    els.fullscreenLockBtn.blur();
  });

  // ZMK Studio Web Bluetooth button
  els.connectBleBtn.addEventListener("click", async () => {
    try {
      await studioBleClient.toggle();
    } catch (err) {
      if (err.name !== "NotFoundError") {
        setBanner(err.message, "warn");
      }
    }
    els.connectBleBtn.blur();
  });

  // WebSerial direct physical matrix button
  els.connectSerialBtn.addEventListener("click", async () => {
    try {
      await serialMonitor.toggle();
    } catch (err) {
      if (err.name !== "NotFoundError") {
        setBanner(err.message, "warn");
      }
    }
    els.connectSerialBtn.blur();
  });

  // Stage options
  try {
    const savedSound = localStorage.getItem("zmk_tester_sound");
    if (savedSound !== null) {
      const on = savedSound !== "false";
      els.soundToggle.checked = on;
      soundBeeper.enabled = on;
    }
  } catch {
    // ignore storage errors
  }

  els.soundToggle.addEventListener("change", () => {
    soundBeeper.enabled = els.soundToggle.checked;
    try {
      localStorage.setItem("zmk_tester_sound", String(soundBeeper.enabled));
    } catch {
      // ignore
    }
    if (soundBeeper.enabled) {
      soundBeeper.beepKey({ matched: true });
    }
    els.soundToggle.blur();
  });

  els.showIndicesToggle.addEventListener("change", () => {
    appState.showKeyIndices = els.showIndicesToggle.checked;
    renderKeyboard();
    els.showIndicesToggle.blur();
  });

  els.resetTestedBtn.addEventListener("click", () => {
    appState.testedPhysicalKeys.clear();
    appState.testedLayerKeys.clear();
    updateKeyVisualStates();
    updateCoverageMeta();
    els.resetTestedBtn.blur();
  });

  els.clearLogBtn.addEventListener("click", () => {
    appState.eventLog = [];
    renderEventLog();
    els.clearLogBtn.blur();
  });

  // Drag & drop .keymap support anywhere on stage
  els.keyboardStage.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.keyboardStage.classList.add("is-dragover");
  });
  els.keyboardStage.addEventListener("dragleave", () => {
    els.keyboardStage.classList.remove("is-dragover");
  });
  els.keyboardStage.addEventListener("drop", async (e) => {
    e.preventDefault();
    els.keyboardStage.classList.remove("is-dragover");
    if (e.dataTransfer?.files?.length) {
      try {
        const cfg = await loadZmkFromFileList(e.dataTransfer.files);
        applyLoadedConfig(cfg);
      } catch (err) {
        setBanner("bannerDropError", "error", { msg: err.message });
      }
    }
  });

  // Responsive resize: only re-render when unitPx actually changes
  const ro = new ResizeObserver(() => {
    if (!appState.config) return;
    const prevU = appState.unitPx;
    computeUnitSize();
    if (appState.unitPx !== prevU) {
      renderKeyboard();
    }
  });
  ro.observe(els.keyboardStage);

  keyboardCtrl.start();
  renderDevices([]);

  // Check URL ?config=... query parameter for shareable GitHub Pages links!
  const params = new URLSearchParams(window.location.search);
  const queryConfig = params.get("config");
  const savedUrl = (() => {
    try {
      return localStorage.getItem("zmk_tester_last_url");
    } catch {
      return null;
    }
  })();

  if (queryConfig) {
    els.repoUrlInput.value = queryConfig;
    loadFromUrlInput();
  } else {
    if (savedUrl) {
      els.repoUrlInput.value = savedUrl;
    }
    loadZmkFromRawText(SAMPLE_CORNE_KEYMAP, "corne.keymap").then((cfg) => {
      cfg.isDemo = true;
      applyLoadedConfig(cfg);
    });
  }
}

init();
