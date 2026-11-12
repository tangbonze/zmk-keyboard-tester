/**
 * Browser-side System Key Interception (Capture + Keyboard Lock API)
 * and WebHID USB / Bluetooth keyboard detection.
 */

import { keyboardEventToZmk } from "./zmk-keycodes.js";

export class KeyboardController {
  constructor({ onKeyEvent, onStatusChange, onDevicesChange }) {
    this.onKeyEvent = onKeyEvent;
    this.onStatusChange = onStatusChange;
    this.onDevicesChange = onDevicesChange;

    this.interceptEnabled = true;
    this.isFullscreenLocked = false;
    this.keyboardLockSupported =
      typeof navigator !== "undefined" &&
      Boolean(navigator.keyboard && typeof navigator.keyboard.lock === "function");
    this.hidSupported = typeof navigator !== "undefined" && Boolean(navigator.hid);

    this.activeModifiers = new Set();
    this.heldWithMeta = new Set();
    this.pressedPhysicalCodes = new Set();
    this.connectedHidDevices = [];

    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
    this._onBlur = this._handleBlur.bind(this);
    this._onFullscreenChange = this._handleFullscreenChange.bind(this);
    this._onBeforeUnload = this._handleBeforeUnload.bind(this);
    this._onContextMenu = this._handleContextMenu.bind(this);
    this._onHidConnect = this._refreshHidDevices.bind(this);
    this._onHidDisconnect = this._refreshHidDevices.bind(this);
  }

  start() {
    window.addEventListener("keydown", this._onKeyDown, { capture: true, passive: false });
    window.addEventListener("keyup", this._onKeyUp, { capture: true, passive: false });
    window.addEventListener("blur", this._onBlur);
    document.addEventListener("visibilitychange", this._onBlur);
    document.addEventListener("fullscreenchange", this._onFullscreenChange);
    window.addEventListener("beforeunload", this._onBeforeUnload);
    window.addEventListener("contextmenu", this._onContextMenu, { capture: true });

    if (this.hidSupported) {
      navigator.hid.addEventListener("connect", this._onHidConnect);
      navigator.hid.addEventListener("disconnect", this._onHidDisconnect);
      this._refreshHidDevices();
    }
    this._emitStatus();
  }

  destroy() {
    window.removeEventListener("keydown", this._onKeyDown, { capture: true });
    window.removeEventListener("keyup", this._onKeyUp, { capture: true });
    window.removeEventListener("blur", this._onBlur);
    document.removeEventListener("visibilitychange", this._onBlur);
    document.removeEventListener("fullscreenchange", this._onFullscreenChange);
    window.removeEventListener("beforeunload", this._onBeforeUnload);
    window.removeEventListener("contextmenu", this._onContextMenu, { capture: true });

    if (this.hidSupported) {
      navigator.hid.removeEventListener("connect", this._onHidConnect);
      navigator.hid.removeEventListener("disconnect", this._onHidDisconnect);
    }
  }

