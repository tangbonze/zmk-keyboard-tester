import test from "node:test";
import assert from "node:assert/strict";

import {
  buildZmkConfigResult,
  deriveLayoutFromKeymapLines,
  extractShieldCandidates,
  normalizeLayoutBounds,
  parseBuildYaml,
  parseInfoJsonLayouts,
  parseKeymapLayers,
  parseMatrixTransformLayouts,
  parsePhysicalLayoutsFromDts,
  parseWestYml,
} from "../src/zmk-parser.js";
import { disambiguateBranchAndPath, parseGitHubUrl } from "../src/github-loader.js";
import { formatMessage, MESSAGES } from "../src/i18n.js";
import { SoundBeeper } from "../src/sound.js";
import { extractModifiedKeycode, keyboardEventToZmk } from "../src/zmk-keycodes.js";

test("parseGitHubUrl handles repo, tree, blob, raw, and shorthand URLs", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/foo/zmk-config"), {
    kind: "repo",
    owner: "foo",
    repo: "zmk-config",
    branch: null,
    path: null,
  });

  assert.deepEqual(
    parseGitHubUrl("https://github.com/zmkfirmware/zmk/blob/main/app/boards/shields/corne/corne.keymap"),
    {
      kind: "blob",
      owner: "zmkfirmware",
      repo: "zmk",
      branch: "main",
      path: "app/boards/shields/corne/corne.keymap",
    }
  );

  assert.deepEqual(
    parseGitHubUrl("https://raw.githubusercontent.com/foo/bar/dev/config/corne.keymap"),
    {
      kind: "raw",
      owner: "foo",
      repo: "bar",
      branch: "dev",
      path: "config/corne.keymap",
    }
  );

  assert.deepEqual(parseGitHubUrl("foo/zmk-config"), {
    kind: "repo",
    owner: "foo",
    repo: "zmk-config",
    branch: null,
    path: null,
  });

  // Branch & path disambiguation for branches with slashes
  const knownBranches = ["main", "36-trackball", "debug/touch-log", "feat/tps43-any-half"];
  assert.deepEqual(disambiguateBranchAndPath("debug/touch-log", knownBranches), {
    branch: "debug/touch-log",
    path: null,
  });
  assert.deepEqual(disambiguateBranchAndPath("debug/touch-log/config/velvet.keymap", knownBranches), {
    branch: "debug/touch-log",
    path: "config/velvet.keymap",
  });
  assert.deepEqual(disambiguateBranchAndPath("36-trackball/config/velvet.keymap", knownBranches), {
    branch: "36-trackball",
    path: "config/velvet.keymap",
  });
  assert.deepEqual(disambiguateBranchAndPath("unknown-branch/some/path", knownBranches), {
    branch: "unknown-branch",
    path: "some/path",
  });
});

test("parseKeymapLayers resolves #define macros, custom hold-tap, &lt, &bt, and &trans", () => {
  const keymap = `
    #include <behaviors.dtsi>
    #include <dt-bindings/zmk/keys.h>
    #define NAV 1
    #define HYPER(k) LS(LC(LA(LG(k))))

    / {
      chosen {
        zmk,physical-layout = &foostan_corne_5col_layout;
      };
      behaviors {
        hm: homerow_mods {
          compatible = "zmk,behavior-hold-tap";
          #binding-cells = <2>;
          bindings = <&kp>, <&kp>;
        };
      };
      keymap {
        compatible = "zmk,keymap";
        default_layer {
          display-name = "Base";
          bindings = <
            &kp Q       &kp W     &hm LGUI A &lt NAV SPACE &kp HYPER(T)
            &bt BT_SEL 0 &trans   &none      &kp ESC       &kp LCMD
          >;
        };
      };
    };
  `;

  const parsed = parseKeymapLayers(keymap, {}, "config/corne.keymap");
  assert.equal(parsed.chosen.physicalLayout, "foostan_corne_5col_layout");
  assert.equal(parsed.layers.length, 1);
  const bindings = parsed.layers[0].bindings;
  assert.equal(bindings.length, 10);

  assert.equal(bindings[0].tap, "Q");
  assert.equal(bindings[2].tap, "A");
  assert.equal(bindings[2].hold, "LGUI");
  assert.equal(bindings[3].tap, "SPACE");
  assert.equal(bindings[3].holdLayer, 1);
  assert.equal(bindings[4].tap, "LS(LC(LA(LG(T))))");
  assert.equal(bindings[5].displayTap, "BT 0");
  assert.equal(bindings[6].behavior, "trans");
  assert.equal(bindings[7].behavior, "none");
  assert.equal(bindings[9].tap, "LGUI");
});

