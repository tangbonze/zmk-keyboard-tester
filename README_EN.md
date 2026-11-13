<div align="center">

# ZMK KeyTester

**Online Physical Layout & Hardware Matrix Tester for ZMK Keyboards**

[**简体中文**](./README.md) | [**English**](./README_EN.md)

</div>

---

A modern, zero-dependency, pure client-side web testing tool designed specifically for **ZMK firmware custom keyboards** (split, unibody, BLE wireless, and wired), hosted directly on **GitHub Pages**.

👉 **Live Demo**: **https://tangbonze.github.io/zmk-keyboard-tester/**

---

## Key Features

1. **Direct GitHub zmk-config Ingestion & Accurate Physical Layout Extraction**
   - Enter any GitHub repo URL, `tree`, `blob`, or `raw` link, with **multi-branch switching** and multi-shield file selection directly from dropdown menus.
   - Supports uploading local `zmk-config` folders or drag-and-dropping `.keymap` files.
   - Automatically prioritizes and calculates real physical key geometries and rotation angles (with precise rotated bounding box calculation, preventing thumb cluster clipping):
     1. In-tree `zmk,physical-layout` (`&key_physical_attrs`) or `info.json`
     2. External module repos referenced in `config/west.yml`
     3. Upstream `zmkfirmware/zmk` shields and `dts/layouts`
     4. `zmk,matrix-transform` (`RC(r,c)`) electrical matrix or keymap row-column heuristics.
2. **Minimalist Physical Layout View**
   - Focuses purely on physical switch positions and board geometry without distracting multi-layer labels.
   - Strictly pinned UI layout ensures **zero jitter** during typing, layer changes, or inspections.
3. **Eyes-Free Audio Feedback (Beep)**
   - Plays a crisp audio tone when a key triggers, allowing you to test solder pads, hot-swap sockets, or switches with tweezers **without looking at the screen**.
4. **Fullscreen Key Lock Mode**
   - Intercepts `Tab`, `Space`, `Arrow keys`, `F1-F12`, page scrolling, and context menus by default.
   - Click **"Fullscreen Key Lock"** to enable `navigator.keyboard.lock()`, intercepting `Esc` (long press to exit), `Cmd+W` / `Ctrl+W`, and other lockable shortcuts.
5. **Bilingual (ZH / EN) & Dark / Light Theme**
   - One-click toggle in the top-right corner for Chinese/English and ☀️ Light / 🌙 Dark themes, persisted across sessions.

---

## Wired & Wireless Connection Principles

Standard browser keyboard tests rely on the operating system's global keyboard input queue, which aggregates all connected keyboards and strips away hardware origin and matrix coordinates.

This project provides two dedicated hardware-level communication channels: **Wired (Serial)** and **Wireless (BLE)** to achieve hardware isolation and physical matrix positioning:

```
                    ┌───────────────────────────┐
                    │    ZMK Keyboard MCU       │
                    └─────────────┬─────────────┘
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
   【Wired Mode】                                    【Wireless Mode】
Web Serial API (CDC-ACM)                         Web Bluetooth API (BLE GATT)
         │                                                 │
 1. Hardware Matrix Log (kscan)                    ZMK Studio Ultra-Low-Power Service
    Row: X, Col: Y, pos: N                          UUID: 00000000-0196-6107-c967-...
 2. ZMK Studio Wired RPC                                   │
    snippet: studio-rpc-usb-uart                           ▼
         │                                      Event-driven notifications, 0 battery drain
         ▼                                      SoF(0xAB) - Esc(0xAC) - EoF(0xAD)
 Powered by 5V USB, 0 battery consumed                     │
 Complete isolation, targets physical switch               │
         │                                                 │
         └────────────────────────┬────────────────────────┘
                                  ▼
                   ┌──────────────────────────────┐
                   │    ZMK KeyTester Web Client  │
                   │  - Highlights physical key   │
                   │  - Audio beep & coverage %   │
                   └──────────────────────────────┘
```

