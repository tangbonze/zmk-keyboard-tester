# ZMK KeyTester — 在线 ZMK 键盘物理布局与硬件直读测试器

专为 **ZMK 固件客制化键盘**（分体 / 单体 / 无线蓝牙 / 有线）打造的纯前端在线测试工具，零构建依赖，直接托管于 **GitHub Pages**。

在线使用地址：👉 **https://tangbonze.github.io/zmk-keyboard-tester/**

---

## 核心特性

1. **直接读取 GitHub zmk-config 仓库并精确还原物理布局**
   - 支持直接输入任意 GitHub 仓库链接、`tree` / `blob` / `raw` 链接，支持在下拉框中**自由切换仓库分支**与选择不同键盘文件。
   - 支持上传本地 `zmk-config` 目录或直接拖放 `.keymap` 代码。
   - 自动按优先级检索并计算真实物理几何外形与旋转角度（支持精确按键旋转包围盒计算，杜绝 Thumb 拇指区角度裁切）：
     1. 仓库内的 `zmk,physical-layout`（`&key_physical_attrs`）或 `info.json`
     2. `config/west.yml` 中引用的外部模块仓库
     3. 官方 `zmkfirmware/zmk` 上游 shield 与 `dts/layouts`
     4. `zmk,matrix-transform`（`RC(r,c)`）电气矩阵与 keymap 排布推导
2. **纯粹的极简物理布局呈现**
   - 专注显示真实的键盘物理几何外形，无多层杂乱字符干扰，清晰直观地观察轴体覆盖情况。
   - 严格固定界面布局，按键与操作过程中**界面零抖动**。
3. **盲测提示音（Eyes-Free Audio Feedback）**
   - 触发按键时发出清脆蜂鸣音，组装键盘、用镊子验焊盘或插拔轴体时，**无需看屏幕即可确认硬件通断**。
4. **全屏系统键拦截模式**
   - 默认拦截 `Tab`、`Space`、`方向键`、`F1-F12`、翻页键等浏览器行为。
   - 点击 **「全屏锁定系统键」** 启用 `navigator.keyboard.lock()`，拦截 `Esc`（长按退出）、`Cmd+W` / `Ctrl+W` 等快捷键。
5. **中英双语与亮暗主题**
   - 右上角支持一键切换中文 / 英文，以及 ☀️ 亮色 / 🌙 暗色主题，自动记住用户偏好。

---

## 有线与无线连接原理

常规网页测试使用的是操作系统的全局键盘输入流，由于操作系统会将所有键盘的按键合并并抹去硬件来源，任意键盘按下 `A` 都会导致屏幕上的 `A` 亮起。

本项目提供了**有线**与**无线（BLE）**两条独立的硬件级直连通道，从根本上解决设备隔离与物理矩阵定位问题：

```
                    ┌───────────────────────────┐
                    │       ZMK 键盘主控        │
                    └─────────────┬─────────────┘
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
   【有线连接模式】                                   【无线连接模式】
Web Serial API (CDC-ACM)                         Web Bluetooth API (BLE GATT)
         │                                                 │
 1. 硬件矩阵直读日志 (kscan)                        ZMK Studio 专属低功耗服务
    Row: X, Col: Y, pos: N                          UUID: 00000000-0196-6107-c967-...
 2. ZMK Studio 有线 RPC                                    │
    snippet: studio-rpc-usb-uart                           ▼
         │                                      事件驱动，按需通知，0额外耗电
         ▼                                      SoF(0xAB) - Esc(0xAC) - EoF(0xAD)
 电脑 5V 供电，完全不耗电池                                 │
 完全隔离其他键盘，直接定位物理轴体                           │
         │                                                 │
         └────────────────────────┬────────────────────────┘
                                  ▼
                   ┌──────────────────────────────┐
                   │    ZMK KeyTester 网页端      │
                   │  - 物理按键精准点亮          │
                   │  - 蜂鸣提示音 & 覆盖率统计   │
                   └──────────────────────────────┘
```

### 1. 有线串口直读矩阵（Wired Serial Matrix）

