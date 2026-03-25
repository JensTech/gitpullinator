import { useState, useCallback, useEffect } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import "./index.css";

const OAUTH_START = "https://jenstech.rf.gd/gitpullinator/oauth.php?action=start";
const STORAGE_KEY = "gitpullinator_tokens";

//  Storage helpers 
function loadTokens() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveTokens(tokens) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

//  Git helpers 
function parseGitUrl(url) {
  url = url.trim().replace(/\.git$/, "");
  const gh = url.match(/github\.com[/:]([^/]+)\/([^/#? ]+)/);
  if (gh) return { host: "github", owner: gh[1], repo: gh[2] };
  return null;
}

async function fetchGithubTree(owner, repo, token, branch) {
  const h = token ? { Authorization: `token ${token}` } : {};
  if (!branch) {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: h });
    if (!r.ok) throw new Error(`Repo not found (${r.status}). Private? Sign in or add a token.`);
    const d = await r.json();
    branch = d.default_branch;
  }
  const r2 = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers: h }
  );
  if (!r2.ok) throw new Error(`Could not fetch tree (${r2.status})`);
  const d2 = await r2.json();
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
          name: p, children: {}, path: parts.slice(0, i + 1).join("/"),
          type: i === parts.length - 1 ? item.type : "tree",
          size: item.size, sha: item.sha,
        };
      }
      node = node.children[p];
    }
  }
  return root;
}

