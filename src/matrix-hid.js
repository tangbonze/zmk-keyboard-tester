/**
 * WebHID Physical Matrix Client for ZMK Keyboards.
 * Communicates with the `zmk-matrix-tester` firmware module over a dedicated
 * USB Vendor Raw HID interface (HID_1, Usage Page 0xFF60, Usage 0x61),
 * completely bypassing USB logging and OS keycode mapping.
 */

export const TESTER_HID_FILTER = {
  usagePage: 0xff60,
  usage: 0x61,
};

export const TESTER_MODE = {
  OFF: 0,
  PASSTHROUGH: 1,
  INTERCEPT: 2,
};

export const TESTER_CMD = {
  SET_MODE: 0x01,
  GET_INFO: 0x02,
  KEEPALIVE: 0x03,
};

export const TESTER_MSG = {
  KEY_POSITION: 0x01,
  RSP_MODE: 0x81,
  RSP_INFO: 0x82,
};

export const TESTER_REPORT_SIZE = 16;

export function buildMatrixHidCommand(cmd, args = [], reportSize = TESTER_REPORT_SIZE) {
  const buf = new Uint8Array(reportSize);
  buf[0] = cmd & 0xff;
  for (let i = 0; i < args.length && i + 1 < reportSize; i++) {
    buf[i + 1] = args[i] & 0xff;
  }
  return buf;
}

export function parseMatrixHidReport(dataView) {
  if (!dataView || dataView.byteLength < 2) return null;

  const type = dataView.getUint8(0);
  if (type === TESTER_MSG.KEY_POSITION && dataView.byteLength >= 9) {
    return {
      type: "position",
      position: dataView.getUint16(1, true),
      pressed: dataView.getUint8(3) === 1,
      source: dataView.getUint8(4),
      timestamp: dataView.getUint32(5, true),
    };
  }

  if (type === TESTER_MSG.RSP_MODE) {
    return {
      type: "mode",
      mode: dataView.getUint8(1),
    };
  }

  if (type === TESTER_MSG.RSP_INFO && dataView.byteLength >= 8) {
    return {
      type: "info",
      protocolVersion: dataView.getUint8(1),
      keymapLen: dataView.getUint16(2, true),
      isSplit: dataView.getUint8(4) === 1,
      isCentral: dataView.getUint8(5) === 1,
      mode: dataView.getUint8(6),
      reportSize: dataView.getUint8(7),
    };
  }

  return null;
}

export class WebHidMatrixClient {
  constructor({ onMatrixEvent, onStatusChange, onInfo } = {}) {
    this.onMatrixEvent = onMatrixEvent;
    this.onStatusChange = onStatusChange;
    this.onInfo = onInfo;
    this.device = null;
    this.isConnected = false;
    this.mode = TESTER_MODE.OFF;
    this.keepaliveTimer = null;
    this.hidSupported =
      typeof navigator !== "undefined" &&
      Boolean(navigator.hid && typeof navigator.hid.requestDevice === "function");

    this._onInputReport = this._handleInputReport.bind(this);
    this._onDisconnect = this._handleDisconnect.bind(this);
  }

  async toggle(mode = TESTER_MODE.INTERCEPT) {
    if (this.isConnected) {
      await this.disconnect();
    } else {
      await this.connect(mode);
    }
  }

  async connect(initialMode = TESTER_MODE.INTERCEPT) {
    if (!this.hidSupported) {
      throw new Error(
        "当前浏览器不支持 WebHID API，请使用 Chrome / Edge 桌面版连接物理矩阵测试。"
      );
    }

    const devices = await navigator.hid.requestDevice({
      filters: [TESTER_HID_FILTER],
    });
    if (!devices.length) {
      return null;
    }

    const device = devices[0];
    if (!device.opened) {
      await device.open();
    }

    this.device = device;
    this.isConnected = true;
    this.device.addEventListener("inputreport", this._onInputReport);
    navigator.hid.addEventListener("disconnect", this._onDisconnect);

    await this.getInfo();
    await this.setMode(initialMode);

    this.onStatusChange?.({
      isConnected: true,
      deviceName: device.productName || "ZMK Raw HID",
      mode: this.mode,
    });
    return device;
  }

  async disconnect() {
    this._stopKeepalive();
    const dev = this.device;
    this.device = null;
    this.isConnected = false;
    this.mode = TESTER_MODE.OFF;

    if (dev) {
      try {
        dev.removeEventListener("inputreport", this._onInputReport);
        if (dev.opened) {
          const offCmd = buildMatrixHidCommand(TESTER_CMD.SET_MODE, [TESTER_MODE.OFF]);
          await dev.sendReport(0, offCmd).catch(() => {});
          await dev.close().catch(() => {});
        }
      } finally {
        navigator.hid?.removeEventListener("disconnect", this._onDisconnect);
      }
    }

    this.onStatusChange?.({ isConnected: false, mode: TESTER_MODE.OFF });
  }

  async setMode(mode) {
    if (!this.device || !this.device.opened) return;
    this.mode = mode;
    await this.device.sendReport(0, buildMatrixHidCommand(TESTER_CMD.SET_MODE, [mode]));
    if (mode === TESTER_MODE.INTERCEPT) {
      this._startKeepalive();
    } else {
      this._stopKeepalive();
    }
  }

  async getInfo() {
    if (!this.device || !this.device.opened) return;
    await this.device.sendReport(0, buildMatrixHidCommand(TESTER_CMD.GET_INFO));
  }

  _startKeepalive() {
    this._stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.device && this.device.opened) {
        this.device
          .sendReport(0, buildMatrixHidCommand(TESTER_CMD.KEEPALIVE))
          .catch(() => {});
      }
    }, 5000);
  }

  _stopKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  _handleDisconnect(event) {
    if (event.device === this.device) {
      this._stopKeepalive();
      this.device = null;
      this.isConnected = false;
      this.mode = TESTER_MODE.OFF;
      this.onStatusChange?.({ isConnected: false, mode: TESTER_MODE.OFF });
    }
  }

  _handleInputReport(event) {
    const parsed = parseMatrixHidReport(event.data);
    if (!parsed) return;

    if (parsed.type === "position") {
      this.onMatrixEvent?.(parsed);
    } else if (parsed.type === "info") {
      this.onInfo?.(parsed);
    } else if (parsed.type === "mode") {
      this.mode = parsed.mode;
    }
  }
}
