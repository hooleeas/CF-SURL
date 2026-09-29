// ================= 全局默认配置 =================
const config = {
  no_ref: "off",
  cors: "on",
  unique_link: true,
  safe_browsing_api_key: "",
  expiration_ttl: 0
};

const jsonHeaders = {
  "content-type": "application/json;charset=UTF-8"
};

if (config.cors === "on") {
  jsonHeaders["Access-Control-Allow-Origin"] = "*";
  jsonHeaders["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  jsonHeaders["Access-Control-Allow-Headers"] = "Content-Type";
}

const htmlHeaders = {
  "content-type": "text/html;charset=UTF-8"
};

// ================= 核心辅助函数 =================
async function randomString(len = 6) {
  const chars = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
  let result = "";
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function sha512(url) {
  const data = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest({ name: "SHA-512" }, data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function checkURL(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (e) {
    return false;
  }
}

function getKvPutOptions() {
  const MIN_TTL = 60;
  const rawTtl = Number(config.expiration_ttl);
  return (Number.isFinite(rawTtl) && rawTtl >= MIN_TTL) ? { expirationTtl: Math.floor(rawTtl) } : {};
}

// ================= KV 交互操作 =================
async function save_url(env, url) {
  for (let i = 0; i < 20; i++) {
    const key = await randomString();
    if (await env.KV.get(key) === null) {
      await env.KV.put(key, url, getKvPutOptions());
      return key;
    }
  }
  throw new Error("无法生成唯一短链接，请稍后重试");
}

async function is_url_exist(env, hash) {
  return (await env.KV.get(hash)) || false;
}

// ================= 短链接兼容 API =================
async function apiCreateShortLink(env, url) {
  if (!await checkURL(url)) throw new Error("网址格式不正确");

  // 与前台短链接生成逻辑保持一致：开启唯一链接时，相同 URL 返回已有 Key
  if (config.unique_link) {
    const hash = await sha512(url);
    const existing = await is_url_exist(env, hash);
    if (existing) return existing;

    const key = await save_url(env, url);
    await env.KV.put(hash, key, getKvPutOptions());
    return key;
  }

  return await save_url(env, url);
}

// ================= 管理后台接口 =================
function validateAdminKey(key) {
  if (typeof key !== "string" || !key.trim()) return { ok: false, error: "Key 不能为空" };
  key = key.trim();
  if (key.length > 64) return { ok: false, error: "Key 最长 64 个字符" };
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return { ok: false, error: "Key 只能使用字母、数字、下划线和短横线" };
  if (key.toLowerCase() === "admin" || key.toLowerCase() === "api" || key.toLowerCase() === "config") return { ok: false, error: "Key 包含系统保留字" };
  return { ok: true };
}

function isSha512Key(key) {
  return typeof key === "string" && /^[a-f0-9]{128}$/.test(key);
}

async function adminListLinks(env) {
  const result = [];
  let cursor;
  do {
    const listResult = await env.KV.list(cursor ? { cursor } : {});
    for (const item of listResult.keys) {
      if (item.name === 'CONFIG.json') continue;
      const url = await env.KV.get(item.name);
      if (url !== null && await checkURL(url)) {
        result.push({ key: item.name, url });
      }
    }
    cursor = listResult.list_complete ? undefined : listResult.cursor;
  } while (cursor);
  result.sort((a, b) => b.key.localeCompare(a.key));
  return result;
}

async function adminCreateLink(env, key, url) {
  const check = validateAdminKey(key);
  if (!check.ok) throw new Error(check.error);
  if (!await checkURL(url)) throw new Error("目标 URL 格式不正确");
  if (await env.KV.get(key) !== null) throw new Error("Key 已经存在");

  await env.KV.put(key, url, getKvPutOptions());
  if (config.unique_link) {
    const hash = await sha512(url);
    if (await env.KV.get(hash) === null) await env.KV.put(hash, key, getKvPutOptions());
  }
  return key;
}

async function adminDeleteLink(env, key) {
  const check = validateAdminKey(key);
  if (!check.ok) throw new Error(check.error);
  const oldUrl = await env.KV.get(key);
  if (oldUrl === null) throw new Error("链接不存在");

  const hash = await sha512(oldUrl);
  if (await env.KV.get(hash) === key) await env.KV.delete(hash);
  await env.KV.delete(key);
}

async function adminUpdateLink(env, oldKey, newKey, newUrl) {
  if (typeof oldKey !== "string" || !oldKey.trim()) throw new Error("原 Key 无效");
  const check = validateAdminKey(newKey);
  if (!check.ok) throw new Error(check.error);
  if (!await checkURL(newUrl)) throw new Error("目标 URL 格式不正确");

  const oldUrl = await env.KV.get(oldKey);
  if (oldUrl === null) throw new Error("原链接不存在");
  if (oldKey !== newKey && await env.KV.get(newKey) !== null) throw new Error("新的 Key 已经存在");

  const oldHash = await sha512(oldUrl);
  if (await env.KV.get(oldHash) === oldKey) await env.KV.delete(oldHash);
  if (oldKey !== newKey) await env.KV.delete(oldKey);

  await env.KV.put(newKey, newUrl, getKvPutOptions());
  if (config.unique_link) {
    const newHash = await sha512(newUrl);
    if (await env.KV.get(newHash) === null) await env.KV.put(newHash, newKey, getKvPutOptions());
  }
}

// ================= 安全与登录逻辑 =================
function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const cookies = cookie.split(';').map(item => item.trim());
  for (const item of cookies) {
    const index = item.indexOf('=');
    if (index === -1) continue;
    if (item.slice(0, index) === name) return decodeURIComponent(item.slice(index + 1));
  }
  return '';
}

async function getAdminSessionValue(user, pass) {
  if (!user || !pass) return '';
  return await sha512(`${user}:${pass}:admin-login`);
}

function isAdminLoginEnabled(user, pass) {
  return !!(user && pass);
}

async function isAdminLoggedIn(request, user, pass) {
  const session = await getAdminSessionValue(user, pass);
  return session ? getCookie(request, 'CF_SHORT_ADMIN') === session : false;
}

async function handleAdminLogin(request, user, pass) {
  let inputUser = '';
  let inputPass = '';
  try {
    const form = await request.formData();
    inputUser = String(form.get('username') || '');
    inputPass = String(form.get('password') || '');
  } catch (e) {
    return new Response(renderLoginPage('登录请求格式不正确'), { status: 400, headers: htmlHeaders });
  }
  if (inputUser === user && inputPass === pass) {
    const session = await getAdminSessionValue(user, pass);
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    return new Response('', {
      status: 302,
      headers: {
        'Location': '/admin',
        'Set-Cookie': `CF_SHORT_ADMIN=${encodeURIComponent(session)}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax${secure}`,
        'Cache-Control': 'no-store'
      }
    });
  }
  return new Response(renderLoginPage('用户名或密码错误'), { status: 401, headers: htmlHeaders });
}

// ================= UI 渲染模块 =================
function escapeHTML(text = '') {
  return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function getToolStyles() {
  return `
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f7fa; color: #202124; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; min-height: 100vh; transition: background 0.3s, color 0.3s; }
    .page { width: 100%; max-width: 860px; margin: 0 auto; padding: 24px 14px; }
    .header { margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
    .title { margin: 0; font-size: 28px; font-weight: 700; color: #1a1a1a; transition: color 0.3s; }
    .subtitle { margin-top: 8px; color: #666; font-size: 13px; }
    .panel { background: rgba(255, 255, 255, 0.85); border: 1px solid rgba(229, 229, 223, 0.8); border-radius: 20px; padding: 24px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05); transition: background 0.3s, border-color 0.3s; }
    .section-title { margin: 0 0 16px; font-size: 16px; font-weight: 700; }
    .field { margin-bottom: 14px; }
    label { display: block; margin-bottom: 6px; font-weight: 600; color: #1a1a1a; transition: color 0.3s; }
    input { width: 100%; height: 44px; padding: 10px 14px; border: 1px solid rgba(207, 207, 200, 0.6); border-radius: 10px; background: rgba(255, 255, 255, 0.8); color: #202124; font-size: 14px; transition: all 0.3s ease; }
    input:focus { outline: none; border-color: #3b82f6; background: #fff; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
    button { min-height: 44px; padding: 8px 20px; border: 1px solid #343a40; border-radius: 10px; background: #2f3338; color: #fff; font-size: 14px; cursor: pointer; font-weight: 600; transition: all 0.3s ease; }
    button:hover { background: #1f2327; box-shadow: 0 4px 12px rgba(34, 34, 34, 0.15); }
    button.secondary { background: #fff; color: #222; border-color: #c8c8c0; }
    button.secondary:hover { background: #f1f3f5; }
    button.danger { background: #dc3545; border-color: #dc3545; }
    button.danger:hover { background: #c82333; box-shadow: 0 4px 12px rgba(220, 53, 69, 0.2); }
    button:disabled { opacity: 0.65; cursor: default; }
    .toast { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); display: none; padding: 12px 20px; color: #fff; background: rgba(0, 0, 0, 0.85); border-radius: 12px; z-index: 9999; font-weight: 500; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 14px 12px; text-align: left; border-bottom: 1px solid rgba(229, 229, 223, 0.8); }
    th { font-weight: 600; color: #666; font-size: 13px; }
    .url-cell { max-width: 350px; word-break: break-all; }
    .key-cell { font-weight: 600; }
    .empty { text-align: center; color: #888; padding: 30px; }
    .form-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-start; }
    .form-row .field { flex: 1; min-width: 200px; margin-bottom: 0; }
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(8px); display: none; justify-content: center; align-items: center; z-index: 1000; }
    .modal-content { background: rgba(255, 255, 255, 0.95); border-radius: 20px; padding: 28px; width: 90%; max-width: 480px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); border: 1px solid rgba(255, 255, 255, 0.5); margin: auto; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
    .result-box { margin-top: 20px; padding: 18px; background: rgba(76, 175, 80, 0.1); border: 1px solid rgba(76, 175, 80, 0.2); border-radius: 12px; display: none; text-align: left; }
    .result-url { font-size: 18px; color: #2e7d32; display: block; margin-bottom: 12px; word-break: break-all; font-weight: 600; text-decoration: none; }
    
    /* URL预览效果样式 */
    .preview-box { margin-top: 8px; font-size: 13px; color: #666; background: rgba(0,0,0,0.02); padding: 10px 14px; border-radius: 10px; border: 1px dashed rgba(0,0,0,0.15); display: none; word-break: break-all; transition: all 0.3s ease; }
    .preview-box a { color: #3b82f6; text-decoration: none; font-weight: 600; }
    .preview-box a:hover { text-decoration: underline; }

    .edit-link-preview {
      margin-top: 10px;
      padding: 11px 14px;
      border: 1px solid rgba(37, 99, 235, 0.24);
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.12), rgba(59, 130, 246, 0.06));
      color: #2563eb;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-all;
      box-shadow: 0 1px 3px rgba(37, 99, 235, 0.08);
      cursor: default;
    }
    .edit-link-preview .preview-label {
      color: #2563eb;
      font-weight: 600;
      margin-right: 6px;
    }
    .edit-link-preview .preview-value {
      color: #2563eb;
      text-decoration: underline;
      text-decoration-color: rgba(37, 99, 235, 0.55);
      text-underline-offset: 2px;
      cursor: default;
      pointer-events: none;
    }

    @media (prefers-color-scheme: dark) {
      body { background: #121212; color: #e0e0e0; }
      .title, label { color: #f5f5f5; }
      .subtitle, th { color: #aaa; }
      .panel, .modal-content { background: rgba(30, 30, 30, 0.75); border-color: rgba(255, 255, 255, 0.1); box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
      input { background: rgba(20, 20, 20, 0.8); color: #fff; border-color: rgba(255,255,255,0.2); }
      input:focus { background: #000; border-color: #3b82f6; }
      button { background: #3f4650; border-color: #69717c; box-shadow: 0 2px 8px rgba(0,0,0,0.28); }
      button:hover { background: #525b67; border-color: #858f9b; }
      button.secondary { background: #3a414a; color: #fff; border-color: #69717c; }
      button.secondary:hover { background: #4b5561; border-color: #858f9b; }
      button.danger { background: #b8323f; border-color: #d24b58; }
      button.danger:hover { background: #d13e4d; border-color: #e16a75; }
      th, td { border-bottom-color: rgba(255,255,255,0.1); }
      .result-box { background: rgba(129, 199, 132, 0.1); border-color: rgba(129, 199, 132, 0.2); }
      .result-url { color: #81c784; }
      .edit-link-preview {
        border-color: rgba(96, 165, 250, 0.32);
        background: linear-gradient(135deg, rgba(37, 99, 235, 0.25), rgba(30, 64, 175, 0.18));
        color: #93c5fd;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
      }
      .edit-link-preview .preview-label,
      .edit-link-preview .preview-value { color: #93c5fd; }
      .edit-link-preview .preview-value { text-decoration-color: rgba(147, 197, 253, 0.60); }
      .preview-box { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.1); color: #aaa; }
      .preview-box a { color: #64b5f6; }
    }
  `;
}

function renderScripts() {
  return `
    <script>
      let toastTimer;
      function showToast(message) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.style.display = 'none', 2000);
      }
      
      // 智能补全https与实时预览
      function formatUrlInput(inputEl, previewId) {
        let val = inputEl.value.trim();
        if (val && !/^https?:\\/\\//i.test(val)) {
          val = 'https://' + val;
          inputEl.value = val;
        }
        updatePreview(inputEl, previewId);
      }

      function updatePreview(inputEl, previewId) {
        const previewEl = document.getElementById(previewId);
        if (!previewEl) return;
        previewEl.style.display = 'none';
        previewEl.innerHTML = '';
      }

      function escapeHtml(text){ const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
    </script>
  `;
}

function renderIndex() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>极简短链接生成器</title>
<style>${getToolStyles()}</style>
</head>
<body style="display:flex; justify-content:center; align-items:center; min-height:100vh;">
<div id="toast" class="toast"></div>
<main class="page" style="width:100%; max-width:540px;">
<section class="panel" style="text-align:center; padding: 40px 30px;">
  <h1 class="title" style="margin-bottom:8px;">极简短链接生成器</h1>
  <div class="subtitle" style="margin-bottom:28px;">生成快速、安全的专属短链接</div>
  
  <div class="field" style="text-align:left;">
    <input type="url" id="longUrl" placeholder="输入需缩短的域名或长链接 (如 github.com)" onblur="formatUrlInput(this, 'indexPreview')" oninput="updatePreview(this, 'indexPreview')" required>
    <div id="indexPreview" class="preview-box"></div>
  </div>
  <button id="generateBtn" style="width:100%; margin-top:10px;" onclick="shortenUrl()">立即生成</button>
  
  <div class="result-box" id="resultBox">
    <div style="font-size:13px; font-weight:600; margin-bottom:8px;">生成成功：</div>
    <a href="#" id="shortUrl" target="_blank" class="result-url"></a>
    <button type="button" class="secondary" style="padding:6px 14px;" onclick="copyToClipboard()">复制链接</button>
  </div>
</section>
</main>
${renderScripts()}
<script>
async function shortenUrl() {
  const input = document.getElementById("longUrl");
  formatUrlInput(input, 'indexPreview'); // 生成前强制格式化一次
  const btn = document.getElementById("generateBtn");
  const longUrl = input.value.trim();
  if (!longUrl) return showToast("请输入有效的网址！");
  if (!longUrl.startsWith("http://") && !longUrl.startsWith("https://")) return showToast("网址格式错误");
  
  btn.disabled = true; btn.innerText = "生成中...";
  try {
    const res = await fetch("/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: longUrl }) });
    const data = await res.json();
    if (res.ok && data.short_url) {
      const finalUrl = window.location.origin + data.short_url;
      const link = document.getElementById("shortUrl");
      link.href = finalUrl; link.innerText = finalUrl;
      document.getElementById("resultBox").style.display = "block";
    } else {
      showToast("生成失败：" + (data.error || "未知错误"));
    }
  } catch(e) {
    showToast("网络错误，请稍后重试");
  } finally {
    btn.disabled = false; btn.innerText = "立即生成";
  }
}
async function copyToClipboard() {
  const text = document.getElementById("shortUrl").innerText;
  try {
    await navigator.clipboard.writeText(text);
    showToast("已复制到剪贴板！");
  } catch(e) {
    showToast("复制失败，请手动选择复制");
  }
}
</script>
</body>
</html>`;
}

function renderAdmin(adminUser) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>短链接管理后台</title>
<style>${getToolStyles()}</style>
</head>
<body>
<div id="toast" class="toast"></div>

<!-- 账户安全设置模态框 -->
<div class="modal-overlay" id="securityModal">
  <div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="section-title" style="font-size:20px;">🛡️ 账户与安全设置</h2>
    <div class="field">
      <label>后台登录账号 (USER)</label>
      <input type="text" id="sec-user" value="${escapeHTML(adminUser)}" placeholder="留空则无密码直接进入">
    </div>
    <div class="field">
      <label>后台登录密码 (PASS)</label>
      <input type="password" id="sec-pass" placeholder="输入新密码">
    </div>
    <div class="field">
      <label>确认新密码 (PASS)</label>
      <input type="password" id="sec-pass-confirm" placeholder="再次输入新密码">
    </div>
    <div class="modal-actions">
      <button class="secondary" onclick="closeSecurityModal()">取消</button>
      <button onclick="saveSecurity()">保存修改</button>
    </div>
  </div>
</div>

<!-- 编辑模态框 -->
<div class="modal-overlay" id="editModal">
  <div class="modal-content" onclick="event.stopPropagation()">
    <h2 class="section-title" style="font-size:20px;">编辑短链接</h2>
    <div class="field">
      <label>专属 Key</label>
      <input type="text" id="editKey" maxlength="64" oninput="updateEditLinkPreview()">
      <div id="editLinkPreview" class="edit-link-preview" style="display:none;" aria-label="链接预览">
        <span class="preview-label">链接预览：</span><span id="editLinkPreviewValue" class="preview-value" aria-disabled="true"></span>
      </div>
    </div>
    <div class="field">
      <label>目标 URL</label>
      <input type="url" id="editUrl" onblur="formatUrlInput(this)">
    </div>
    <div class="modal-actions">
      <button class="secondary" onclick="closeEditModal()">取消</button>
      <button onclick="saveEdit()">保存修改</button>
    </div>
  </div>
</div>

<main class="page">
  <header class="header">
    <div>
      <h1 class="title">短链接管理控制台</h1>
      <div class="subtitle">管理您的所有专属短链接</div>
    </div>
    <div style="display:flex; gap:8px;">
      <button class="secondary" onclick="openSecurityModal()">🛡️ 安全</button>
      <button class="danger" onclick="logoutAdmin()">🚪 退出</button>
    </div>
  </header>

  <section class="panel">
    <h2 class="section-title">添加新链接</h2>
    <div class="form-row">
      <div class="field" style="max-width: 200px;">
        <label>自定义 Key</label>
        <input type="text" id="addKey" maxlength="64" placeholder="例如：google">
      </div>
      <div class="field">
        <label>目标 URL</label>
        <input type="url" id="addUrl" placeholder="输入域名将自动补全 https://" onblur="formatUrlInput(this, 'addPreview')" oninput="updatePreview(this, 'addPreview')">
        <div id="addPreview" class="preview-box"></div>
      </div>
      <div style="margin-bottom: 0px; padding-bottom: 2px;">
        <button onclick="createLink()" style="height: 44px; min-height: 44px;">添加链接</button>
      </div>
    </div>
  </section>

  <section class="panel">
    <h2 class="section-title">所有短链接</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>专属 Key</th><th>目标 URL</th><th>操作</th></tr></thead>
        <tbody id="linkList"><tr><td colspan="3" class="empty">加载中...</td></tr></tbody>
      </table>
    </div>
  </section>
</main>
${renderScripts()}
<script>
let editingOldKey = "";

// ==== 安全设置逻辑 ====
function openSecurityModal() { document.getElementById('sec-pass').value = ''; document.getElementById('sec-pass-confirm').value = ''; document.getElementById('securityModal').style.display = 'flex'; }
function closeSecurityModal() { document.getElementById('securityModal').style.display = 'none'; document.getElementById('sec-pass').value = ''; document.getElementById('sec-pass-confirm').value = ''; }
async function saveSecurity() {
  const user = document.getElementById('sec-user').value.trim();
  const pass = document.getElementById('sec-pass').value;
  const confirmPass = document.getElementById('sec-pass-confirm').value;
  if (!pass || !confirmPass) return showToast("请将密码输入两次");
  if (pass !== confirmPass) return showToast("两次输入的密码不一致");
  try {
    const res = await fetch("/admin/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user, pass, confirm_pass: confirmPass }) });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || "设置保存失败");
    closeSecurityModal();
    showToast("安全设置已保存");
    setTimeout(() => logoutAdmin(), 500);
  } catch(e) { showToast("网络错误"); }
}

async function logoutAdmin() {
  try { await fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' }); } catch(e) {}
  window.location.replace('/');
}

// ==== 数据加载逻辑 ====
async function loadLinks() {
  const tbody = document.getElementById("linkList");
  try {
    const res = await fetch("/admin/api/links", { credentials: "same-origin", cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "加载失败");
    tbody.innerHTML = "";
    if (!Array.isArray(data.links) || data.links.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty">暂无短链接</td></tr>';
      return;
    }
    data.links.forEach(item => {
      const tr = document.createElement("tr");
      const keyTd = document.createElement("td");
      keyTd.className = "key-cell";
      keyTd.textContent = item.key;
      const urlTd = document.createElement("td");
      urlTd.className = "url-cell";
      const a = document.createElement("a");
      a.href = item.url; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.style.cssText = "color:#3b82f6;text-decoration:none;";
      a.textContent = item.url;
      urlTd.appendChild(a);
      const opTd = document.createElement("td");
      opTd.style.whiteSpace = "nowrap";
      const edit = document.createElement("button");
      edit.className = "secondary"; edit.style.cssText = "padding:6px 12px;min-height:auto;margin-right:6px;";
      edit.textContent = "编辑"; edit.onclick = () => openEditModal(item.key, item.url);
      const del = document.createElement("button");
      del.className = "danger"; del.style.cssText = "padding:6px 12px;min-height:auto;";
      del.textContent = "删除"; del.onclick = () => deleteLink(item.key);
      opTd.append(edit, del);
      tr.append(keyTd, urlTd, opTd);
      tbody.appendChild(tr);
    });
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">加载失败：' + escapeHtml(e.message) + '</td></tr>';
  }
}

async function createLink() {
  const input = document.getElementById("addUrl");
  formatUrlInput(input, 'addPreview');
  const key = document.getElementById("addKey").value.trim();
  const url = input.value.trim();
  if (!key) return showToast("请输入 Key");
  if (!url) return showToast("请输入目标 URL");
  
  try {
    const res = await fetch("/admin/api/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, url }) });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || "添加失败");
    document.getElementById("addKey").value = ""; document.getElementById("addUrl").value = "";
    updatePreview(input, 'addPreview');
    showToast("添加成功"); loadLinks();
  } catch(e) { showToast("网络错误，请稍后重试"); }
}

function updateEditLinkPreview() {
  const key = document.getElementById('editKey').value.trim();
  const preview = document.getElementById('editLinkPreview');
  const value = document.getElementById('editLinkPreviewValue');
  if (!key) { value.textContent = ''; preview.style.display = 'none'; return; }
  value.textContent = window.location.origin + '/' + key;
  value.style.pointerEvents = 'none';
  preview.style.display = 'block';
}

function openEditModal(key, url) {
  editingOldKey = key; document.getElementById('editKey').value = key; updateEditLinkPreview();
  const input = document.getElementById('editUrl');
  input.value = url;
  formatUrlInput(input);
  document.getElementById('editModal').style.display = 'flex';
}
function closeEditModal() { editingOldKey = ''; document.getElementById('editModal').style.display = 'none'; }

async function saveEdit() {
  const input = document.getElementById("editUrl");
  formatUrlInput(input);
  const newKey = document.getElementById("editKey").value.trim();
  const newUrl = input.value.trim();
  if (!newKey || !newUrl) return showToast("Key 或 URL 不能为空");
  try {
    const res = await fetch("/admin/api/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oldKey: editingOldKey, key: newKey, url: newUrl }) });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || "修改失败");
    closeEditModal(); showToast("修改成功"); loadLinks();
  } catch(e) { showToast("网络错误"); }
}

async function deleteLink(key) {
  if (!confirm(\`确定要删除 Key 为「\${key}」的短链接吗？\`)) return;
  try {
    const res = await fetch("/admin/api/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || "删除失败");
    showToast("删除成功"); loadLinks();
  } catch(e) { showToast("网络错误"); }
}

document.getElementById('editModal').addEventListener('click', closeEditModal);
document.getElementById('securityModal').addEventListener('click', closeSecurityModal);
document.addEventListener('keydown', e => { 
  if (e.key === 'Escape') { closeEditModal(); closeSecurityModal(); }
});
loadLinks();
</script>
</body>
</html>`;
}

function renderLoginPage(error = '') {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<title>登录控制台</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${getToolStyles()}</style>
</head>
<body style="display:flex; justify-content:center; align-items:center; min-height:100vh;">
<main class="page" style="width:100%; max-width:420px;">
<section class="panel" style="padding:40px 30px; text-align:center;">
  <h1 class="title" style="margin-bottom:10px;">控制台登录</h1>
  <div class="subtitle" style="margin-bottom:30px;">请验证管理员身份</div>
  <form method="POST" action="/admin/login" style="text-align:left;">
    <div class="field"><label>用户名</label><input name="username" type="text" required autofocus></div>
    <div class="field"><label>密码</label><input name="password" type="password" required></div>
    <button type="submit" style="width:100%; margin-top:14px;">安全登录</button>
    ${error ? `<div style="text-align:center; margin-top:15px; color:#dc3545; font-weight:600;">${escapeHTML(error)}</div>` : ''}
  </form>
</section>
</main>
</body>
</html>`;
}

function render404() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>404 未找到</title>
<style>${getToolStyles()}</style>
</head>
<body style="display:flex; justify-content:center; align-items:center; min-height:80vh;">
<main class="page" style="width:100%; max-width:420px;">
<section class="panel" style="text-align:center; padding: 40px;">
  <h1 class="title" style="font-size: 64px; color: #dc3545; margin-bottom: 10px;">404</h1>
  <p style="margin-bottom: 30px; color: #666; font-size: 15px;">抱歉，您访问的短链接不存在或已过期。</p>
  <button class="secondary" onclick="window.location.href='/'">返回首页</button>
</section>
</main>
</body>
</html>`;
}

// ================= API 请求核心路由 =================
export default {
  async fetch(request, env) {
    if (!env.KV) return new Response("Error: 请先在配置中绑定 KV 命名空间为 LINKS", { status: 500 });

    const requestURL = new URL(request.url);
    const path = requestURL.pathname;
    
    // CORS OPTIONS
    if (request.method === "OPTIONS") return new Response("", { headers: jsonHeaders });

    // === 读取安全配置 (KV 优先, 环境变量兜底) ===
    let kvConfig = {};
    try {
      const kvStr = await env.KV.get('CONFIG.json');
      if (kvStr) kvConfig = JSON.parse(kvStr);
    } catch (e) {}
    const adminUser = kvConfig.user !== undefined ? kvConfig.user : (env.USER || '');
    const adminPass = kvConfig.pass !== undefined ? kvConfig.pass : (env.PASS || '');

    // === 后台路由与鉴权拦截 ===
    if (path.startsWith("/admin")) {
      
      // 如果设置了密码，执行鉴权
      if (isAdminLoginEnabled(adminUser, adminPass)) {
        const isLoggedIn = await isAdminLoggedIn(request, adminUser, adminPass);
        
        // 未登录处理
        if (!isLoggedIn) {
          if (request.method === 'POST' && path === '/admin/login') {
            return await handleAdminLogin(request, adminUser, adminPass);
          }
          if (path.startsWith('/admin/api')) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders });
          }
          return new Response(renderLoginPage(), { headers: htmlHeaders });
        }
      }
      
      // 安全退出
      if (path === '/admin/logout') {
        if (request.method !== 'POST') {
          return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: jsonHeaders });
        }
        const secure = requestURL.protocol === 'https:' ? '; Secure' : '';
        return new Response(JSON.stringify({ status: 200, message: '退出成功' }), {
          status: 200,
          headers: { ...jsonHeaders, 'Set-Cookie': `CF_SHORT_ADMIN=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`, 'Cache-Control': 'no-store' }
        });
      }

      // 后台首页
      if (request.method === "GET" && path === "/admin") {
        return new Response(renderAdmin(adminUser), { headers: htmlHeaders });
      }

      // API 接口
      if (path.startsWith("/admin/api")) {
        try {
          // 保存账户设置
          if (request.method === "POST" && path === "/admin/api/config") {
            const req = await request.json();
            
            // 密码留空时保持原密码
            const newUser = typeof req.user === 'string' ? req.user.trim() : '';
            const newPass = typeof req.pass === 'string' ? req.pass : '';
            const confirmPass = typeof req.confirm_pass === 'string' ? req.confirm_pass : '';
            if (!newPass || !confirmPass) throw new Error("密码必须输入两次");
            if (newPass !== confirmPass) throw new Error("两次输入的密码不一致");
            await env.KV.put('CONFIG.json', JSON.stringify({ user: newUser, pass: newPass }));
            return new Response(JSON.stringify({ status: 200, message: "设置已保存" }), { headers: jsonHeaders });
          }
          
          if (request.method === "GET" && path === "/admin/api/links") {
            return new Response(JSON.stringify({ status: 200, links: await adminListLinks(env) }), { headers: jsonHeaders });
          }
          if (request.method === "POST") {
            const req = await request.json();
            if (path === "/admin/api/create") {
              await adminCreateLink(env, req.key, req.url);
              return new Response(JSON.stringify({ status: 200, message: "添加成功" }), { headers: jsonHeaders });
            }
            if (path === "/admin/api/update") {
              await adminUpdateLink(env, req.oldKey, req.key, req.url);
              return new Response(JSON.stringify({ status: 200, message: "修改成功" }), { headers: jsonHeaders });
            }
            if (path === "/admin/api/delete") {
              await adminDeleteLink(env, req.key);
              return new Response(JSON.stringify({ status: 200, message: "删除成功" }), { headers: jsonHeaders });
            }
          }
        } catch (e) {
          return new Response(JSON.stringify({ status: 400, error: e.message || "操作失败" }), { status: 400, headers: jsonHeaders });
        }
      }
    }

    // === sub-web-modify 短链接兼容 API ===
    // POST /api/shorten
    // 请求：{ "url": "https://example.com/..." }
    // 返回：{ "url": "https://本站域名/Key", "short_url": "https://本站域名/Key", "key": "Key" }
    if (request.method === "POST" && path === "/api/shorten") {
      try {
        let req = {};
        const contentType = request.headers.get("Content-Type") || "";

        if (contentType.toLowerCase().includes("application/json")) {
          req = await request.json();
        } else {
          const form = await request.formData();
          req = { url: form.get("url") || form.get("target") || form.get("long_url") || "" };
        }

        const url = typeof req.url === "string"
          ? req.url.trim()
          : (typeof req.target === "string"
            ? req.target.trim()
            : (typeof req.long_url === "string" ? req.long_url.trim() : ""));

        if (!url) {
          return new Response(JSON.stringify({
            status: 400,
            error: "缺少 url 参数"
          }), { status: 400, headers: jsonHeaders });
        }

        const key = await apiCreateShortLink(env, url);
        const baseUrl = requestURL.origin;
        const shortUrl = `${baseUrl}/${key}`;

        return new Response(JSON.stringify({
          status: 200,
          key: key,
          url: shortUrl,
          short_url: shortUrl
        }), { headers: jsonHeaders });
      } catch (e) {
        return new Response(JSON.stringify({
          status: 400,
          error: e.message || "生成短链接失败"
        }), { status: 400, headers: jsonHeaders });
      }
    }

    // === 普通前台生成 ===
    if (request.method === "POST" && path === "/") {
      try {
        const req = await request.json();
        const url = typeof req.url === "string" ? req.url.trim() : "";
        if (!await checkURL(url)) return new Response(JSON.stringify({ status: 400, error: "网址格式不正确" }), { status: 400, headers: jsonHeaders });

        let key;
        if (config.unique_link) {
          const hash = await sha512(url);
          const existing = await is_url_exist(env, hash);
          if (existing) {
            key = existing;
          } else {
            key = await save_url(env, url);
            await env.KV.put(hash, key, getKvPutOptions());
          }
        } else {
          key = await save_url(env, url);
        }
        return new Response(JSON.stringify({ status: 200, key: "/" + key, short_url: "/" + key }), { headers: jsonHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ status: 500, error: e.message || "生成短链接失败" }), { status: 500, headers: jsonHeaders });
      }
    }

    // === GET 请求与短链接跳转 ===
    if (request.method === "GET") {
      if (path === "/") return new Response(renderIndex(), { headers: htmlHeaders });

      const key = path.substring(1);
      if (!key || key.indexOf("/") !== -1) return new Response(render404(), { status: 404, headers: htmlHeaders });

      const value = await env.KV.get(key);
      if (value) {
        const location = requestURL.search ? value + requestURL.search : value;
        return Response.redirect(location, 302);
      }
      return new Response(render404(), { status: 404, headers: htmlHeaders });
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
};