function applyFilters(root, { omit, maxDepth, startDir }) {
  const omitPaths = omit.split(",").map(s => s.trim().replace(/^\//, "").replace(/\/$/, "")).filter(Boolean);
  const start = startDir.trim().replace(/^\//, "").replace(/\/$/, "");
  function shouldOmit(path) {
    const name = path.split("/").pop();
    return omitPaths.some(o => path === o || path.startsWith(o + "/") || name === o);
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

function fileIcon(name) {
  const ext = name.split(".").pop().toLowerCase();
  const icons = {
    js:"js",jsx:"jsx",ts:"ts",tsx:"tsx",py:"py",rb:"rb",go:"go",rs:"rs",
    html:"html",css:"css",scss:"css",json:"json",yaml:"yaml",yml:"yaml",
    md:"md",sh:"sh",bash:"sh",png:"img",jpg:"img",jpeg:"img",svg:"svg",gif:"img",
    pdf:"pdf",zip:"zip",lock:"lock",env:"env",gitignore:"git",dockerfile:"docker",
  };
  return icons[ext] || "file";
}

function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

//  FileBadge 
function FileBadge({ type }) {
  const colors = {
    js:"#f7df1e",jsx:"#61dafb",ts:"#3178c6",tsx:"#61dafb",py:"#3572a5",rb:"#cc342d",
    go:"#00add8",rs:"#dea584",html:"#e34c26",css:"#563d7c",json:"#aaa",yaml:"#cb171e",
    md:"#4a9eff",sh:"#89e051",img:"#c084fc",svg:"#ff9900",pdf:"#ff0000",zip:"#f89820",
    lock:"#888",env:"#ecc94b",git:"#f05032",docker:"#0db7ed",file:"#666",
  };
  const label = type.toUpperCase().slice(0, 4);
  const color = colors[type] || "#666";
  return (
    <span style={{
      fontSize:"9px",fontFamily:"monospace",fontWeight:700,
      background:color+"22",color,border:`1px solid ${color}55`,
      borderRadius:"3px",padding:"0 4px",lineHeight:"16px",
      letterSpacing:"0.5px",flexShrink:0,
    }}>{label}</span>
  );
}

//  TreeNode 
function TreeNode({ node, depth, selected, onToggle }) {
  const [open, setOpen] = useState(depth < 2);
  const isDir = node.type === "tree";
  const children = Object.values(node.children);
  const sorted = [...children.filter(c=>c.type==="tree"), ...children.filter(c=>c.type!=="tree")];
  return (
    <div>
      <div
        className={`tree-row ${!isDir && selected.has(node.path) ? "selected" : ""}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => !isDir && onToggle(node.path)}
      >
        {isDir
          ? <button className="expand-btn" onClick={e=>{e.stopPropagation();setOpen(o=>!o);}}>
              {open ? "▾" : "▸"}
            </button>
          : <span className="expand-spacer" />
        }
        {isDir
          ? <span className="dir-icon">{open ? "📂" : "📁"}</span>
          : <FileBadge type={fileIcon(node.name)} />
        }
        <span className={`node-name ${isDir ? "dir-name" : "file-name"}`}>{node.name}</span>
        {!isDir && node.size && <span className="file-size">{fmtSize(node.size)}</span>}
        {!isDir && (
          <input type="checkbox" className="file-check"
            checked={selected.has(node.path)}
            onChange={()=>onToggle(node.path)}
            onClick={e=>e.stopPropagation()}
          />
        )}
      </div>
      {isDir && open && sorted.map(child => (
        <TreeNode key={child.path} node={child} depth={depth+1} selected={selected} onToggle={onToggle} />
      ))}
    </div>
  );
}

//  Token Manager Modal 
function TokenManager({ onClose, onSelect }) {
  const [tokens, setTokens] = useState(loadTokens);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [showValues, setShowValues] = useState({});
  const [testing, setTesting] = useState(null);
  const [testResults, setTestResults] = useState({});

  function add() {
    if (!name.trim() || !value.trim()) return;
    const entry = { id: Date.now(), name: name.trim(), token: value.trim(), type: "pat" };
    const updated = [...tokens, entry];
    setTokens(updated); saveTokens(updated);
    setName(""); setValue("");
  }

  function remove(id) {
    const updated = tokens.filter(t => t.id !== id);
    setTokens(updated); saveTokens(updated);
  }

  async function testToken(entry) {
    setTesting(entry.id);
    try {
      const r = await fetch("https://api.github.com/user", {
        headers: { Authorization: `token ${entry.token}` }
      });
      if (r.ok) {
        const d = await r.json();
        setTestResults(prev => ({ ...prev, [entry.id]: { ok: true, user: d.login, avatar: d.avatar_url } }));
      } else {
        setTestResults(prev => ({ ...prev, [entry.id]: { ok: false, msg: `Error ${r.status}` } }));
      }
    } catch {
      setTestResults(prev => ({ ...prev, [entry.id]: { ok: false, msg: "Network error" } }));
    }
    setTesting(null);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>🔑 Token Manager</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="modal-note">
            Tokens are stored locally in your browser only and never sent anywhere except GitHub's API.
          </p>

          {/* GitHub OAuth button */}
          <button className="btn btn-github full-width" onClick={() => window.location.href = OAUTH_START}>
            <svg height="18" width="18" viewBox="0 0 16 16" fill="currentColor" style={{flexShrink:0}}>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            Continue with GitHub
          </button>

          {tokens.length > 0 && (
            <div className="token-list">
              {tokens.map(t => {
                const result = testResults[t.id];
                return (
                  <div key={t.id} className="token-entry">
                    <div className="token-entry-top">
                      <span className="token-entry-name">
                        {t.type === "oauth" ? "🐙 " : ""}{t.name}
                      </span>
                      <div className="token-entry-actions">
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => testToken(t)} disabled={testing === t.id}>
                          {testing === t.id ? <span className="spinner" /> : "Test"}
                        </button>
                        <button className="btn btn-accent btn-sm" onClick={() => { onSelect(t); onClose(); }}>
                          Use
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => remove(t.id)}>✕</button>
                      </div>
                    </div>
                    <div className="token-entry-value">
                      <span className="token-masked">
                        {showValues[t.id] ? t.token : t.token.slice(0, 7) + "••••••••••••••••••••"}
                      </span>
                      <button className="btn-inline" onClick={() => setShowValues(p => ({...p, [t.id]: !p[t.id]}))}>
                        {showValues[t.id] ? "hide" : "show"}
                      </button>
                    </div>
                    {result && (
                      <div className={`test-result ${result.ok ? "ok" : "fail"}`}>
                        {result.ok
                          ? <span>✓ Valid — authenticated as <strong>@{result.user}</strong></span>
                          : <span>✗ Invalid — {result.msg}</span>
                        }
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="token-divider"><span>or add a Personal Access Token manually</span></div>

          <div className="token-add-form">
            <div className="token-add-row">
              <input className="input" placeholder="Label  (e.g. Work Org)" value={name} onChange={e=>setName(e.target.value)} />
              <input className="input" placeholder="ghp_xxxxxxxxxxxx" value={value}
                onChange={e=>setValue(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} type="password" />
              <button className="btn btn-primary" onClick={add} disabled={!name.trim()||!value.trim()}>Add</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

//  App 
export default function App() {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [activeTokenName, setActiveTokenName] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showTokenManager, setShowTokenManager] = useState(false);
  const [branch, setBranch] = useState("");
  const [omit, setOmit] = useState(".env,.env.local,.DS_Store");
  const [maxDepth, setMaxDepth] = useState(0);
  const [startDir, setStartDir] = useState("");
  const [outputDir, setOutputDir] = useState("output");
  const [oauthNotice, setOauthNotice] = useState("");

  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [repoMeta, setRepoMeta] = useState(null);
  const [treeRoot, setTreeRoot] = useState(null);
  const [flatFiltered, setFlatFiltered] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [progress, setProgress] = useState({ done: 0, total: 0, file: "" });

  const parsed = parseGitUrl(url);

  //  Handle OAuth callback via URL hash 
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;

    const params = new URLSearchParams(hash.slice(1));
    const ghToken = params.get("gh_token");
    const ghError = params.get("gh_error");

    // Clean the hash from the URL immediately
    window.history.replaceState(null, "", window.location.pathname);

    if (ghError) {
      setOauthNotice("error:" + decodeURIComponent(ghError));
      return;
    }

    if (ghToken) {
      // Look up the GitHub username for this token
      fetch("https://api.github.com/user", {
        headers: { Authorization: `token ${ghToken}` }
      })
        .then(r => r.json())
        .then(d => {
          const name = d.login ? `GitHub — @${d.login}` : "GitHub OAuth";
          const entry = { id: Date.now(), name, token: ghToken, type: "oauth" };
          const tokens = loadTokens();
          // Replace any existing oauth token to avoid duplicates
          const updated = [...tokens.filter(t => t.type !== "oauth"), entry];
          saveTokens(updated);
          setToken(ghToken);
          setActiveTokenName(name);
          setOauthNotice("success:" + name);
        })
        .catch(() => {
          // Save even if username lookup fails
          const entry = { id: Date.now(), name: "GitHub OAuth", token: ghToken, type: "oauth" };
          const tokens = loadTokens();
          const updated = [...tokens.filter(t => t.type !== "oauth"), entry];
          saveTokens(updated);
          setToken(ghToken);
          setActiveTokenName("GitHub OAuth");
          setOauthNotice("success:GitHub OAuth");
        });
    }
  }, []);

  const handleFetch = useCallback(async () => {
    if (!parsed) { setError("Invalid URL. Paste a GitHub repo URL."); return; }
    setError(""); setPhase("loading"); setTreeRoot(null); setSelected(new Set());
    try {
      const { items, branch: b } = await fetchGithubTree(parsed.owner, parsed.repo, token, branch || undefined);
      if (!branch) setBranch(b);
      const root = buildTreeStructure(items);
      const filtered = applyFilters(root, { omit, maxDepth, startDir });
      const files = filtered.filter(n => n.type !== "tree");
      setTreeRoot(root);
      setFlatFiltered(filtered);
      setSelected(new Set(files.map(f => f.path)));
      setRepoMeta({ owner: parsed.owner, repo: parsed.repo, branch: b });
      setPhase("tree");
    } catch(e) { setError(e.message); setPhase("idle"); }
  }, [parsed, token, branch, omit, maxDepth, startDir]);

  const handleRefilter = useCallback(() => {
    if (!treeRoot) return;
    const filtered = applyFilters(treeRoot, { omit, maxDepth, startDir });
    setFlatFiltered(filtered);
    setSelected(new Set(filtered.filter(n=>n.type!=="tree").map(f=>f.path)));
  }, [treeRoot, omit, maxDepth, startDir]);

  const toggleFile = useCallback((path) => {
    setSelected(prev => { const n = new Set(prev); n.has(path)?n.delete(path):n.add(path); return n; });
  }, []);

  const selectAll = () => setSelected(new Set(flatFiltered.filter(n=>n.type!=="tree").map(f=>f.path)));
  const selectNone = () => setSelected(new Set());

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
          if (res.ok) zip.file(`${prefix}/${path}`, await res.arrayBuffer());
        } catch {}
      }
      setProgress({ done: filePaths.length, total: filePaths.length, file: "Compressing…" });
      const content = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      saveAs(content, `${parsed.repo}-${repoMeta.branch}.zip`);
      setPhase("tree");
      setProgress({ done: 0, total: 0, file: "" });
    } catch(e) { setError(e.message); setPhase("tree"); }
  }, [parsed, selected, token, repoMeta, outputDir]);

  const totalFiles = flatFiltered.filter(n=>n.type!=="tree").length;
  const downloadPct = progress.total > 0 ? Math.round((progress.done/progress.total)*100) : 0;
  const oauthSuccess = oauthNotice.startsWith("success:");
  const oauthFail = oauthNotice.startsWith("error:");

  return (
    <div className="app">
      {showTokenManager && (
        <TokenManager
          onClose={() => setShowTokenManager(false)}
          onSelect={t => { setToken(t.token); setActiveTokenName(t.name); }}
        />
      )}

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

        {/* OAuth success/fail notice */}
        {oauthNotice && (
          <div className={`oauth-notice ${oauthSuccess ? "ok" : "fail"}`}>
            {oauthSuccess
              ? <>🐙 Signed in as <strong>{oauthNotice.slice(8)}</strong> — token saved to manager</>
              : <>⚠ GitHub auth failed: {oauthNotice.slice(6)}</>
            }
            <button className="btn-inline" onClick={() => setOauthNotice("")}>✕</button>
          </div>
        )}

        <section className="panel config-panel">
          <div className="panel-header"><span className="panel-icon">⚙</span> Configuration</div>

          <div className="field-group">
            <label className="field-label">Repository URL</label>
            <div className="url-row">
              <input className="input" placeholder="https://github.com/owner/repo.git"
                value={url} onChange={e=>setUrl(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&handleFetch()} />
              <button className={`btn btn-primary${phase==="loading"?" loading":""}`}
                onClick={handleFetch} disabled={!url||phase==="loading"||phase==="downloading"}>
                {phase==="loading" ? <span className="spinner"/> : "Fetch"}
              </button>
            </div>
          </div>

          <div className="fields-row">
            <div className="field-group">
              <label className="field-label">Branch <span className="field-hint">(blank = default)</span></label>
              <input className="input" placeholder="main" value={branch} onChange={e=>setBranch(e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label">Start Directory <span className="field-hint">e.g. src/</span></label>
              <input className="input" placeholder="/" value={startDir} onChange={e=>setStartDir(e.target.value)} />
            </div>
          </div>

          <div className="fields-row">
            <div className="field-group">
              <label className="field-label">Max Depth <span className="field-hint">(0 = unlimited)</span></label>
              <input className="input" type="number" min="0" max="20" value={maxDepth}
                onChange={e=>setMaxDepth(parseInt(e.target.value)||0)} />
            </div>
            <div className="field-group">
              <label className="field-label">Output Folder Name</label>
              <input className="input" placeholder="output" value={outputDir} onChange={e=>setOutputDir(e.target.value)} />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">Omit Files / Folders <span className="field-hint">(comma separated)</span></label>
            <input className="input" placeholder=".env, node_modules, /dist"
              value={omit} onChange={e=>setOmit(e.target.value)} />
          </div>

          {/* Token section */}
          <div className="field-group">
            <div className="token-label-row">
              <label className="field-label">GitHub Access</label>
              <span className="field-hint">— private repos &amp; rate limits</span>
              <button className="btn btn-ghost btn-sm token-mgr-btn" onClick={()=>setShowTokenManager(true)}>
                🔑 Manage
              </button>
            </div>

            {activeTokenName ? (
              <div className="active-token-banner">
                <span>🟢 Using: <strong>{activeTokenName}</strong></span>
                <button className="btn-inline danger" onClick={()=>{setToken("");setActiveTokenName("");}}>Clear</button>
              </div>
            ) : (
              <button className="btn btn-github full-width" onClick={() => window.location.href = OAUTH_START}>
                <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor" style={{flexShrink:0}}>
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
                Continue with GitHub
              </button>
            )}

            {!activeTokenName && (
              <div className="token-row" style={{marginTop:"8px"}}>
                <input className="input" type={showToken?"text":"password"}
                  placeholder="or paste a token manually (ghp_xxx)"
                  value={token} onChange={e=>{setToken(e.target.value);setActiveTokenName("");}} />
                <button className="btn btn-ghost" onClick={()=>setShowToken(s=>!s)}>
                  {showToken?"Hide":"Show"}
                </button>
              </div>
            )}
            <p className="token-note">🔒 Tokens stored locally in your browser only</p>
          </div>

          {treeRoot && (
            <button className="btn btn-secondary full-width" onClick={handleRefilter}>
              ↻ Re-apply Filters Without Re-fetching
            </button>
          )}
          {error && <div className="error-box">⚠ {error}</div>}
        </section>

        {(phase==="tree"||phase==="downloading") ? (
          <section className="panel tree-panel">
            <div className="panel-header">
              <span className="panel-icon">🌲</span> File Tree
              {repoMeta && <span className="repo-badge">{repoMeta.owner}/{repoMeta.repo} @ {repoMeta.branch}</span>}
              <span className="file-count">{totalFiles} files</span>
            </div>
            <div className="tree-toolbar">
              <button className="btn btn-ghost btn-sm" onClick={selectAll}>Select All</button>
              <button className="btn btn-ghost btn-sm" onClick={selectNone}>Select None</button>
              <span className="selected-count">{selected.size} selected</span>
            </div>
            <div className="tree-scroll">
              {treeRoot && Object.values(treeRoot.children).map(node => (
                <TreeNode key={node.path} node={node} depth={0} selected={selected} onToggle={toggleFile} />
              ))}
            </div>
            <div className="export-bar">
              <div className="export-format">
                <label className="field-label">Export as</label>
                <div className="format-btns">
                  <button className="btn btn-sm btn-primary">.zip</button>
                </div>
              </div>
              {phase==="downloading" ? (
                <div className="progress-area">
                  <div className="progress-bar-wrap">
                    <div className="progress-bar-fill" style={{width:`${downloadPct}%`}} />
                  </div>
                  <span className="progress-label">{downloadPct}% — {progress.file}</span>
                </div>
              ) : (
                <button className="btn btn-download" onClick={handleDownload} disabled={selected.size===0}>
                  ↓ Download {selected.size} file{selected.size!==1?"s":""} as .zip
                </button>
              )}
            </div>
          </section>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">⌥</div>
            <p>Paste a GitHub repo URL above and hit <strong>Fetch</strong></p>
            <ul className="tips">
              <li>Sign in with GitHub for private repo access</li>
              <li>Save multiple tokens for different orgs</li>
              <li>Filter by folder depth or start directory</li>
              <li>Omit specific files or folders before downloading</li>
              <li>Hand-pick exactly which files to include</li>
            </ul>
          </div>
        )}
      </main>

      <footer className="footer">
        gitpullinator · runs entirely in your browser · no data sent to any server
      </footer>
    </div>
  );
}
