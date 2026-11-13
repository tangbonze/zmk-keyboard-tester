/**
 * Browser-based CORS-compatible loader for GitHub zmk-config repositories,
 * raw .keymap URLs, upstream zmkfirmware/zmk layouts, and local folders.
 */

import {
  buildZmkConfigResult,
  parseInfoJsonLayouts,
  parseMatrixTransformLayouts,
  parsePhysicalLayoutsFromDts,
  pickBestLayout,
} from "./zmk-parser.js?v=6";

const RELEVANT_EXTS = [
  ".keymap",
  ".dtsi",
  ".dts",
  ".overlay",
  ".yaml",
  ".yml",
  ".json",
  ".h",
];

function isRelevantPath(path) {
  const low = path.toLowerCase();
  return RELEVANT_EXTS.some((ext) => low.endsWith(ext));
}

export function parseGitHubUrl(input) {
  const url = (input || "").trim();
  if (!url) return null;

  // Shorthand owner/repo
  const shortMatch = url.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shortMatch) {
    return {
      kind: "repo",
      owner: shortMatch[1],
      repo: shortMatch[2],
      branch: null,
      path: null,
    };
  }

  // raw.githubusercontent.com/owner/repo/branch/path
  const rawMatch = url.match(
    /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/
  );
  if (rawMatch) {
    return {
      kind: "raw",
      owner: rawMatch[1],
      repo: rawMatch[2],
      branch: rawMatch[3],
      path: rawMatch[4],
    };
  }

  // github.com/owner/repo/(tree|blob)/branch/path?
  const ghMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(tree|blob)\/(.+))?\/?$/
  );
  if (ghMatch) {
    const kind = ghMatch[3] || "repo";
    const remainder = ghMatch[4] || null;
    let branch = null;
    let path = null;
    if (remainder) {
      if (kind === "blob") {
        const slash = remainder.indexOf("/");
        if (slash !== -1) {
          branch = remainder.slice(0, slash);
          path = remainder.slice(slash + 1);
        } else {
          path = remainder;
        }
      } else {
        branch = remainder;
      }
    }
    return {
      kind,
      owner: ghMatch[1],
      repo: ghMatch[2],
      branch,
      path,
    };
  }

  return null;
}

export function disambiguateBranchAndPath(remainder, knownBranches = []) {
  if (!remainder) return { branch: null, path: null };
  const sorted = [...knownBranches].sort((a, b) => b.length - a.length);
  for (const br of sorted) {
    if (remainder === br) return { branch: br, path: null };
    if (remainder.startsWith(br + "/")) {
      return { branch: br, path: remainder.slice(br.length + 1) };
    }
  }
  const slash = remainder.indexOf("/");
  if (slash === -1) return { branch: remainder, path: null };
  return { branch: remainder.slice(0, slash), path: remainder.slice(slash + 1) };
}

export async function getGitHubBranches(owner, repo, token = null) {
  try {
    const list = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
      token
    );
    if (Array.isArray(list)) {
      return list.map((b) => b.name);
    }
  } catch {
    // Non-fatal if branches listing fails (e.g. rate limit, offline)
  }
  return [];
}

export async function getGitHubRepoInfo(owner, repo, token = null) {
  try {
    const info = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}`,
      token
    );
    return info && typeof info === "object" ? info : null;
  } catch {
    return null;
  }
}

async function fetchJson(url, token = null) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status} (${url})`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

async function fetchRawText(url) {
  const resp = await fetch(url);
  if (!resp.ok) return null;
  return resp.text();
}

async function getGitHubTree(owner, repo, branch = null, token = null) {
  const branchesToTry = branch ? [branch] : ["HEAD", "main", "master"];
  let lastErr = null;
  for (const br of branchesToTry) {
    try {
      const data = await fetchJson(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(br)}?recursive=1`,
        token
      );
      if (data && Array.isArray(data.tree)) {
        // Resolve actual commit SHA or branch for raw URLs
        return { ref: br === "HEAD" ? data.sha : br, tree: data.tree };
      }
    } catch (e) {
      lastErr = e;
      if (e.status === 403 || e.status === 429) {
        throw new Error(
          "GitHub API 匿名请求次数已达上限 (60次/小时)。可在高级选项中填入 GitHub Token，或直接上传本地 zmk-config 文件夹。"
        );
      }
    }
  }
  throw lastErr || new Error(`无法访问仓库 ${owner}/${repo}`);
}

async function fetchFilesFromRepo(owner, repo, ref, paths) {
  const files = {};
  const batchSize = 8;
  for (let i = 0; i < paths.length; i += batchSize) {
    const chunk = paths.slice(i, i + batchSize);
    await Promise.all(
      chunk.map(async (p) => {
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${p}`;
        const txt = await fetchRawText(url);
        if (txt !== null) files[p] = txt;
      })
    );
  }
  return files;
}