### 1. Wired Serial Matrix (Web Serial API)

* **Low-Level Tech**: Based on Chromium's native **Web Serial API** (`navigator.serial`) at 115200 baud.
* **Use Cases**: PCB assembling, testing solder pads with tweezers, switch verification.
* **Working Modes**:
  - **Mode A (Kscan Matrix Logging)**: Add `CONFIG_ZMK_USB_LOGGING=y` to keyboard firmware. The hardware scan driver (`kscan`) streams switch events (`Row: 0, col: 19, position: 36, pressed: true`) directly over USB CDC-ACM. The web client decodes row/col/position to light up the physical keycap.
  - **Mode B (ZMK Studio Wired RPC)**: Build firmware with `snippet: studio-rpc-usb-uart` and `CONFIG_ZMK_STUDIO=y` for structured RPC over USB serial.
* **Power & Isolation**:
  - **Powered by 5V USB bus**: Consumes zero lithium battery power while testing.
  - **Bypasses OS keyboard pipeline**: Typing on other keyboards generates zero data on this port.

### 2. BLE Bluetooth Direct (Web Bluetooth API)

* **Low-Level Tech**: Based on **Web Bluetooth API** (`navigator.bluetooth`), directly connecting to ZMK's official Studio GATT Service.
  * **Service UUID**: `00000000-0196-6107-c967-c5cfb1c2482a`
  * **Characteristic UUID**: `00000001-0196-6107-c967-c5cfb1c2482a`
* **Use Cases**: Daily wireless switch testing, split Bluetooth keyboards, portable cable-free validation.
* **Working Mechanism**:
  - Enable `CONFIG_ZMK_STUDIO=y` in keyboard firmware.
  - Web client initiates a dedicated GATT connection using ZMK Studio 3-byte escape packet framing:
    * `0xAB`: Start of Frame (SoF)
    * `0xAC`: Escape Byte (Esc)
    * `0xAD`: End of Frame (EoF)
* **Power & Isolation**:
  - **Full Zephyr RTOS Low-Power Sleep Compatibility**: Unlike serial logging which continuously polls CPU cycles, BLE GATT is purely **event-driven (interrupt notifications)**. When keys are idle, the MCU enters microamp deep sleep (System OFF), ensuring **zero battery penalty and preserving standard months-long battery life**.

---

## Firmware Configuration Cheat Sheet

| Goal | Recommended Mode | Firmware Configuration | Battery Impact |
| :--- | :--- | :--- | :--- |
| **Assembly / Soldering Test** (pads, switches) | **Wired Serial Matrix** | `config.conf`: `CONFIG_ZMK_USB_LOGGING=y`<br>or `build.yaml`: `snippet: studio-rpc-usb-uart` | **Zero battery drain** (USB powered) |
| **Wireless Daily Test** (isolated from other keyboards) | **BLE Bluetooth** | `config.conf`: `CONFIG_ZMK_STUDIO=y` | **Ultra-low power** (MCU deep sleep) |
| **Quick Self-Test without Firmware Changes** | Standard Key Input | No changes required, test directly in browser | Native keyboard battery life |

---

## Deploy to GitHub Pages

This project is 100% static client-side HTML, CSS, and ES Modules with zero build steps:

1. Fork or push this repository to your GitHub account.
2. Go to **Settings -> Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**, choose `main` branch and `/ (root)`, then click Save.
4. Your tester will be live at `https://<username>.github.io/<repo>/`.
   * Supports preloading configs via URL parameter: `https://<username>.github.io/<repo>/?config=https://github.com/a741725193/zmk-config-elashvelvet`

---

## Local Development & Testing

```bash
# Start a local static server
python3 -m http.server 8080

# Run automated unit tests (DTS parser, geometry rotation bounding boxes, i18n parity, Studio framing)
node --test tests/zmk-parser.test.mjs
```
