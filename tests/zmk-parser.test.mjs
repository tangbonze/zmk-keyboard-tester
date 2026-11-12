import test from "node:test";
import assert from "node:assert/strict";

import {
  buildZmkConfigResult,
  deriveLayoutFromKeymapLines,
  extractShieldCandidates,
  parseBuildYaml,
  parseInfoJsonLayouts,
  parseKeymapLayers,
  parseMatrixTransformLayouts,
  parsePhysicalLayoutsFromDts,
  parseWestYml,
} from "../src/zmk-parser.js";
import { parseGitHubUrl } from "../src/github-loader.js";
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