async function fetchUpstreamAndModuleLayouts({
  shieldCandidates,
  includes,
  targetKeyCount,
  chosenLayoutId,
  chosenTransformId,
  westRepos,
  token,
}) {
  // Stage 2: External west.yml module repositories
  for (const mod of westRepos.slice(0, 3)) {
    try {
      const { ref, tree } = await getGitHubTree(
        mod.owner,
        mod.repo,
        mod.revision === "HEAD" ? null : mod.revision,
        token
      );
      const layoutPaths = tree
        .filter((item) => item.type === "blob" && isRelevantPath(item.path))
        .map((item) => item.path)
        .filter((p) => {
          const low = p.toLowerCase();
          if (low.endsWith("layouts.dtsi") || low.endsWith("info.json")) return true;
          return shieldCandidates.some((s) => low.includes(s));
        })
        .slice(0, 16);

      if (layoutPaths.length > 0) {
        const modFiles = await fetchFilesFromRepo(mod.owner, mod.repo, ref, layoutPaths);
        const modLayouts = [];
        const modTransforms = [];
        for (const [p, txt] of Object.entries(modFiles)) {
          const low = p.toLowerCase();
          if (low.endsWith(".json")) modLayouts.push(...parseInfoJsonLayouts(txt, p));
          else {
            modLayouts.push(...parsePhysicalLayoutsFromDts(txt));
            modTransforms.push(...parseMatrixTransformLayouts(txt));
          }
        }
        const matched =
          pickBestLayout(modLayouts, targetKeyCount, chosenLayoutId) ||
          pickBestLayout(modTransforms, targetKeyCount, chosenTransformId);
        if (matched) return matched;
      }
    } catch {
      // Ignore individual module fetch failures and continue to upstream ZMK
    }
  }

  // Stage 3: Upstream zmkfirmware/zmk raw files (zero API rate limit!)
  const fetchedDts = [];
  const fetchedSet = new Set();

  const fetchZmkRaw = async (relPath) => {
    if (fetchedSet.has(relPath)) return null;
    fetchedSet.add(relPath);
    const txt = await fetchRawText(`https://raw.githubusercontent.com/zmkfirmware/zmk/main/${relPath}`);
    if (txt) fetchedDts.push(txt);
    return txt;
  };

  for (const inc of includes) {
    if (inc.startsWith("layouts/")) {
      await fetchZmkRaw(`app/dts/${inc}`);
    }
  }

  // Known upstream layout node IDs (for boards like corneish_zen that reference layouts without #include in .keymap)
  const knownLayoutPaths = {
    foostan_corne_5col_layout: "app/dts/layouts/foostan/corne/5column.dtsi",
    foostan_corne_6col_layout: "app/dts/layouts/foostan/corne/6column.dtsi",
    josefadamcik_sofle_layout: "app/dts/layouts/josefadamcik/sofle/default.dtsi",
    kata0510_lily58_layout: "app/dts/layouts/kata0510/lily58/default.dtsi",
  };
  if (chosenLayoutId && knownLayoutPaths[chosenLayoutId]) {
    await fetchZmkRaw(knownLayoutPaths[chosenLayoutId]);
  }

  for (const shield of shieldCandidates) {
    const base = `app/boards/shields/${shield}`;
    const candidates = [
      `${base}/${shield}-layouts.dtsi`,
      `${base}/${shield}.dtsi`,
      `${base}/${shield}.overlay`,
    ];
    let foundAny = false;
    for (const c of candidates) {
      const txt = await fetchZmkRaw(c);
      if (txt) {
        foundAny = true;
        const incMatches = [...txt.matchAll(/#include\s+<([^>]+)>/g)];
        for (const im of incMatches) {
          if (im[1].startsWith("layouts/")) {
            await fetchZmkRaw(`app/dts/${im[1]}`);
          }
        }
      }
    }
    if (foundAny) break;
  }

  const upstreamLayouts = [];
  const upstreamTransforms = [];
  for (const txt of fetchedDts) {
    upstreamLayouts.push(...parsePhysicalLayoutsFromDts(txt));
    upstreamTransforms.push(...parseMatrixTransformLayouts(txt));
  }

  return (
    pickBestLayout(upstreamLayouts, targetKeyCount, chosenLayoutId) ||
    pickBestLayout(upstreamTransforms, targetKeyCount, chosenTransformId) ||
    null
  );
}

/**
 * Load and parse a ZMK config from a GitHub URL (repo / tree / blob / raw).
 */
export async function loadZmkFromGitHub(
  url,
  { token = null, preferredKeymap = null, preferredBranch = null } = {}
) {
  const gh = parseGitHubUrl(url);
  if (!gh) {
    throw new Error(
      "无法识别该链接格式。请输入 GitHub 仓库链接 (如 https://github.com/owner/zmk-config) 或 .keymap 链接。"
    );
  }

  const repoLabel = `${gh.owner}/${gh.repo}`;

  let availableBranches = [];
  let defaultBranch = null;
  if (gh.kind !== "raw") {
    try {
      const [branches, repoInfo] = await Promise.all([
        getGitHubBranches(gh.owner, gh.repo, token),
        getGitHubRepoInfo(gh.owner, gh.repo, token),
      ]);
      availableBranches = branches || [];
      defaultBranch =
        repoInfo?.default_branch ||
        (availableBranches.includes("main")
          ? "main"
          : availableBranches.includes("master")
          ? "master"
          : availableBranches[0] || null);
    } catch {
      // Non-fatal if branches listing fails
    }
  }

  let targetBranch = preferredBranch || gh.branch;
  let targetPath = gh.path;
  const rawRemainder = gh.path ? `${gh.branch}/${gh.path}` : gh.branch;
  if (!preferredBranch && availableBranches.length > 0 && rawRemainder) {
    const resolved = disambiguateBranchAndPath(rawRemainder, availableBranches);
    if (resolved.branch) {
      targetBranch = resolved.branch;
      targetPath = resolved.path;
    }
  }

  const activeBranch = targetBranch || defaultBranch || "HEAD";

  if (defaultBranch && !availableBranches.includes(defaultBranch)) {
    availableBranches.unshift(defaultBranch);
  }
  if (activeBranch && activeBranch !== "HEAD" && !availableBranches.includes(activeBranch)) {
    availableBranches.push(activeBranch);
  }

  // Direct raw file link OR direct blob/.keymap link (fast path, zero API quota, avoids monorepo tree truncation)
  if ((gh.kind === "raw" || gh.kind === "blob") && targetPath && targetPath.toLowerCase().endsWith(".keymap")) {
    const branch = activeBranch;
    const mainText = await fetchRawText(
      `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${branch}/${targetPath}`
    );
    if (!mainText) throw new Error(`无法读取文件: ${url}`);

    const files = { [targetPath]: mainText };
    const dir = targetPath.includes("/") ? targetPath.slice(0, targetPath.lastIndexOf("/")) : "";

    // Fetch companion metadata & local includes in parallel without hitting REST API
    const extraPaths = new Set(["build.yaml", "build.yml", "config/west.yml"]);
    for (const m of mainText.matchAll(/#include\s+[<"]([^>"]+)[>"]/g)) {
      const inc = m[1];
      if (!inc.startsWith("dt-bindings/") && inc !== "behaviors.dtsi") {
        if (dir) extraPaths.add(`${dir}/${inc}`);
        extraPaths.add(`config/${inc}`);
        extraPaths.add(inc);
      }
    }
    // Also probe same-directory layout/dtsi/json files for shield folders (e.g. sofle.dtsi)
    const baseName = targetPath.split("/").pop().replace(/\.keymap$/i, "");
    if (dir) {
      extraPaths.add(`${dir}/${baseName}.dtsi`);
      extraPaths.add(`${dir}/${baseName}-layouts.dtsi`);
      extraPaths.add(`${dir}/${baseName}.json`);
      extraPaths.add(`${dir}/info.json`);
    }

    await Promise.all(
      Array.from(extraPaths).map(async (p) => {
        if (files[p]) return;
        const txt = await fetchRawText(
          `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${branch}/${p}`
        );
        if (txt !== null) files[p] = txt;
      })
    );

    const result = await buildZmkConfigResult({
      files,
      repoLabel,
      preferredKeymap: targetPath,
      fetchExternalLayouts: (args) => fetchUpstreamAndModuleLayouts({ ...args, token }),
    });

    return {
      ...result,
      owner: gh.owner,
      repo: gh.repo,
      branches: availableBranches,
      currentBranch: activeBranch,
      defaultBranch,
    };
  }

  const { ref, tree } = await getGitHubTree(gh.owner, gh.repo, activeBranch, token);
  const allRelevant = tree
    .filter((item) => item.type === "blob" && isRelevantPath(item.path))
    .map((item) => item.path);

  if (allRelevant.length === 0) {
    throw new Error(`仓库 ${repoLabel} 中未找到 .keymap 或相关配置文件。`);
  }

  // Cap downloaded files if repo is unusually large, prioritizing config/ and boards/
  const prioritized = [...allRelevant].sort((a, b) => {
    const score = (p) => {
      if (p.endsWith(".keymap")) return 0;
      if (p.startsWith("config/")) return 1;
      if (p === "build.yaml" || p === "build.yml") return 1;
      if (p.startsWith("boards/")) return 2;
      return 3;
    };
    return score(a) - score(b) || a.localeCompare(b);
  });

  const files = await fetchFilesFromRepo(gh.owner, gh.repo, ref, prioritized.slice(0, 60));

  const targetKeymap =
    preferredKeymap ||
    (targetPath && targetPath.endsWith(".keymap") && files[targetPath] ? targetPath : null);

  const result = await buildZmkConfigResult({
    files,
    repoLabel,
    preferredKeymap: targetKeymap,
    fetchExternalLayouts: (args) => fetchUpstreamAndModuleLayouts({ ...args, token }),
  });

  return {
    ...result,
    owner: gh.owner,
    repo: gh.repo,
    branches: availableBranches,
    currentBranch: activeBranch,
    defaultBranch,
  };
}

/**
 * Load and parse a ZMK config from browser FileList (folder upload or single .keymap file).
 */
export async function loadZmkFromFileList(fileList, { preferredKeymap = null } = {}) {
  const files = {};
  for (const file of Array.from(fileList)) {
    const rel = file.webkitRelativePath || file.name;
    // Strip top-level folder prefix if webkitRelativePath includes it
    const normalized = rel.includes("/") ? rel.split("/").slice(1).join("/") || rel : rel;
    if (isRelevantPath(normalized) && file.size < 2_000_000) {
      files[normalized] = await file.text();
    }
  }
  const firstFile = fileList[0];
  const label =
    firstFile && firstFile.webkitRelativePath
      ? firstFile.webkitRelativePath.split("/")[0]
      : firstFile?.name || "本地配置";

  return buildZmkConfigResult({
    files,
    repoLabel: label,
    preferredKeymap,
    fetchExternalLayouts: (args) => fetchUpstreamAndModuleLayouts({ ...args, token: null }),
  });
}

/**
 * Parse raw pasted .keymap text directly.
 */
export async function loadZmkFromRawText(keymapText, name = "custom.keymap") {
  const files = { [`config/${name}`]: keymapText };
  return buildZmkConfigResult({
    files,
    repoLabel: "自定义 Keymap",
    preferredKeymap: `config/${name}`,
    fetchExternalLayouts: (args) => fetchUpstreamAndModuleLayouts({ ...args, token: null }),
  });
}
