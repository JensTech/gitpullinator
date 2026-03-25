import { useState, useCallback } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";

//  Helpers 

function parseGitUrl(url) {
  url = url.trim().replace(/\.git$/, "");
  const gh = url.match(/github\.com[/:]([^/]+)\/([^/#?]+)/);
  if (gh) return { host: "github", owner: gh[1], repo: gh[2] };
  return null;
}

async function fetchGithubTree(owner, repo, token, branch) {
  const h = token ? { Authorization: `token ${token}` } : {};
  if (!branch) {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: h });
    if (!r.ok) throw new Error(`Repo not found (${r.status}). Is it private? Add a token.`);
    const d = await r.json();
    branch = d.default_branch;
  }
  const r2 = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers: h }
  );
  if (!r2.ok) throw new Error(`Could not fetch tree (${r2.status})`);
  const d2 = await r2.json();
  if (d2.truncated) console.warn("Tree truncated — very large repo");
  return { items: d2.tree, branch };
}

function buildTreeStructure(flatItems) {
  const root = { name: "", children: {}, type: "tree", path: "" };
  for (const item of flatItems) {
    const parts = item.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!node.children[p]) {
        node.children[p] = {
          name: p,
          children: {},
          type: i === parts.length - 1 ? item.type : "tree",
          path: parts.slice(0, i + 1).join("/"),
          size: item.size,
          sha: item.sha,
        };
      }
      node = node.children[p];
    }
  }
  return root;
}

