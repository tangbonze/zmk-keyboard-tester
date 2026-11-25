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

## Hardware Connection Principles

Standard browser keyboard tests rely on the operating system's global keyboard input queue, which cannot isolate individual keyboards and cannot identify `&none`, layer keys (`&mo`/`&lt`), combos, or hold-tap keys by their true physical switch position.

> **⚠️ Important Prerequisite for Physical Matrix Testing**:
> Stock ZMK firmware only sends logical HID keycodes to the host and does not report physical switch positions without USB logging.
> To use the **WebHID Matrix** mode in this tool (identifying exact physical switches without enabling `CONFIG_ZMK_USB_LOGGING=y`), **you must install the companion ZMK firmware module**:
> 👉 **[tangbonze/zmk-matrix-tester](https://github.com/tangbonze/zmk-matrix-tester)**
>
> It operates via a dedicated USB Vendor Raw HID interface (`HID_1`, `0xFF60 / 0x61`):
> - **Zero Battery / Wireless Impact**: Executes zero code on battery, uses zero timers/polling, and never prevents MCU deep sleep.
> - **Zero Interference with Normal Use**: Keeps the standard `HID_0` keyboard/mouse/NKRO descriptors and BLE HIDS untouched; supports silent intercept mode while testing so test keystrokes don't type into your OS.
> - **Full Split Keyboard Support**: Automatically enabled on the Central side only and receives physical positions from both Central and Peripheral halves.

This project provides a dedicated WebHID hardware channel for physical matrix testing:

```
                    ┌───────────────────────────┐
                    │    ZMK Keyboard MCU       │
                    │ (Requires zmk-matrix-tester)
                    └─────────────┬─────────────┘
                                  │
                     WebHID API (HID_1, 0xFF60)
                   Direct physical position & split
                   No USB Logging / 0 battery drain
                                  │
                                  ▼
                   ┌──────────────────────────────┐
                   │    ZMK KeyTester Web Client  │
                   │  - Highlights physical key   │
                   │  - Silent intercept mode     │
                   │  - Audio beep & coverage %   │
                   └──────────────────────────────┘
```

### WebHID Physical Matrix (Requires `zmk-matrix-tester` Module)

* **Low-Level Tech**: Uses Chromium's native **WebHID API** (`navigator.hid`) to open the dedicated Vendor HID interface (`HID_1`, Usage Page `0xFF60` / Usage `0x61`).
* **Prerequisite**: Add [`tangbonze/zmk-matrix-tester`](https://github.com/tangbonze/zmk-matrix-tester) to your `zmk-config/config/west.yml` and flash the updated firmware (see the module repo's bilingual README for setup steps).
* **How It Works**:
  - Captures raw `zmk_position_state_changed` events (`position` + split `source`) before `combo`, `hold-tap`, or `keymap` processing.
  - When **"Intercept Keys"** is checked, firmware switches to silent intercept mode so test presses don't type into other apps; unchecking, closing the tab, or unplugging USB automatically restores normal typing.
* **Power & Compatibility**:
  - **Zero wireless battery impact**: When USB is unplugged or the web tester is closed, zero packets, timers, or radio transmissions occur.
  - **Driverless**: Works out of the box on desktop Chrome / Edge (macOS, Windows, Linux).

---

## Firmware Configuration Cheat Sheet

| Goal | Connection Mode | Firmware Configuration | Battery / Feature Impact |
| :--- | :--- | :--- | :--- |
| **True Physical Matrix Testing (No USB Logging)** | **WebHID Matrix (Recommended)** | Add **[tangbonze/zmk-matrix-tester](https://github.com/tangbonze/zmk-matrix-tester)** to `west.yml` | **0 wireless battery drain, silent test supported** |
| **Quick Test without Firmware Changes** | Standard Key Input | No changes required | Matches by HID keycode; limited by layers/combos/`&none` |

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
