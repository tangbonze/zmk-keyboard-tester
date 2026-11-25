<div align="center">

# ZMK KeyTester

**在线 ZMK 键盘物理布局与硬件直读测试器 / Online ZMK Keyboard Physical Layout & Hardware Matrix Tester**

[**简体中文**](./README.md) | [**English**](./README_EN.md)

</div>

---

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

## 物理矩阵连接原理

常规网页测试使用的是操作系统的全局键盘输入流，无法区分不同键盘，也无法识别 `&none`、层切换键（`&mo`/`&lt`）、Combo 或 Hold-Tap 背后真实的物理按键。

> **⚠️ 重要说明（物理矩阵识别必需模块）**：
> 原生 ZMK 固件默认只向上报逻辑键值（Keycode），不支持无 USB Logging 情况下直接上报物理矩阵位置。
> 若要使用本工具的 **「WebHID 物理矩阵」** 直读功能（直接定位按下哪一个物理轴体，无需开启 `CONFIG_ZMK_USB_LOGGING=y`），**必须在你的键盘固件中添加配套模块**：
> 👉 **[tangbonze/zmk-matrix-tester](https://github.com/tangbonze/zmk-matrix-tester)**
>
> 该模块通过独立的 USB Vendor Raw HID 接口（`HID_1`，`0xFF60 / 0x61`）工作：
> - **无线/电池续航零影响**：拔掉 USB 线后零代码执行、无定时器轮询、完全不干扰芯片深度休眠（Deep Sleep）。
> - **日常功能零干扰**：不修改标准键盘 `HID_0` 描述符与蓝牙功能；在测试期间支持静默拦截，避免测试按键向电脑乱输入字符。
> - **分体键盘全覆盖**：仅需在主机（Central）自动启用，即可同时识别左右手所有物理按键。

本项目提供了基于 WebHID 的硬件级物理矩阵直读通道：

```
                    ┌───────────────────────────┐
                    │       ZMK 键盘主控        │
                    │  (需安装 zmk-matrix-tester) │
                    └─────────────┬─────────────┘
                                  │
                     WebHID API (HID_1, 0xFF60)
                    直接上报物理 Position 与分体来源
                    无需 USB Logging / 无线零耗电
                                  │
                                  ▼
                   ┌──────────────────────────────┐
                   │    ZMK KeyTester 网页端      │
                   │  - 物理按键精准点亮          │
                   │  - 静默拦截防误触            │
                   │  - 蜂鸣提示音 & 覆盖率统计   │
                   └──────────────────────────────┘
```

### WebHID 物理矩阵直读（需 `zmk-matrix-tester` 模块）

* **底层技术**：基于 Chromium 原生 **WebHID API**（`navigator.hid`），连接模块创建的独立 Vendor HID 接口（`HID_1`，Usage Page `0xFF60` / Usage `0x61`）。
* **前置条件**：在你的 `zmk-config/config/west.yml` 中引入 [`tangbonze/zmk-matrix-tester`](https://github.com/tangbonze/zmk-matrix-tester) 并重新编译刷写固件（详见该模块仓库的中文/英文配置文档）。
* **工作机制**：
  - 在 `zmk_position_state_changed` 事件进入 `combo` / `hold-tap` / `keymap` 之前捕获最原始的物理按键编号 `position` 与分体来源 `source`。
  - 开启右上角 **「拦截按键」** 时，固件自动进入静默拦截模式（按键不会误触电脑快捷键）；取消勾选或关闭网页/拔线即自动恢复正常打字。
* **功耗与兼容性**：
  - **无线续航零影响**：未插 USB 或未打开测试网页时，模块不发送任何报告也不运行定时器。
  - **无需串口与驱动**：macOS / Windows / Linux 桌面版 Chrome / Edge 即插即用。

---

## 固件配置速查

| 想要实现的效果 | 连接方式 | 固件端配置方式 | 耗电/功能影响 |
| :--- | :--- | :--- | :--- |
| **精准识别物理矩阵（无 USB Logging）** | **WebHID 物理矩阵（推荐）** | `west.yml` 引入 **[tangbonze/zmk-matrix-tester](https://github.com/tangbonze/zmk-matrix-tester)** | **无线零耗电，支持静默测试** |
| **免改固件快速自测** | 直接按键输入 | 无需任何改动，直接打开网页即可测试 | 通过键值匹配，受层/Combo/空键限制 |

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