test("parsePhysicalLayoutsFromDts parses &key_physical_attrs including negative rotations", () => {
  const dts = `
    / {
      foostan_corne_6col_layout: foostan_corne_6col_layout {
        compatible = "zmk,physical-layout";
        display-name = "6 Column";
        keys
          = <&key_physical_attrs 100 100    0   37       0     0     0>
          , <&key_physical_attrs 100 150  752  283  (-2400)  852   433>
          ;
      };
    };
  `;
  const layouts = parsePhysicalLayoutsFromDts(dts);
  assert.equal(layouts.length, 1);
  assert.equal(layouts[0].id, "foostan_corne_6col_layout");
  assert.equal(layouts[0].keys.length, 2);
  assert.equal(layouts[0].keys[1].w, 1);
  assert.equal(layouts[0].keys[1].h, 1.5);
  assert.equal(layouts[0].keys[1].x, 7.52);
  assert.equal(layouts[0].keys[1].r, -24);
  assert.equal(layouts[0].keys[1].rx, 8.52);
  assert.equal(layouts[0].keys[1].ry, 4.33);
});

test("parseInfoJsonLayouts, parseMatrixTransformLayouts, and deriveLayoutFromKeymapLines", () => {
  const info = JSON.stringify({
    keyboard_name: "Mini",
    layouts: {
      default: {
        layout: [
          { x: 0, y: 0 },
          { x: 1, y: 0, w: 1.5 },
        ],
      },
    },
  });
  const jLayouts = parseInfoJsonLayouts(info);
  assert.equal(jLayouts.length, 1);
  assert.equal(jLayouts[0].keys[1].w, 1.5);

  const mt = `
    / {
      default_transform: keymap_transform_0 {
        compatible = "zmk,matrix-transform";
        map = <RC(0,0) RC(0,1) RC(0,8) RC(0,9)>;
      };
    };
  `;
  const mtLayouts = parseMatrixTransformLayouts(mt);
  assert.equal(mtLayouts.length, 1);
  assert.equal(mtLayouts[0].keys[2].x, 8.8);

  const raw = `
    &kp Q &kp W   &kp E &kp R
    &kp A &kp S   &kp D &kp F
  `;
  const vis = deriveLayoutFromKeymapLines(raw);
  assert.equal(vis.keys.length, 8);
  assert.ok(vis.keys[2].x > vis.keys[1].x + 1.2);
});

test("parseBuildYaml, extractShieldCandidates, and parseWestYml", () => {
  const build = `
    include:
      - board: nice_nano_v2
        shield: crkbd_left nice_view_adapter nice_view
      - board: nice_nano_v2
        shield: settings_reset
  `;
  const targets = parseBuildYaml(build);
  const shields = extractShieldCandidates(targets, "config/crkbd.keymap");
  assert.ok(shields.includes("crkbd_left"));
  assert.ok(shields.includes("crkbd"));
  assert.ok(shields.includes("corne"));

  const west = `
    manifest:
      remotes:
        - name: zmkfirmware
          url-base: https://github.com/zmkfirmware
        - name: custom
          url-base: https://github.com/myorg
      projects:
        - name: zmk
          remote: zmkfirmware
          revision: main
        - name: zmk-keyball
          remote: custom
          revision: v2
  `;
  const repos = parseWestYml(west);
  assert.deepEqual(repos, [{ owner: "myorg", repo: "zmk-keyball", revision: "v2" }]);
});

