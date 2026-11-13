/**
 * WebSerial Matrix Monitor for ZMK Keyboards.
 * Reads direct raw GPIO switch closure events via USB CDC ACM serial log (CONFIG_ZMK_USB_LOGGING=y)
 * completely bypassing OS keyboard mapping.
 */

export function parseZmkMatrixLog(line) {
  if (!line || typeof line !== "string") return null;

  // Pattern 1: zmk_kscan_process_msgq: Row: 0, col: 19, position: 36, pressed: true
  const m1 = line.match(
    /Row:\s*(\d+),\s*col:\s*(\d+)(?:,\s*position:\s*(\d+))?,\s*pressed:\s*(true|false)/i
  );
  if (m1) {
    return {
      row: parseInt(m1[1], 10),
      col: parseInt(m1[2], 10),
      position: m1[3] !== undefined ? parseInt(m1[3], 10) : null,
      pressed: m1[4].toLowerCase() === "true",
      rawLine: line,
    };
  }

  // Pattern 2: kscan_gpio_read: Sending event at 0,19 state on / off
  const m2 = line.match(/(?:event at|kscan.*at)\s*(\d+)[,\s]+(\d+)\s+state\s+(on|off)/i);
  if (m2) {
    return {
      row: parseInt(m2[1], 10),
      col: parseInt(m2[2], 10),
      position: null,
      pressed: m2[3].toLowerCase() === "on",
      rawLine: line,
    };
  }

  return null;
}

export class SerialMatrixMonitor {
  constructor({ onMatrixEvent, onStatusChange }) {
    this.onMatrixEvent = onMatrixEvent;
    this.onStatusChange = onStatusChange;
    this.port = null;
    this.reader = null;
    this.isConnected = false;
    this.serialSupported =
      typeof navigator !== "undefined" && Boolean(navigator.serial && navigator.serial.requestPort);
  }

  async toggle() {
    if (this.isConnected) {
      await this.disconnect();
    } else {
      await this.connect();
    }
  }

  async connect() {
    if (!this.serialSupported) {
      throw new Error(
        "当前浏览器不支持 WebSerial API，请使用 Chrome / Edge 桌面版通过 USB 串口读取物理矩阵。"
      );
    }
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    this.port = port;
    this.isConnected = true;
    this.onStatusChange?.({ isConnected: true });

    this._readLoop().catch((err) => {
      console.warn("Serial loop terminated:", err);
      this.disconnect();
    });
  }

  async disconnect() {
    this.isConnected = false;
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {}
      this.reader = null;
    }
    if (this.port) {
      try {
        await this.port.close();
      } catch {}
      this.port = null;
    }
    this.onStatusChange?.({ isConnected: false });
  }

  async _readLoop() {
    if (!this.port || !this.port.readable) return;
    const textDecoder = new TextDecoderStream();
    this.port.readable.pipeTo(textDecoder.writable).catch(() => {});
    this.reader = textDecoder.readable.getReader();

    let buffer = "";
    try {
      while (this.isConnected) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          buffer += value;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop(); // retain partial line
          for (const line of lines) {
            const ev = parseZmkMatrixLog(line);
            if (ev) {
              this.onMatrixEvent?.(ev);
            }
          }
        }
      }
    } catch (err) {
      if (this.isConnected) {
        console.warn("Serial read error:", err);
      }
    } finally {
      await this.disconnect();
    }
  }
}
