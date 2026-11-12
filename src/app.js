/**
 * ZMK Keyboard Tester - Main Application Controller & Interactive Renderer.
 */

import { loadZmkFromFileList, loadZmkFromGitHub, loadZmkFromRawText } from "./github-loader.js";
import { KeyboardController } from "./keyboard-lock.js";
import { SoundBeeper } from "./sound.js";
import { displayForKey, extractModifiedKeycode } from "./zmk-keycodes.js";

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
    label: "Corne (ZMK 官方)",
    url: "https://github.com/zmkfirmware/zmk/blob/main/app/boards/shields/corne/corne.keymap",
  },
  {
    label: "Sofle (ZMK 官方)",
    url: "https://github.com/zmkfirmware/zmk/blob/main/app/boards/shields/sofle/sofle.keymap",
  },
  {
    label: "Lily58 (ZMK 官方)",
    url: "https://github.com/zmkfirmware/zmk/blob/main/app/boards/shields/lily58/lily58.keymap",
  },
  {
    label: "Sweep / Cradio",
    url: "https://github.com/zmkfirmware/zmk/blob/main/app/boards/shields/cradio/cradio.keymap",
  },
];

// MARK: - Application State

const appState = {
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
  keymapSelect: document.getElementById("keymapSelect"),
  keymapSelectWrap: document.getElementById("keymapSelectWrap"),
  statusBanner: document.getElementById("statusBanner"),
  interceptToggle: document.getElementById("interceptToggle"),
  fullscreenLockBtn: document.getElementById("fullscreenLockBtn"),
  lockBadge: document.getElementById("lockBadge"),
  connectHidBtn: document.getElementById("connectHidBtn"),
  devicesList: document.getElementById("devicesList"),
  metaRepo: document.getElementById("metaRepo"),
  metaLayout: document.getElementById("metaLayout"),
  metaCoverage: document.getElementById("metaCoverage"),
  resetTestedBtn: document.getElementById("resetTestedBtn"),
  layerTabs: document.getElementById("layerTabs"),
  soundToggle: document.getElementById("soundToggle"),
  autoLayerToggle: document.getElementById("autoLayerToggle"),
  showIndicesToggle: document.getElementById("showIndicesToggle"),
  keyboardStage: document.getElementById("keyboardStage"),
  keyboardCanvas: document.getElementById("keyboardCanvas"),
  activeModsBar: document.getElementById("activeModsBar"),
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
    let matches = findMatchesInLayer(ev, appState.activeLayerIndex);

    // Auto-switch layer if not found on current layer
    if (matches.length === 0 && appState.autoSwitchLayer) {
      for (let l = 0; l < appState.config.layers.length; l++) {
        if (l === appState.activeLayerIndex) continue;
        const found = findMatchesInLayer(ev, l);
        if (found.length > 0) {
          appState.activeLayerIndex = l;
          matches = found;
          renderLayerTabs();
          renderKeyboard();
          break;
        }
      }
    }

    const prevTestedCount = appState.testedPhysicalKeys.size;

    // Track matches for this physical code so keyUp cleans up cleanly
    appState.heldCodeMatches.set(codeKey, matches);

    for (const m of matches) {
      appState.activeKeyVisuals.set(`${m.layerIdx}:${m.keyIdx}`, m.kind);
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
    updateKeyVisualStates();
    updateCoverageMeta();
    renderActiveModifiers(ev.modifiers || []);
    if (matches.length > 0) {
      renderInspector(matches[0].keyIdx, ev);
    } else {
      renderInspector(appState.selectedKeyIdx, ev);
    }
  } else if (ev.action === "up") {
    const prevMatches = appState.heldCodeMatches.get(codeKey) || [];
    appState.heldCodeMatches.delete(codeKey);
    for (const m of prevMatches) {
      appState.activeKeyVisuals.delete(`${m.layerIdx}:${m.keyIdx}`);
    }
    // Also sweep any key matching ev.zmk in case auto-layer shifted
    for (const key of Array.from(appState.activeKeyVisuals.keys())) {
      const [lStr, kStr] = key.split(":");
      const b = resolveEffectiveBinding(Number(lStr), Number(kStr));
      if (b && (b.tap === ev.zmk || b.hold === ev.zmk)) {
        appState.activeKeyVisuals.delete(key);
      }
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
  const layer = cfg.layers[appState.activeLayerIndex] || cfg.layers[0];

  els.keyboardCanvas.innerHTML = "";
  els.keyboardCanvas.style.width = `${Math.round(widthU * u)}px`;
  els.keyboardCanvas.style.height = `${Math.round(heightU * u)}px`;

  keys.forEach((k, idx) => {
    const binding = layer?.bindings?.[idx] || {
      raw: "&none",
      behavior: "none",
      displayTap: "",
      displayHold: null,
    };
    const effective = resolveEffectiveBinding(appState.activeLayerIndex, idx);

    const keyEl = document.createElement("button");
    keyEl.type = "button";
    keyEl.className = "keycap";
    keyEl.dataset.keyIdx = String(idx);

    if (binding.behavior === "trans") keyEl.classList.add("is-trans");
    if (binding.behavior === "none") keyEl.classList.add("is-none");
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

    // Index badge
    const idxEl = document.createElement("span");
    idxEl.className = "keycap-idx";
    idxEl.textContent = String(idx);
    if (!appState.showKeyIndices) idxEl.classList.add("hidden");
    keyEl.appendChild(idxEl);

    // Main tap legend
    const tapEl = document.createElement("span");
    tapEl.className = "keycap-tap";
    if (binding.behavior === "trans" && effective && effective.inheritedFromBase) {
      tapEl.textContent = effective.displayTap || "▽";
      tapEl.title = `透传自 Base 层: ${effective.raw}`;
    } else {
      tapEl.textContent = binding.displayTap ?? "";
    }
    if ((tapEl.textContent || "").length > 4) tapEl.classList.add("is-small");
    keyEl.appendChild(tapEl);

    // Hold legend
    const holdLabel =
      binding.behavior === "trans" && effective?.inheritedFromBase
        ? effective.displayHold
        : binding.displayHold;
    if (holdLabel) {
      const holdEl = document.createElement("span");
      holdEl.className = "keycap-hold";
      holdEl.textContent = holdLabel;
      keyEl.appendChild(holdEl);
    }

    // Tested check dot
    const dotEl = document.createElement("span");
    dotEl.className = "keycap-tested-dot";
    keyEl.appendChild(dotEl);

    keyEl.title = `#${idx}: ${binding.raw}`;
    keyEl.addEventListener("click", () => {
      appState.selectedKeyIdx = idx;
      renderInspector(idx, null);
      updateKeyVisualStates();
      // Keep focus off button so Space/Enter stay intercepted
      keyEl.blur();
    });

    els.keyboardCanvas.appendChild(keyEl);
  });

  updateKeyVisualStates();
}

function updateKeyVisualStates() {
  const layerIdx = appState.activeLayerIndex;
  const keyEls = els.keyboardCanvas.querySelectorAll(".keycap");
  for (const el of keyEls) {
    const idx = Number(el.dataset.keyIdx);
    const visualKind = appState.activeKeyVisuals.get(`${layerIdx}:${idx}`);
    el.classList.toggle("is-active", visualKind === "primary");
    el.classList.toggle("is-hold-active", visualKind === "hold");
    el.classList.toggle(
      "is-tested",
      appState.showTestedMarks && appState.testedPhysicalKeys.has(idx)
    );
    el.classList.toggle("is-selected", appState.selectedKeyIdx === idx);
  }
}

function renderLayerTabs() {
  const cfg = appState.config;
  if (!cfg) return;
  els.layerTabs.innerHTML = "";
  cfg.layers.forEach((lyr, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `layer-tab${idx === appState.activeLayerIndex ? " is-active" : ""}`;
    btn.innerHTML = `<span class="layer-num">${idx}</span><span>${escapeHtml(lyr.name)}</span>`;
    btn.addEventListener("click", () => {
      appState.activeLayerIndex = idx;
      renderLayerTabs();
      renderKeyboard();
      btn.blur();
    });
    els.layerTabs.appendChild(btn);
  });
}

function updateCoverageMeta() {
  if (!appState.config) return;
  const total = appState.config.keyCount;
  const tested = appState.testedPhysicalKeys.size;
  const pct = total > 0 ? Math.round((tested / total) * 100) : 0;
  els.metaCoverage.textContent = `已测试 ${tested} / ${total} (${pct}%)`;
}

function renderActiveModifiers(mods) {
  if (!mods || mods.length === 0) {
    els.activeModsBar.innerHTML = `<span class="muted">当前无按住修饰键</span>`;
    return;
  }
  els.activeModsBar.innerHTML = mods
    .map((m) => `<span class="mod-pill">${escapeHtml(displayForKey(m))} (${escapeHtml(m)})</span>`)
    .join("");
}

function renderInspector(keyIdx, lastEvent) {
  const cfg = appState.config;
  const keyInfo =
    cfg && keyIdx !== null && keyIdx !== undefined
      ? cfg.layers[appState.activeLayerIndex]?.bindings?.[keyIdx]
      : null;

  const lines = [];
  if (lastEvent) {
    lines.push(`<div class="insp-row"><span>最后按键</span><strong>${escapeHtml(lastEvent.zmk)}</strong></div>`);
    lines.push(
      `<div class="insp-row"><span>Browser Code</span><code>${escapeHtml(lastEvent.code || "-")}</code></div>`
    );
    lines.push(
      `<div class="insp-row"><span>系统按键拦截</span><span class="tag ${
        lastEvent.intercepted ? "tag-ok" : "tag-warn"
      }">${lastEvent.intercepted ? "已拦截" : "未拦截"}</span></div>`
    );
  }
  if (keyInfo) {
    lines.push(`<hr class="insp-sep"/>`);
    lines.push(
      `<div class="insp-row"><span>位置编号</span><strong>#${keyIdx} (Layer ${appState.activeLayerIndex})</strong></div>`
    );
    lines.push(`<div class="insp-row"><span>ZMK 绑定</span><code>${escapeHtml(keyInfo.raw)}</code></div>`);
    if (keyInfo.hold) {
      lines.push(`<div class="insp-row"><span>Hold 动作</span><strong>${escapeHtml(keyInfo.hold)}</strong></div>`);
    }
  }
  if (lines.length === 0) {
    els.inspectorCard.innerHTML = `<div class="muted">按下键盘按键，或点击布局上的按键查看详细 ZMK 绑定。</div>`;
  } else {
    els.inspectorCard.innerHTML = lines.join("");
  }
}

function pushEventLog(ev, matches) {
  const matchStr =
    matches.length > 0
      ? matches.map((m) => `L${m.layerIdx}#${m.keyIdx}`).join(", ")
      : "未在当前层匹配";

  appState.eventLog.unshift({
    ts: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    zmk: ev.zmk,
    code: ev.code,
    matchStr,
    matched: matches.length > 0,
    intercepted: ev.intercepted,
  });
  if (appState.eventLog.length > 40) appState.eventLog.length = 40;

  els.eventLogList.innerHTML = appState.eventLog
    .map(
      (item) => `
      <div class="log-item ${item.matched ? "is-matched" : ""}">
        <span class="log-time">${item.ts}</span>
        <span class="log-key">${escapeHtml(item.zmk)}</span>
        <span class="log-match">${escapeHtml(item.matchStr)}</span>
      </div>`
    )
    .join("");
}

function renderLockStatus(status) {
  appState.lockStatus = status;
  els.interceptToggle.checked = status.interceptEnabled;

  if (!status.interceptEnabled) {
    els.lockBadge.className = "lock-badge is-off";
    els.lockBadge.textContent = "拦截已关闭";
  } else if (status.isTypingInInput) {
    els.lockBadge.className = "lock-badge is-paused";
    els.lockBadge.textContent = "输入链接时自动暂停拦截";
  } else if (status.isFullscreenLocked) {
    els.lockBadge.className = "lock-badge is-locked";
    els.lockBadge.textContent = "全屏系统键锁定中 (Keyboard Lock)";
  } else {
    els.lockBadge.className = "lock-badge is-active";
    els.lockBadge.textContent = "浏览器按键拦截已启用";
  }

  els.fullscreenLockBtn.textContent = status.isFullscreenLocked
    ? "退出全屏锁定 (长按 Esc)"
    : status.keyboardLockSupported
      ? "全屏锁定系统键"
      : "全屏测试模式";
}

function renderDevices(devices) {
  appState.hidDevices = devices;
  if (!devices || devices.length === 0) {
    els.devicesList.innerHTML = `<span class="device-pill is-muted">可直接通过 USB / 蓝牙输入测试 (可选 WebHID 识别设备)</span>`;
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

function setBanner(msg, type = "info") {
  if (!msg) {
    els.statusBanner.classList.add("hidden");
    return;
  }
  els.statusBanner.className = `status-banner is-${type}`;
  els.statusBanner.textContent = msg;
}

function applyLoadedConfig(cfg, sourceUrl = null) {
  appState.config = cfg;
  appState.activeLayerIndex = 0;
  appState.activeKeyVisuals.clear();
  appState.heldCodeMatches.clear();
  appState.testedPhysicalKeys.clear();
  appState.testedLayerKeys.clear();
  appState.selectedKeyIdx = null;

  els.metaRepo.textContent = `${cfg.repoLabel} · ${cfg.keymapPath}`;
  els.metaLayout.textContent = `布局: ${cfg.layout.name} (${cfg.layout.source})`;
  updateCoverageMeta();

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

  renderLayerTabs();
  renderKeyboard();
  renderInspector(null, null);

  if (sourceUrl) {
    try {
      localStorage.setItem("zmk_tester_last_url", sourceUrl);
    } catch {
      // ignore storage errors
    }
  }
  setBanner(
    `已加载 ${cfg.repoLabel} (${cfg.keyCount} 键, ${cfg.layers.length} 层)。点击空白处并按键即可测试，建议开启“全屏锁定系统键”拦截 Esc / Cmd+W / 浏览器快捷键。`,
    "success"
  );
}

// MARK: - Loading Handlers

async function loadFromUrlInput(preferredKeymap = null) {
  const url = els.repoUrlInput.value.trim();
  if (!url) {
    setBanner("请输入 GitHub zmk-config 链接，或选择下方预设 / 本地文件夹。", "warn");
    return;
  }
  const token = els.tokenInput.value.trim() || null;
  els.loadBtn.disabled = true;
  els.loadBtn.textContent = "读取中...";
  setBanner(`正在读取 ${url} ...`, "info");

  try {
    const cfg = await loadZmkFromGitHub(url, { token, preferredKeymap });
    applyLoadedConfig(cfg, url);
    els.repoUrlInput.blur();
  } catch (err) {
    setBanner(`读取失败: ${err.message}`, "error");
  } finally {
    els.loadBtn.disabled = false;
    els.loadBtn.textContent = "读取布局";
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

const keyboardCtrl = new KeyboardController({
  onKeyEvent: handleKeyEvent,
  onStatusChange: renderLockStatus,
  onDevicesChange: renderDevices,
});

function init() {
  // Preset chips
  PRESET_CONFIGS.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-chip";
    btn.textContent = p.label;
    btn.addEventListener("click", () => {
      els.repoUrlInput.value = p.url;
      loadFromUrlInput();
      btn.blur();
    });
    els.presetBar.appendChild(btn);
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

  // Keymap switcher for multi-keymap repos
  els.keymapSelect.addEventListener("change", () => {
    loadFromUrlInput(els.keymapSelect.value);
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
      setBanner(`本地目录读取失败: ${err.message}`, "error");
    }
  });

  els.fileInput.addEventListener("change", async () => {
    if (!els.fileInput.files?.length) return;
    try {
      const cfg = await loadZmkFromFileList(els.fileInput.files);
      applyLoadedConfig(cfg);
    } catch (err) {
      setBanner(`文件读取失败: ${err.message}`, "error");
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
      setBanner(`解析失败: ${err.message}`, "error");
    }
  });

  // Demo config button
  els.loadDemoBtn.addEventListener("click", async () => {
    const cfg = await loadZmkFromRawText(SAMPLE_CORNE_KEYMAP, "corne.keymap");
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

  // WebHID device button
  if (!keyboardCtrl.hidSupported) {
    els.connectHidBtn.title = "仅 Chrome / Edge 桌面版支持 WebHID";
  }
  els.connectHidBtn.addEventListener("click", async () => {
    try {
      await keyboardCtrl.requestHidDevice();
    } catch (err) {
      if (err.name !== "NotFoundError") {
        setBanner(err.message, "warn");
      }
    }
    els.connectHidBtn.blur();
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

  els.autoLayerToggle.addEventListener("change", () => {
    appState.autoSwitchLayer = els.autoLayerToggle.checked;
    els.autoLayerToggle.blur();
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
    els.eventLogList.innerHTML = `<div class="muted">等待按键输入...</div>`;
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
        setBanner(`拖放读取失败: ${err.message}`, "error");
      }
    }
  });

  // Responsive resize
  const ro = new ResizeObserver(() => {
    if (appState.config) renderKeyboard();
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
  } else if (savedUrl) {
    els.repoUrlInput.value = savedUrl;
    loadZmkFromRawText(SAMPLE_CORNE_KEYMAP, "corne.keymap").then((cfg) => applyLoadedConfig(cfg));
  } else {
    loadZmkFromRawText(SAMPLE_CORNE_KEYMAP, "corne.keymap").then((cfg) => applyLoadedConfig(cfg));
  }
}

init();