test("buildZmkConfigResult resolves local physical layout matching key count", async () => {
  const files = {
    "config/myboard.keymap": `
      / {
        keymap {
          compatible = "zmk,keymap";
          base {
            bindings = <&kp Q &kp W &kp E &kp R>;
          };
        };
      };
    `,
    "boards/shields/myboard/myboard-layouts.dtsi": `
      / {
        my_layout: my_layout {
          compatible = "zmk,physical-layout";
          keys
            = <&key_physical_attrs 100 100 0 0 0 0 0>
            , <&key_physical_attrs 100 100 100 0 0 0 0>
            , <&key_physical_attrs 100 100 250 0 0 0 0>
            , <&key_physical_attrs 100 100 350 0 0 0 0>
            ;
        };
      };
    `,
  };

  const result = await buildZmkConfigResult({
    files,
    repoLabel: "user/myboard",
  });
  assert.equal(result.keyCount, 4);
  assert.equal(result.layout.source, "zmk,physical-layout");
  assert.equal(result.layout.keys.length, 4);
});

test("keyboardEventToZmk and extractModifiedKeycode map system & shifted keys", () => {
  assert.equal(keyboardEventToZmk({ code: "MetaLeft", key: "Meta" }), "LGUI");
  assert.equal(keyboardEventToZmk({ code: "AudioVolumeUp", key: "AudioVolumeUp" }), "C_VOL_UP");
  assert.equal(keyboardEventToZmk({ code: "Space", key: " " }), "SPACE");

  assert.deepEqual(extractModifiedKeycode("EXCL"), { mods: ["LSHFT"], base: "N1" });
  assert.deepEqual(extractModifiedKeycode("LC(TAB)"), { mods: ["LCTRL"], base: "TAB" });
});

test("SoundBeeper safely handles disabled mode and missing AudioContext", () => {
  const beeper = new SoundBeeper();
  assert.doesNotThrow(() => beeper.beepKey({ matched: true }));
  assert.doesNotThrow(() => beeper.beepKey({ matched: false }));
  assert.doesNotThrow(() => beeper.beepCompleted());
  beeper.enabled = false;
  assert.doesNotThrow(() => beeper.beepKey({ matched: true }));
});

test("i18n zh and en dictionaries have complete key parity and interpolation", () => {
  const zhKeys = Object.keys(MESSAGES.zh).sort();
  const enKeys = Object.keys(MESSAGES.en).sort();
  assert.deepEqual(zhKeys, enKeys);
  assert.equal(formatMessage("zh", "metaCoverage", { tested: 5, total: 42, pct: 12 }), "已测试 5 / 42 (12%)");
  assert.equal(formatMessage("en", "metaCoverage", { tested: 5, total: 42, pct: 12 }), "Tested 5 / 42 (12%)");
});

test("normalizeLayoutBounds accounts for key rotation geometry without inflating canvas bounds", () => {
  // A layout with rotated thumb keys where raw y is 9.92 but rotated y is ~5.32
  const layout = {
    id: "test_rot",
    name: "Rotated Test",
    keys: [
      { index: 0, w: 1, h: 1, x: 0, y: 0.63, r: 0, rx: 0, ry: 0 },
      { index: 1, w: 1, h: 1, x: 12.5, y: 0.25, r: 0, rx: 0, ry: 0 },
      { index: 2, w: 1, h: 1, x: 6.55, y: 9.92, r: -30, rx: 0, ry: 0 },
    ],
  };
  const norm = normalizeLayoutBounds(layout);
  // Without rotation calculation, maxY would be 9.92 + 1 = 10.92, heightU ~11.2
  // With visual rotation calculation, rotated y of key 2 is ~5.32, so heightU must be under 7u
  assert.ok(norm.heightU < 7.0, `Expected heightU < 7.0, got ${norm.heightU}`);
  assert.ok(norm.widthU > 12.0, `Expected widthU > 12.0, got ${norm.widthU}`);
  assert.equal(norm.keys.length, 3);
  assert.ok(norm.keys[0].x >= 0.2);
  assert.ok(norm.keys[0].y >= 0.2);
});