function applyFilters(root, { omit, maxDepth, startDir }) {
  const omitPaths = omit
    .split(",")
    .map((s) => s.trim().replace(/^\//, "").replace(/\/$/, ""))
    .filter(Boolean);
  const start = startDir.trim().replace(/^\//, "").replace(/\/$/, "");

  function shouldOmit(path) {
    const name = path.split("/").pop();
    return omitPaths.some(
      (o) => path === o || path.startsWith(o + "/") || name === o
    );
  }

  function collect(node, depth) {
    const out = [];
    for (const child of Object.values(node.children)) {
      if (shouldOmit(child.path)) continue;
      if (start && !child.path.startsWith(start) && !start.startsWith(child.path)) continue;
      if (maxDepth > 0 && depth > maxDepth) continue;
      out.push(child);
      if (child.type === "tree") out.push(...collect(child, depth + 1));
    }
    return out;
  }
  return collect(root, 1);
}

function fileIcon(name, type) {
  if (type === "tree") return null;
  const ext = name.split(".").pop().toLowerCase();
  const icons = {
    js: "js", jsx: "jsx", ts: "ts", tsx: "tsx",
    py: "py", rb: "rb", go: "go", rs: "rs",
    html: "html", css: "css", scss: "css",
    json: "json", yaml: "yaml", yml: "yaml",
    md: "md", sh: "sh", bash: "sh",
    png: "img", jpg: "img", jpeg: "img", svg: "svg", gif: "img",
    pdf: "pdf", zip: "zip", lock: "lock",
    env: "env", gitignore: "git", dockerfile: "docker",
  };
  return icons[ext] || "file";
}

function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

//  File Badge 
function FileBadge({ type }) {
  const colors = {
    js: "#f7df1e", jsx: "#61dafb", ts: "#3178c6", tsx: "#61dafb",
    py: "#3572a5", rb: "#cc342d", go: "#00add8", rs: "#dea584",
    html: "#e34c26", css: "#563d7c", json: "#292929", yaml: "#cb171e",
    md: "#083fa1", sh: "#89e051", img: "#6f42c1", svg: "#ff9900",
    pdf: "#ff0000", zip: "#f89820", lock: "#888", env: "#ecc94b",
    git: "#f05032", docker: "#0db7ed", file: "#666",
  };
  if (!type) return null;
  const label = type.toUpperCase().slice(0, 4);
  const color = colors[type] || "#666";
  return (
    <span style={{
      fontSize: "9px", fontFamily: "monospace", fontWeight: 700,
      background: color + "22", color, border: `1px solid ${color}55`,
      borderRadius: "3px", padding: "0 4px", lineHeight: "16px",
      letterSpacing: "0.5px", flexShrink: 0,
    }}>{label}</span>
  );
}

//  Tree Node 
function TreeNode({ node, depth, selected, onToggle, allItems }) {
  const [open, setOpen] = useState(depth < 2);
  const isDir = node.type === "tree";
  const childItems = isDir ? Object.values(node.children) : [];
  const childDirs = childItems.filter((c) => c.type === "tree");
  const childFiles = childItems.filter((c) => c.type !== "tree");
  const sorted = [...childDirs, ...childFiles];
  const isSelected = selected.has(node.path);
  const icon = fileIcon(node.name, node.type);

  return (
    <div>
      <div
        className={`tree-row ${isSelected ? "selected" : ""}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => !isDir && onToggle(node.path)}
      >
        {isDir ? (
          <button
            className="expand-btn"
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="expand-spacer" />
        )}
        {isDir ? (
          <span className="dir-icon">{open ? "📂" : "📁"}</span>
        ) : (
          <FileBadge type={icon} />
        )}
        <span className={`node-name ${isDir ? "dir-name" : "file-name"}`}>
          {node.name}
        </span>
        {!isDir && node.size && (
          <span className="file-size">{fmtSize(node.size)}</span>
        )}
        {!isDir && (
          <input
            type="checkbox"
            className="file-check"
            checked={isSelected}
            onChange={() => onToggle(node.path)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>
      {isDir && open && sorted.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          selected={selected}
          onToggle={onToggle}
          allItems={allItems}
        />
      ))}
    </div>
  );
}

//  Main App 
export default function App() {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [branch, setBranch] = useState("");
  const [omit, setOmit] = useState(".env,.env.local,.DS_Store");
  const [maxDepth, setMaxDepth] = useState(0);
  const [startDir, setStartDir] = useState("");
  const [outputDir, setOutputDir] = useState("output");

  const [phase, setPhase] = useState("idle"); // idle | loading | tree | downloading
  const [error, setError] = useState("");
  const [repoMeta, setRepoMeta] = useState(null);
  const [treeRoot, setTreeRoot] = useState(null);
  const [flatFiltered, setFlatFiltered] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [progress, setProgress] = useState({ done: 0, total: 0, file: "" });
  const [exportFormat, setExportFormat] = useState("zip");

  const parsed = parseGitUrl(url);

  //  Fetch tree
  const handleFetch = useCallback(async () => {
    if (!parsed) { setError("Invalid or unsupported Git URL. Only GitHub is supported."); return; }
    setError(""); setPhase("loading"); setTreeRoot(null); setSelected(new Set());
    try {
      const { items, branch: detectedBranch } = await fetchGithubTree(
        parsed.owner, parsed.repo, token, branch || undefined
      );
      if (!branch) setBranch(detectedBranch);
      const root = buildTreeStructure(items);
      const filtered = applyFilters(root, { omit, maxDepth, startDir });
      const files = filtered.filter((n) => n.type !== "tree");
      setTreeRoot(root);
      setFlatFiltered(filtered);
      setSelected(new Set(files.map((f) => f.path)));
      setRepoMeta({ owner: parsed.owner, repo: parsed.repo, branch: detectedBranch, total: items.length });
      setPhase("tree");
    } catch (e) {
      setError(e.message);
      setPhase("idle");
    }
  }, [parsed, token, branch, omit, maxDepth, startDir]);

  //  Re-apply filters without re-fetching
  const handleRefilter = useCallback(() => {
    if (!treeRoot) return;
    const filtered = applyFilters(treeRoot, { omit, maxDepth, startDir });
    const files = filtered.filter((n) => n.type !== "tree");
    setFlatFiltered(filtered);
    setSelected(new Set(files.map((f) => f.path)));
  }, [treeRoot, omit, maxDepth, startDir]);

  const toggleFile = useCallback((path) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const selectAll = () => {
    const files = flatFiltered.filter((n) => n.type !== "tree");
    setSelected(new Set(files.map((f) => f.path)));
  };
  const selectNone = () => setSelected(new Set());

  //  Download
  const handleDownload = useCallback(async () => {
    if (!parsed || selected.size === 0) return;
    const h = token ? { Authorization: `token ${token}` } : {};
    const filePaths = [...selected];
    setPhase("downloading");
    setProgress({ done: 0, total: filePaths.length, file: "" });

    try {
      const zip = new JSZip();
      const prefix = outputDir.trim().replace(/\/$/, "") || "output";

      for (let i = 0; i < filePaths.length; i++) {
        const path = filePaths[i];
        setProgress({ done: i, total: filePaths.length, file: path });
        const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${repoMeta.branch}/${path}`;
        try {
          const res = await fetch(rawUrl, { headers: h });
          if (res.ok) {
            const blob = await res.arrayBuffer();
            zip.file(`${prefix}/${path}`, blob);
          }
        } catch {
          // skip failed files
        }
      }

      setProgress({ done: filePaths.length, total: filePaths.length, file: "Compressing…" });
      const ext = exportFormat === "tar.gz" ? "tar.gz" : exportFormat;
      const fname = `${parsed.repo}-${repoMeta.branch}.${ext}`;

      if (exportFormat === "zip") {
        const content = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
        saveAs(content, fname);
      } else if (exportFormat === "tar.gz") {
        // We'll generate a zip and rename — true tar.gz requires a lib not in CDN
        // so we generate zip and save as .zip with a note
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, `${parsed.repo}-${repoMeta.branch}.zip`);
        alert("Note: true tar.gz requires a build environment. Downloaded as .zip instead.");
      } else {
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, `${parsed.repo}-${repoMeta.branch}.zip`);
      }

      setPhase("tree");
      setProgress({ done: 0, total: 0, file: "" });
    } catch (e) {
      setError(e.message);
      setPhase("tree");
    }
  }, [parsed, selected, token, repoMeta, outputDir, exportFormat]);

  const filteredRoot = treeRoot
    ? buildTreeStructure(flatFiltered.filter((n) => n.type !== "tree").map((n) => ({ path: n.path, type: n.type, size: n.size, sha: n.sha })))
    : null;

  const selectedCount = selected.size;
  const totalFileCount = flatFiltered.filter((n) => n.type !== "tree").length;
  const downloadPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <span className="logo-bracket">[</span>
          <span className="logo-main">git</span>
          <span className="logo-accent">pullinator</span>
          <span className="logo-bracket">]</span>
        </div>
        <p className="tagline">Surgical git cloning — grab exactly what you need</p>
      </header>

      <main className="main">
        {/*  Config Panel  */}
        <section className="panel config-panel">
          <div className="panel-header">
            <span className="panel-icon">⚙</span> Configuration
          </div>

          <div className="field-group">
            <label className="field-label">Repository URL</label>
            <div className="url-row">
              <input
                className="input"
                placeholder="https://github.com/owner/repo.git"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFetch()}
              />
              <button
                className={`btn btn-primary ${phase === "loading" ? "loading" : ""}`}
                onClick={handleFetch}
                disabled={!url || phase === "loading" || phase === "downloading"}
              >
                {phase === "loading" ? <span className="spinner" /> : "Fetch"}
              </button>
            </div>
          </div>

          <div className="fields-row">
            <div className="field-group">
              <label className="field-label">
                Branch <span className="field-hint">(leave blank for default)</span>
              </label>
              <input className="input" placeholder="main" value={branch} onChange={(e) => setBranch(e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label">
                Start Directory <span className="field-hint">(e.g. src/)</span>
              </label>
              <input className="input" placeholder="/" value={startDir} onChange={(e) => setStartDir(e.target.value)} />
            </div>
          </div>

          <div className="fields-row">
            <div className="field-group">
              <label className="field-label">
                Max Depth <span className="field-hint">(0 = unlimited)</span>
              </label>
              <input
                className="input"
                type="number" min="0" max="20"
                value={maxDepth}
                onChange={(e) => setMaxDepth(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="field-group">
              <label className="field-label">
                Output Folder Name
              </label>
              <input className="input" placeholder="output" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">
              Omit Files / Folders <span className="field-hint">(comma separated)</span>
            </label>
            <input
              className="input"
              placeholder=".env, node_modules, /dist, *.lock"
              value={omit}
              onChange={(e) => setOmit(e.target.value)}
            />
          </div>

          <div className="field-group">
            <div className="token-label-row">
              <label className="field-label">GitHub Token</label>
              <span className="field-hint">For private repos or higher rate limits</span>
            </div>
            <div className="token-row">
              <input
                className="input"
                type={showToken ? "text" : "password"}
                placeholder="ghp_xxxxxxxxxxxx (optional)"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button className="btn btn-ghost" onClick={() => setShowToken((s) => !s)}>
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
            <p className="token-note">🔒 Token never leaves your browser</p>
          </div>

          {treeRoot && (
            <button className="btn btn-secondary full-width" onClick={handleRefilter}>
              ↻ Re-apply Filters
            </button>
          )}

          {error && <div className="error-box">⚠ {error}</div>}
        </section>

        {/*  Tree Panel  */}
        {phase === "tree" || phase === "downloading" ? (
          <section className="panel tree-panel">
            <div className="panel-header">
              <span className="panel-icon">🌲</span>
              <span>File Tree</span>
              {repoMeta && (
                <span className="repo-badge">
                  {repoMeta.owner}/{repoMeta.repo} @ {repoMeta.branch}
                </span>
              )}
              <span className="file-count">{totalFileCount} files</span>
            </div>

            <div className="tree-toolbar">
              <button className="btn btn-ghost btn-sm" onClick={selectAll}>Select All</button>
              <button className="btn btn-ghost btn-sm" onClick={selectNone}>Select None</button>
              <span className="selected-count">{selectedCount} selected</span>
            </div>

            <div className="tree-scroll">
              {treeRoot && Object.values(treeRoot.children).map((node) => (
                <TreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  selected={selected}
                  onToggle={toggleFile}
                  allItems={flatFiltered}
                />
              ))}
            </div>

            {/*  Export Bar  */}
            <div className="export-bar">
              <div className="export-format">
                <label className="field-label">Export as</label>
                <div className="format-btns">
                  {["zip", "tar.gz"].map((f) => (
                    <button
                      key={f}
                      className={`btn btn-sm ${exportFormat === f ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => setExportFormat(f)}
                    >
                      .{f}
                    </button>
                  ))}
                </div>
              </div>

              {phase === "downloading" ? (
                <div className="progress-area">
                  <div className="progress-bar-wrap">
                    <div className="progress-bar-fill" style={{ width: `${downloadPct}%` }} />
                  </div>
                  <span className="progress-label">{downloadPct}% — {progress.file}</span>
                </div>
              ) : (
                <button
                  className="btn btn-download"
                  onClick={handleDownload}
                  disabled={selectedCount === 0}
                >
                  ↓ Download {selectedCount} file{selectedCount !== 1 ? "s" : ""} as .{exportFormat}
                </button>
              )}
            </div>
          </section>
        ) : phase === "idle" ? (
          <div className="empty-state">
            <div className="empty-icon">⌥</div>
            <p>Paste a GitHub repo URL above and hit <strong>Fetch</strong> to get started</p>
            <ul className="tips">
              <li>Works with any public GitHub repo</li>
              <li>Add a token for private repos</li>
              <li>Filter by folder depth or omit unwanted files</li>
              <li>Download only the files you select</li>
            </ul>
          </div>
        ) : null}
      </main>

      <footer className="footer">
        gitpullinator · runs entirely in your browser · no data sent to any server
      </footer>
    </div>
  );
}
