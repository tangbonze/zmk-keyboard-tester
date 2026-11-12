/**
 * ZMK keycode normalization, display legends, and Browser KeyboardEvent <-> ZMK mapping.
 */

export const ZMK_KEY_ALIASES = {
  // Numbers
  NUMBER_0: "N0", NUMBER_1: "N1", NUMBER_2: "N2", NUMBER_3: "N3", NUMBER_4: "N4",
  NUMBER_5: "N5", NUMBER_6: "N6", NUMBER_7: "N7", NUMBER_8: "N8", NUMBER_9: "N9",
  // Shifted symbol aliases
  EXCLAMATION: "EXCL",
  AT_SIGN: "AT",
  POUND: "HASH",
  DOLLAR: "DLLR",
  PERCENT: "PRCNT",
  AMPERSAND: "AMPS",
  ASTRK: "STAR",
  ASTERISK: "STAR",
  LEFT_PARENTHESIS: "LPAR",
  RIGHT_PARENTHESIS: "RPAR",
  UNDERSCORE: "UNDER",
  LEFT_BRACE: "LBRC",
  RIGHT_BRACE: "RBRC",
  DOUBLE_QUOTES: "DQT",
  LESS_THAN: "LT",
  GREATER_THAN: "GT",
  QUESTION: "QMARK",
  // Punctuation
  LEFT_BRACKET: "LBKT",
  RIGHT_BRACKET: "RBKT",
  BACKSLASH: "BSLH",
  SEMICOLON: "SEMI",
  APOS: "SQT",
  APOSTROPHE: "SQT",
  SINGLE_QUOTE: "SQT",
  PERIOD: "DOT",
  SLASH: "FSLH",
  // Navigation & Editing
  ESCAPE: "ESC",
  RETURN: "RET",
  ENTER: "RET",
  BACKSPACE: "BSPC",
  DELETE: "DEL",
  INSERT: "INS",
  PAGE_UP: "PG_UP",
  PAGE_DOWN: "PG_DN",
  UP_ARROW: "UP",
  DOWN_ARROW: "DOWN",
  LEFT_ARROW: "LEFT",
  RIGHT_ARROW: "RIGHT",
  CAPSLOCK: "CAPS",
  CLCK: "CAPS",
  PRINTSCREEN: "PSCRN",
  SCROLLLOCK: "SLCK",
  // Modifiers
  LSHIFT: "LSHFT", LEFT_SHIFT: "LSHFT",
  RSHIFT: "RSHFT", RIGHT_SHIFT: "RSHFT",
  LCTL: "LCTRL", LEFT_CONTROL: "LCTRL",
  RCTL: "RCTRL", RIGHT_CONTROL: "RCTRL",
  LOPT: "LALT", LEFT_ALT: "LALT", LEFT_OPTION: "LALT",
  ROPT: "RALT", RIGHT_ALT: "RALT", RIGHT_OPTION: "RALT",
  LCMD: "LGUI", LMETA: "LGUI", LWIN: "LGUI", LEFT_GUI: "LGUI", LEFT_COMMAND: "LGUI",
  RCMD: "RGUI", RMETA: "RGUI", RWIN: "RGUI", RIGHT_GUI: "RGUI", RIGHT_COMMAND: "RGUI",
  GLOBE: "FN",
  K_APPLICATION: "K_APP", K_CMENU: "K_APP", APP: "K_APP",
  // Keypad
  KP_NUMBER_0: "KP_N0", KP_NUMBER_1: "KP_N1", KP_NUMBER_2: "KP_N2",
  KP_NUMBER_3: "KP_N3", KP_NUMBER_4: "KP_N4", KP_NUMBER_5: "KP_N5",
  KP_NUMBER_6: "KP_N6", KP_NUMBER_7: "KP_N7", KP_NUMBER_8: "KP_N8",
  KP_NUMBER_9: "KP_N9",
  KP_ASTERISK: "KP_MULTIPLY",
  KP_SUBTRACT: "KP_MINUS",
  KP_ADD: "KP_PLUS",
  KP_NUMLOCK: "KP_NUM",
  // Media / Consumer
  C_VOLUME_UP: "C_VOL_UP",
  C_VOLUME_DOWN: "C_VOL_DN",
  C_PLAY_PAUSE: "C_PP",
  C_PREVIOUS: "C_PREV",
  C_BRIGHTNESS_INC: "C_BRI_UP",
  C_BRIGHTNESS_DEC: "C_BRI_DN",
  C_FAST_FORWARD: "C_FF",
  C_REWIND: "C_RW",
};

export const SHIFTED_KEY_BASE = {
  EXCL: "N1", AT: "N2", HASH: "N3", DLLR: "N4", PRCNT: "N5",
  CARET: "N6", AMPS: "N7", STAR: "N8", LPAR: "N9", RPAR: "N0",
  UNDER: "MINUS", PLUS: "EQUAL", LBRC: "LBKT", RBRC: "RBKT",
  PIPE: "BSLH", COLON: "SEMI", DQT: "SQT", TILDE: "GRAVE",
  LT: "COMMA", GT: "DOT", QMARK: "FSLH",
};