* **底层技术**：基于 Chromium 原生 **Web Serial API**（`navigator.serial`），波特率 115200。
* **适用场景**：键盘组装验板、镊子短接焊盘测通断、热插拔底座测试。
* **工作机制**：
  - **模式 A（Kscan 矩阵直读）**：在键盘固件配置中加入 `CONFIG_ZMK_USB_LOGGING=y`。主控的硬件扫键线程（`kscan`）在引脚发生电平跳变时，直接向虚拟串口输出底层扫描事件（如 `Row: 0, col: 19, position: 36, pressed: true`）。网页端直接解析硬件引脚与物理索引高亮按键。
  - **模式 B（ZMK Studio 有线 RPC）**：固件编译时添加 `snippet: studio-rpc-usb-uart` 与 `CONFIG_ZMK_STUDIO=y`，通过专属 RPC 串口进行结构化通信。
* **功耗与优势**：
  - **由电脑 USB 提供 5V 电源**，完全不消耗键盘锂电池电量。
  - **完全绕过操作系统键盘驱动**：其他键盘敲击在此通道上没有任何数据，杜绝误触发。

### 2. BLE 蓝牙直连（BLE Bluetooth Direct）

* **底层技术**：基于 **Web Bluetooth API**（`navigator.bluetooth`），直接连接 ZMK 官方的 Studio GATT 服务。
  * **Service UUID**：`00000000-0196-6107-c967-c5cfb1c2482a`
  * **Characteristic UUID**：`00000001-0196-6107-c967-c5cfb1c2482a`
* **适用场景**：日常无线打字测试、分体蓝牙键盘测试、不插线便携测试。
* **工作机制**：
  - 键盘固件开启 `CONFIG_ZMK_STUDIO=y`。
  - 网页端建立专属 GATT 蓝牙会话，通过三字节转义分帧协议收发数据：
    * `0xAB`：帧起始（Start of Frame）
    * `0xAC`：转义字节（Escape Byte）
    * `0xAD`：帧结束（End of Frame）
* **功耗与优势**：
  - **完全兼容 Zephyr RTOS 的低功耗休眠机制**：不同于串口调试日志的死循环轮询，BLE GATT 服务是**纯事件驱动（Interrupt / Notification）**的。无按键时主控芯片正常进入微安级的深度睡眠（System OFF），**零多余耗电，完全不影响蓝牙键盘数月的正常续航**。

---

## 固件配置速查

| 想要实现的效果 | 推荐连接方式 | 固件端配置方式 | 耗电情况 |
| :--- | :--- | :--- | :--- |
| **组装/焊接测试**（测板、测轴） | **有线串口直读矩阵** | `config.conf` 添加 `CONFIG_ZMK_USB_LOGGING=y`<br>或 `build.yaml` 添加 `snippet: studio-rpc-usb-uart` | **零电池消耗**（电脑供电） |
| **无线日常测试**（杜绝其他键盘干扰）| **BLE蓝牙直连** | `config.conf` 添加 `CONFIG_ZMK_STUDIO=y` | **极低功耗**（芯片正常深度休眠） |
| **免改固件快速自测** | 直接按键输入 | 无需任何改动，直接打开网页即可测试 | 原生键盘续航 |

---

## 部署到 GitHub Pages

本项目为纯静态前端，无任何打包编译步骤：

1. Fork 或 Push 本仓库到你的 GitHub。
2. 进入仓库 **Settings -> Pages**。
3. **Build and deployment** 选择 **Deploy from a branch**，指定 `main` 分支根目录 `/ (root)`，点击保存。
4. 部署完成后即可通过 `https://<你的用户名>.github.io/<仓库名>/` 访问。
   * 支持通过 URL 参数直接预载配置：`https://<你的用户名>.github.io/<仓库名>/?config=https://github.com/a741725193/zmk-config-elashvelvet`

---

## 本地开发与测试

```bash
# 启动本地 HTTP 服务
python3 -m http.server 8080

# 运行自动化单元测试（测试 DTS 解析、几何旋转包围盒、双语对齐与 Studio 协议解帧）
node --test tests/zmk-parser.test.mjs
```
