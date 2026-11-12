# ZMK KeyTester — 基于浏览器的 ZMK 键盘在线测试器

专为 **ZMK 固件键盘**（USB / 蓝牙连接）打造的纯前端网页测试工具，零构建依赖，可直接托管在 **GitHub Pages** 上使用。

## 核心功能

1. **读取 ZMK Config 链接并自动还原物理布局**
   - 支持直接输入任意 GitHub `zmk-config` 仓库链接、`tree` / `blob` / `raw` 链接，或上传本地 `zmk-config` 文件夹 / 拖放 `.keymap` 文件。
   - 自动解析 `.keymap`（含 `#define` 宏、`#include`、自定义 `hold-tap` / `&mt` / `&lt` / `&hm` / `&bt` / 组合键等）与多图层定义。
   - 自动按优先级查找并还原真实物理键位与旋转角度（如 Corne、Sofle、Lily58、Sweep 等分体键盘的拇指区倾斜角度）：
     1. 仓库内的 `zmk,physical-layout`（`&key_physical_attrs`）或 `info.json`
     2. `config/west.yml` 中引用的外部模块仓库
     3. 官方 `zmkfirmware/zmk` 上游 shield 与 `dts/layouts`
     4. `zmk,matrix-transform`（`RC(r,c)`）或 `.keymap` 排布自动推导
2. **实时按键亮起与多图层自动匹配**
   - USB 或蓝牙键盘按下任意键时，对应键帽实时亮起（区分 Tap 触发与 Hold 修饰触发），并记录 **已测试键位覆盖率 (`X / N`)**。
   - 支持 **自动切换层**：当你在实体键盘上按住切层键并按下其他层的按键（如数字、方向键、媒体键、符号键）时，界面自动切换到对应层并点亮按键。
   - 支持复合键位（如 `&kp EXCL`、`&kp LC(TAB)`）匹配。
3. **系统按键拦截（浏览器能力最大化）**
   - 测试模式下默认全局捕获并拦截 `Tab`、`Space`、`方向键`、`F1-F12`、翻页键、`ContextMenu` 等浏览器默认行为。
   - 点击右上角 **「全屏锁定系统键」**（推荐 Chrome / Edge 桌面端），启用浏览器 `navigator.keyboard.lock()` 全屏键盘锁，进一步拦截 `Esc`（需长按退出）、`Meta/Cmd/Win`、`Cmd+W` / `Ctrl+W` / `Ctrl+T` 等系统与浏览器快捷键。
   - 当焦点位于链接输入框时自动暂停拦截，方便粘贴链接。
4. **USB / 蓝牙设备识别（WebHID）**
   - 在支持的浏览器（Chrome / Edge）中，可点击 **「识别 USB / 蓝牙键盘」** 通过 WebHID 查看当前连接的键盘名称与 VID/PID，并监听部分 Consumer 媒体控制上报。

> **关于系统键拦截的浏览器边界说明**：由于操作系统安全机制，诸如 macOS 的 `Cmd+Tab`、`Cmd+Space`（Spotlight）或 Windows 的 `Ctrl+Alt+Del`、`Win+L` 等内核级热键无法被任何浏览器网页完全接管；使用 Chrome/Edge 的 **全屏锁定系统键** 模式可获得浏览器允许的最高拦截级别。

## 部署到 GitHub Pages

本项目为纯静态 HTML + CSS + ES Modules，无需编译打包：

1. 将本仓库推送到你的 GitHub 仓库（例如 `zmk-keyboard-tester`）。
2. 打开仓库的 **Settings -> Pages**。
3. 在 **Build and deployment** 中选择 **Deploy from a branch**，分支选 `main`，目录选 `/ (root)`，保存即可。
4. 几秒后即可通过 `https://<你的用户名>.github.io/<仓库名>/` 访问（还支持 URL 参数直达，例如 `?config=https://github.com/你的用户名/zmk-config`）。

## 本地运行预览

```bash
python3 -m http.server 8080
# 然后浏览器打开 http://localhost:8080
```

## 运行单元测试

```bash
node --test tests/zmk-parser.test.mjs
```