export const KEY_DISPLAY_LABELS = {
  N0: "0", N1: "1", N2: "2", N3: "3", N4: "4",
  N5: "5", N6: "6", N7: "7", N8: "8", N9: "9",
  EXCL: "!", AT: "@", HASH: "#", DLLR: "$", PRCNT: "%",
  CARET: "^", AMPS: "&", STAR: "*", LPAR: "(", RPAR: ")",
  MINUS: "-", UNDER: "_", EQUAL: "=", PLUS: "+",
  LBKT: "[", LBRC: "{", RBKT: "]", RBRC: "}",
  BSLH: "\\", PIPE: "|", SEMI: ";", COLON: ":",
  SQT: "'", DQT: "\"", GRAVE: "`", TILDE: "~",
  COMMA: ",", LT: "<", DOT: ".", GT: ">",
  FSLH: "/", QMARK: "?",
  SPACE: "␣", RET: "⏎", BSPC: "⌫", DEL: "⌦",
  TAB: "⇥", ESC: "Esc", CAPS: "⇪", INS: "Ins",
  UP: "↑", DOWN: "↓", LEFT: "←", RIGHT: "→",
  PG_UP: "PgUp", PG_DN: "PgDn", HOME: "Home", END: "End",
  LSHFT: "⇧", RSHFT: "⇧R",
  LCTRL: "⌃", RCTRL: "⌃R",
  LALT: "⌥", RALT: "⌥R",
  LGUI: "⌘", RGUI: "⌘R",
  FN: "Fn", K_APP: "Menu",
  NON_US_BSLH: "\\|",
  C_VOL_UP: "Vol+", C_VOL_DN: "Vol-", C_MUTE: "Mute",
  C_PP: "Play", C_NEXT: "Next", C_PREV: "Prev", C_STOP: "Stop",
  C_BRI_UP: "Bri+", C_BRI_DN: "Bri-",
  C_FF: "FF", C_RW: "RW", C_EJECT: "Eject",
  PSCRN: "PrtSc", SLCK: "ScrLk", PAUSE_BREAK: "Pause",
  KP_N0: "KP0", KP_N1: "KP1", KP_N2: "KP2", KP_N3: "KP3", KP_N4: "KP4",
  KP_N5: "KP5", KP_N6: "KP6", KP_N7: "KP7", KP_N8: "KP8", KP_N9: "KP9",
  KP_DOT: "KP.", KP_ENTER: "KPEnt", KP_PLUS: "KP+", KP_MINUS: "KP-",
  KP_MULTIPLY: "KP*", KP_DIVIDE: "KP/", KP_EQUAL: "KP=", KP_NUM: "Num",
};

// Browser KeyboardEvent.code -> ZMK canonical keycode
export const BROWSER_CODE_TO_ZMK = {
  // Letters
  KeyA: "A", KeyB: "B", KeyC: "C", KeyD: "D", KeyE: "E",
  KeyF: "F", KeyG: "G", KeyH: "H", KeyI: "I", KeyJ: "J",
  KeyK: "K", KeyL: "L", KeyM: "M", KeyN: "N", KeyO: "O",
  KeyP: "P", KeyQ: "Q", KeyR: "R", KeyS: "S", KeyT: "T",
  KeyU: "U", KeyV: "V", KeyW: "W", KeyX: "X", KeyY: "Y",
  KeyZ: "Z",
  // Digits
  Digit0: "N0", Digit1: "N1", Digit2: "N2", Digit3: "N3", Digit4: "N4",
  Digit5: "N5", Digit6: "N6", Digit7: "N7", Digit8: "N8", Digit9: "N9",
  // Punctuation
  Minus: "MINUS", Equal: "EQUAL",
  BracketLeft: "LBKT", BracketRight: "RBKT", Backslash: "BSLH",
  Semicolon: "SEMI", Quote: "SQT", Backquote: "GRAVE",
  Comma: "COMMA", Period: "DOT", Slash: "FSLH",
  IntlBackslash: "NON_US_BSLH",
  // Control / Navigation
  Enter: "RET", Tab: "TAB", Space: "SPACE",
  Backspace: "BSPC", Escape: "ESC", Delete: "DEL",
  Insert: "INS", Home: "HOME", End: "END",
  PageUp: "PG_UP", PageDown: "PG_DN",
  ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT",
  CapsLock: "CAPS", PrintScreen: "PSCRN", ScrollLock: "SLCK", Pause: "PAUSE_BREAK",
  ContextMenu: "K_APP",
  // Modifiers
  ShiftLeft: "LSHFT", ShiftRight: "RSHFT",
  ControlLeft: "LCTRL", ControlRight: "RCTRL",
  AltLeft: "LALT", AltRight: "RALT",
  MetaLeft: "LGUI", MetaRight: "RGUI",
  OSLeft: "LGUI", OSRight: "RGUI",
  Fn: "FN",
  // Function keys
  F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6",
  F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12",
  F13: "F13", F14: "F14", F15: "F15", F16: "F16", F17: "F17", F18: "F18",
  F19: "F19", F20: "F20", F21: "F21", F22: "F22", F23: "F23", F24: "F24",
  // Numpad
  Numpad0: "KP_N0", Numpad1: "KP_N1", Numpad2: "KP_N2", Numpad3: "KP_N3",
  Numpad4: "KP_N4", Numpad5: "KP_N5", Numpad6: "KP_N6", Numpad7: "KP_N7",
  Numpad8: "KP_N8", Numpad9: "KP_N9",
  NumpadDecimal: "KP_DOT", NumpadEnter: "KP_ENTER",
  NumpadAdd: "KP_PLUS", NumpadSubtract: "KP_MINUS",
  NumpadMultiply: "KP_MULTIPLY", NumpadDivide: "KP_DIVIDE",
  NumpadEqual: "KP_EQUAL", NumLock: "KP_NUM",
  // Media keys
  AudioVolumeUp: "C_VOL_UP", VolumeUp: "C_VOL_UP",
  AudioVolumeDown: "C_VOL_DN", VolumeDown: "C_VOL_DN",
  AudioVolumeMute: "C_MUTE", VolumeMute: "C_MUTE",
  MediaPlayPause: "C_PP", MediaTrackNext: "C_NEXT", MediaTrackPrevious: "C_PREV",
  MediaStop: "C_STOP", Eject: "C_EJECT",
};

