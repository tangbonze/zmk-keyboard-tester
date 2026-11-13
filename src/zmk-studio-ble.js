/**
 * ZMK Studio Web Bluetooth (GATT) Client.
 * Connects directly to ZMK Studio-enabled keyboards over Bluetooth Low Energy (BLE)
 * using the official ZMK Studio GATT service without battery penalty.
 */

export const ZMK_STUDIO_SERVICE_UUID = "00000000-0196-6107-c967-c5cfb1c2482a";
export const ZMK_STUDIO_CHAR_UUID = "00000001-0196-6107-c967-c5cfb1c2482a";

export const SOF = 0xab; // Start of Frame
export const ESC = 0xac; // Escape byte
export const EOF = 0xad; // End of Frame

/**
 * Encodes a raw Uint8Array payload into a framed ZMK Studio packet:
 * 0xAB + escaped_payload + 0xAD
 */
export function encodeZmkStudioFrame(payload) {
  const bytes = new Uint8Array(payload);
  const out = [SOF];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === SOF || b === ESC || b === EOF) {
      out.push(ESC);
    }
    out.push(b);
  }
  out.push(EOF);
  return new Uint8Array(out);
}

/**
 * Decodes a streaming buffer of bytes containing ZMK Studio frames.
 * Returns { frames: Uint8Array[], remainder: Uint8Array }
 */
export function decodeZmkStudioFrames(buffer) {
  const frames = [];
  let inFrame = false;
  let isEscaped = false;
  let current = [];
  let frameStartIdx = -1;
  let consumedUpTo = 0;

  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i];
    if (!inFrame) {
      if (b === SOF) {
        inFrame = true;
        isEscaped = false;
        current = [];
        frameStartIdx = i;
      }
    } else {
      if (isEscaped) {
        current.push(b);
        isEscaped = false;
      } else if (b === ESC) {
        isEscaped = true;
      } else if (b === EOF) {
        frames.push(new Uint8Array(current));
        inFrame = false;
        current = [];
        frameStartIdx = -1;
        consumedUpTo = i + 1;
      } else if (b === SOF) {
        // Recover from corrupt stream: new SOF starts new frame
        current = [];
        isEscaped = false;
        frameStartIdx = i;
      } else {
        current.push(b);
      }
    }
  }

  const remainder =
    inFrame && frameStartIdx >= 0
      ? buffer.slice(frameStartIdx)
      : buffer.slice(consumedUpTo);
  return { frames, remainder };
}

export class ZmkStudioBleClient {
  constructor({ onStatusChange, onFrameReceived }) {
    this.onStatusChange = onStatusChange;
    this.onFrameReceived = onFrameReceived;
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.isConnected = false;
    this.streamBuffer = new Uint8Array(0);

    this.bleSupported =
      typeof navigator !== "undefined" &&
      Boolean(navigator.bluetooth && typeof navigator.bluetooth.requestDevice === "function");

    this._onDisconnected = this._handleDisconnected.bind(this);
    this._onCharacteristicValueChanged = this._handleValueChange.bind(this);
  }

  async toggle() {
    if (this.isConnected) {
      await this.disconnect();
    } else {
      await this.connect();
    }
  }

  async connect() {
    if (!this.bleSupported) {
      throw new Error(
        "当前浏览器不支持 Web Bluetooth API，请使用 Chrome / Edge 桌面版或 Android Chrome。"
      );
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [ZMK_STUDIO_SERVICE_UUID] },
      ],
      optionalServices: [
        ZMK_STUDIO_SERVICE_UUID,
        "00001812-0000-1000-8000-00805f9b34fb", // HID service fallback
      ],
    });

    this.device = device;
    device.addEventListener("gattserverdisconnected", this._onDisconnected);

    const server = await device.gatt.connect();
    this.server = server;

    const service = await server.getPrimaryService(ZMK_STUDIO_SERVICE_UUID);
    const char = await service.getCharacteristic(ZMK_STUDIO_CHAR_UUID);
    this.characteristic = char;

    await char.startNotifications();
    char.addEventListener("characteristicvaluechanged", this._onCharacteristicValueChanged);

    this.isConnected = true;
    this.onStatusChange?.({
      isConnected: true,
      deviceName: device.name || "ZMK Studio Device",
    });
  }

  async disconnect() {
    this.isConnected = false;
    if (this.characteristic) {
      try {
        this.characteristic.removeEventListener(
          "characteristicvaluechanged",
          this._onCharacteristicValueChanged
        );
        await this.characteristic.stopNotifications();
      } catch {}
      this.characteristic = null;
    }
    if (this.device) {
      this.device.removeEventListener("gattserverdisconnected", this._onDisconnected);
      if (this.device.gatt?.connected) {
        try {
          this.device.gatt.disconnect();
        } catch {}
      }
      this.device = null;
    }
    this.server = null;
    this.streamBuffer = new Uint8Array(0);
    this.onStatusChange?.({ isConnected: false, deviceName: null });
  }

  _handleDisconnected() {
    this.isConnected = false;
    this.characteristic = null;
    this.server = null;
    this.streamBuffer = new Uint8Array(0);
    this.onStatusChange?.({ isConnected: false, deviceName: null });
  }

  _handleValueChange(event) {
    const dataView = event.target.value;
    if (!dataView || dataView.byteLength === 0) return;

    const newBytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    // Append to streamBuffer
    const combined = new Uint8Array(this.streamBuffer.length + newBytes.length);
    combined.set(this.streamBuffer, 0);
    combined.set(newBytes, this.streamBuffer.length);

    const { frames, remainder } = decodeZmkStudioFrames(combined);
    this.streamBuffer = remainder;

    for (const frame of frames) {
      this.onFrameReceived?.(frame);
    }
  }

  async sendFrame(rawPayload) {
    if (!this.isConnected || !this.characteristic) {
      throw new Error("ZMK Studio BLE 未连接");
    }
    const framed = encodeZmkStudioFrame(rawPayload);
    // Write value with response or without response depending on properties
    if (this.characteristic.properties.write) {
      await this.characteristic.writeValueWithResponse(framed);
    } else {
      await this.characteristic.writeValueWithoutResponse(framed);
    }
  }
}