  isTypingInInput() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    return Boolean(el.isContentEditable);
  }

  setInterceptEnabled(enabled) {
    this.interceptEnabled = Boolean(enabled);
    if (!this.interceptEnabled && this.isFullscreenLocked) {
      this.exitFullscreenLock();
    }
    this._emitStatus();
  }

  async enterFullscreenLock() {
    this.interceptEnabled = true;
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      if (this.keyboardLockSupported) {
        await navigator.keyboard.lock();
        this.isFullscreenLocked = true;
      }
    } catch (err) {
      console.warn("Keyboard Lock / Fullscreen failed:", err);
      this.isFullscreenLocked = false;
    }
    // Blur any input so keys are immediately captured
    if (document.activeElement && this.isTypingInInput()) {
      document.activeElement.blur();
    }
    this._emitStatus();
  }

  async exitFullscreenLock() {
    try {
      if (this.keyboardLockSupported && navigator.keyboard.unlock) {
        navigator.keyboard.unlock();
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore exit errors
    }
    this.isFullscreenLocked = false;
    this._emitStatus();
  }

  async requestHidDevice() {
    if (!this.hidSupported) {
      throw new Error("当前浏览器不支持 WebHID API，请使用 Chrome / Edge 桌面版，或直接按键测试即可。");
    }
    const devices = await navigator.hid.requestDevice({
      filters: [
        { usagePage: 0x01, usage: 0x06 }, // Generic Desktop Keyboard
        { usagePage: 0x0c, usage: 0x01 }, // Consumer Control
      ],
    });
    await this._refreshHidDevices();
    return devices;
  }

  async _refreshHidDevices() {
    if (!this.hidSupported) return;
    try {
      const devices = await navigator.hid.getDevices();
      const seen = new Set();
      const list = [];
      for (const d of devices) {
        const key = `${d.vendorId}:${d.productId}:${d.productName}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push({
            name: d.productName || "ZMK HID Keyboard",
            vendorId: `0x${d.vendorId.toString(16).toUpperCase().padStart(4, "0")}`,
            productId: `0x${d.productId.toString(16).toUpperCase().padStart(4, "0")}`,
            opened: d.opened,
            collections: d.collections?.length || 0,
          });
        }
        this._attachConsumerHidListener(d);
      }
      this.connectedHidDevices = list;
      this.onDevicesChange?.(list);
    } catch {
      // Ignore permission/enumeration errors
    }
  }

  async _attachConsumerHidListener(device) {
    // Only open Consumer Control (0x0C) / non-protected collections if not already opened
    const hasConsumer = device.collections?.some((c) => c.usagePage === 0x0c);
    if (!hasConsumer || device.opened) return;
    try {
      await device.open();
      device.addEventListener("inputreport", (ev) => {
        if (!this.interceptEnabled || this.isTypingInInput()) return;
        const view = ev.data;
        if (!view || view.byteLength === 0) return;
        const usage = view.byteLength >= 2 ? view.getUint16(0, true) : view.getUint8(0);
        const consumerMap = {
          0x00e9: "C_VOL_UP",
          0x00ea: "C_VOL_DN",
          0x00e2: "C_MUTE",
          0x00cd: "C_PP",
          0x00b5: "C_NEXT",
          0x00b6: "C_PREV",
          0x00b7: "C_STOP",
          0x006f: "C_BRI_UP",
          0x0070: "C_BRI_DN",
        };
        const zmk = consumerMap[usage];
        if (zmk) {
          this.onKeyEvent?.({
            action: "down",
            zmk,
            code: `HID_0x${usage.toString(16)}`,
            key: zmk,
            modifiers: Array.from(this.activeModifiers),
            intercepted: true,
            isRepeat: false,
            source: "webhid",
          });
          setTimeout(() => {
            this.onKeyEvent?.({
              action: "up",
              zmk,
              code: `HID_0x${usage.toString(16)}`,
              key: zmk,
              modifiers: Array.from(this.activeModifiers),
              intercepted: true,
              isRepeat: false,
              source: "webhid",
            });
          }, 150);
        }
      });
    } catch {
      // OS may block opening certain HID interfaces; standard KeyboardEvent still works
    }
  }

  _syncModifiersFromEvent(e) {
    // Keep modifier set consistent with browser event flags
    const check = (flag, left, right) => {
      if (!flag) {
        this.activeModifiers.delete(left);
        this.activeModifiers.delete(right);
      }
    };
    check(e.shiftKey, "LSHFT", "RSHFT");
    check(e.ctrlKey, "LCTRL", "RCTRL");
    check(e.altKey, "LALT", "RALT");
    check(e.metaKey, "LGUI", "RGUI");
  }

  _handleKeyDown(e) {
    if (!this.interceptEnabled || this.isTypingInInput()) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const zmk = keyboardEventToZmk(e);
    if (["LSHFT", "RSHFT", "LCTRL", "RCTRL", "LALT", "RALT", "LGUI", "RGUI"].includes(zmk)) {
      this.activeModifiers.add(zmk);
    }
    if (e.metaKey && !["LGUI", "RGUI"].includes(zmk)) {
      this.heldWithMeta.add(e.code || zmk);
    }

    const codeKey = e.code || zmk;
    this.pressedPhysicalCodes.add(codeKey);

    this.onKeyEvent?.({
      action: "down",
      zmk,
      code: e.code || "",
      key: e.key || "",
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      modifiers: Array.from(this.activeModifiers),
      intercepted: true,
      isRepeat: e.repeat,
      source: "browser",
    });
  }

  _handleKeyUp(e) {
    if (!this.interceptEnabled || this.isTypingInInput()) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const zmk = keyboardEventToZmk(e);
    const codeKey = e.code || zmk;

    if (["LSHFT", "RSHFT", "LCTRL", "RCTRL", "LALT", "RALT", "LGUI", "RGUI"].includes(zmk)) {
      this.activeModifiers.delete(zmk);
    }
    this._syncModifiersFromEvent(e);
    this.pressedPhysicalCodes.delete(codeKey);

    this.onKeyEvent?.({
      action: "up",
      zmk,
      code: e.code || "",
      key: e.key || "",
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      modifiers: Array.from(this.activeModifiers),
      intercepted: true,
      isRepeat: false,
      source: "browser",
    });

    // macOS browsers suppress keyup for keys pressed while Meta/Cmd is held; clean them up when Meta releases
    if (zmk === "LGUI" || zmk === "RGUI") {
      for (const staleCode of this.heldWithMeta) {
        this.pressedPhysicalCodes.delete(staleCode);
        const staleZmk = keyboardEventToZmk({ code: staleCode, key: "" });
        this.onKeyEvent?.({
          action: "up",
          zmk: staleZmk,
          code: staleCode,
          key: "",
          modifiers: Array.from(this.activeModifiers),
          intercepted: true,
          isRepeat: false,
          source: "meta-cleanup",
        });
      }
      this.heldWithMeta.clear();
    }
  }

  _handleBlur() {
    if (this.pressedPhysicalCodes.size === 0 && this.activeModifiers.size === 0) return;
    this.activeModifiers.clear();
    this.heldWithMeta.clear();
    const stale = Array.from(this.pressedPhysicalCodes);
    this.pressedPhysicalCodes.clear();
    for (const code of stale) {
      const zmk = keyboardEventToZmk({ code, key: "" });
      this.onKeyEvent?.({
        action: "up",
        zmk,
        code,
        key: "",
        modifiers: [],
        intercepted: false,
        isRepeat: false,
        source: "blur-cleanup",
      });
    }
    this._emitStatus();
  }

  _handleFullscreenChange() {
    const fs = Boolean(document.fullscreenElement);
    if (!fs) {
      this.isFullscreenLocked = false;
      if (this.keyboardLockSupported && navigator.keyboard.unlock) {
        try {
          navigator.keyboard.unlock();
        } catch {
          // ignore
        }
      }
    }
    this._emitStatus();
  }

  _handleBeforeUnload(e) {
    if (this.interceptEnabled && this.pressedPhysicalCodes.size > 0) {
      e.preventDefault();
      e.returnValue = "";
    }
  }

  _handleContextMenu(e) {
    if (this.interceptEnabled && !this.isTypingInInput() && this.pressedPhysicalCodes.has("ContextMenu")) {
      e.preventDefault();
    }
  }

  _emitStatus() {
    this.onStatusChange?.({
      interceptEnabled: this.interceptEnabled,
      isTypingInInput: this.isTypingInInput(),
      isFullscreenLocked: this.isFullscreenLocked,
      keyboardLockSupported: this.keyboardLockSupported,
      hidSupported: this.hidSupported,
    });
  }
}