export const BROWSER_KEY_TO_ZMK = {
  AudioVolumeUp: "C_VOL_UP",
  AudioVolumeDown: "C_VOL_DN",
  AudioVolumeMute: "C_MUTE",
  MediaPlayPause: "C_PP",
  MediaTrackNext: "C_NEXT",
  MediaTrackPrevious: "C_PREV",
  MediaStop: "C_STOP",
  BrightnessUp: "C_BRI_UP",
  BrightnessDown: "C_BRI_DN",
  Meta: "LGUI",
  OS: "LGUI",
  Alt: "LALT",
  Control: "LCTRL",
  Shift: "LSHFT",
  ContextMenu: "K_APP",
};

export function canonicalZmkKey(tok) {
  const clean = (tok || "").trim();
  return ZMK_KEY_ALIASES[clean] || clean;
}

export function displayForKey(tok) {
  const canon = canonicalZmkKey(tok);
  if (KEY_DISPLAY_LABELS[canon]) return KEY_DISPLAY_LABELS[canon];
  const m = canon.match(/^(LS|RS|LC|RC|LA|RA|LG|RG)\((.+)\)$/);
  if (m) {
    const prefixMap = {
      LS: "⇧+", RS: "⇧R+",
      LC: "⌃+", RC: "⌃R+",
      LA: "⌥+", RA: "⌥R+",
      LG: "⌘+", RG: "⌘R+",
    };
    return prefixMap[m[1]] + displayForKey(m[2]);
  }
  return canon;
}

/**
 * Unwrap nested modifier wrappers e.g. LS(LC(A)) -> { mods: ['LSHFT', 'LCTRL'], base: 'A' }.
 */
export function extractModifiedKeycode(tok) {
  const mods = [];
  let cur = (tok || "").trim();
  const modMap = {
    LS: "LSHFT", RS: "RSHFT",
    LC: "LCTRL", RC: "RCTRL",
    LA: "LALT", RA: "RALT",
    LG: "LGUI", RG: "RGUI",
  };
  while (true) {
    const m = cur.match(/^(LS|RS|LC|RC|LA|RA|LG|RG)\((.+)\)$/);
    if (!m) break;
    mods.push(modMap[m[1]]);
    cur = m[2].trim();
  }
  cur = canonicalZmkKey(cur);
  if (SHIFTED_KEY_BASE[cur]) {
    if (!mods.includes("LSHFT") && !mods.includes("RSHFT")) {
      mods.push("LSHFT");
    }
    cur = SHIFTED_KEY_BASE[cur];
  }
  return { mods, base: cur };
}

/**
 * Map a Browser KeyboardEvent to a ZMK canonical keycode.
 */
export function keyboardEventToZmk(e) {
  if (e.code && BROWSER_CODE_TO_ZMK[e.code]) {
    return BROWSER_CODE_TO_ZMK[e.code];
  }
  if (e.key && BROWSER_KEY_TO_ZMK[e.key]) {
    return BROWSER_KEY_TO_ZMK[e.key];
  }
  if (e.key && e.key.length === 1) {
    const upper = e.key.toUpperCase();
    if (/^[A-Z]$/.test(upper)) return upper;
    if (/^[0-9]$/.test(upper)) return `N${upper}`;
  }
  return e.code || e.key || "UNKNOWN";
}
