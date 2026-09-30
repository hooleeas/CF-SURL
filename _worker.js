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

// ================= 管理后台路径 =================
const DEFAULT_ADMIN_PATH = "admin";

function normalizeAdminPath(value) {
  const path = String(value ?? "").trim();
  if (!path) return DEFAULT_ADMIN_PATH;
  if (path.length > 64) throw new Error("管理员后台路径最长 64 个字符");
  if (!/^[A-Za-z0-9_-]+$/.test(path)) {
    throw new Error("管理员后台路径只能使用字母、数字、下划线和短横线，且不要输入 / ");
  }
  if (["api", "config"].includes(path.toLowerCase())) {
    throw new Error("管理员后台路径不能使用系统保留字");
  }
  return path;
}

function getAdminBasePath(adminPath) {
  return `/${normalizeAdminPath(adminPath)}`;
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

async function handleAdminLogin(request, user, pass, adminPath = DEFAULT_ADMIN_PATH) {
  let inputUser = '';
  let inputPass = '';
  try {
    const form = await request.formData();
    inputUser = String(form.get('username') || '');
    inputPass = String(form.get('password') || '');
  } catch (e) {
    return new Response(renderLoginPage('登录请求格式不正确', adminPath), { status: 400, headers: htmlHeaders });
  }
  if (inputUser === user && inputPass === pass) {
    const session = await getAdminSessionValue(user, pass);
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    return new Response('', {
      status: 302,
      headers: {
        'Location': getAdminBasePath(adminPath),
        'Set-Cookie': `CF_SHORT_ADMIN=${encodeURIComponent(session)}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax${secure}`,
        'Cache-Control': 'no-store'
      }
    });
  }
  return new Response(renderLoginPage('用户名或密码错误', adminPath), { status: 401, headers: htmlHeaders });
}

// ================= UI 渲染模块 =================
function escapeHTML(text = '') {
  return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}


function getToolStyles() {
  return `
    :root{
      --bg:#f4f7f5;
      --card:rgba(255,255,255,.86);
      --card-solid:#fff;
      --text:#17211b;
      --muted:#6f7b74;
      --line:rgba(35,65,48,.10);
      --green:#16a36a;
      --green-dark:#087a4b;
      --green-soft:rgba(22,163,106,.10);
      --danger:#d84a4a;
      --shadow:0 18px 55px rgba(22,55,39,.09);
      --radius:22px;
    }
    *{box-sizing:border-box}
    html{min-height:100%;background:var(--bg)}
    body{
      margin:0;min-height:100vh;color:var(--text);
      font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
      background:
        radial-gradient(circle at 10% 0%,rgba(66,211,146,.16),transparent 30%),
        radial-gradient(circle at 95% 10%,rgba(35,177,117,.11),transparent 28%),
        var(--bg);
      font-size:14px;line-height:1.55;
    }
    a{color:inherit}
    button,input{font:inherit}
    button{
      min-height:42px;padding:9px 17px;border:1px solid #168e5d;border-radius:12px;
      background:linear-gradient(135deg,#18aa70,#0f8b59);color:#fff;font-weight:650;
      cursor:pointer;transition:.2s ease;box-shadow:0 6px 18px rgba(16,143,91,.16);
    }
    button:hover{transform:translateY(-1px);box-shadow:0 9px 24px rgba(16,143,91,.22)}
    button:active{transform:translateY(0)}
    button:disabled{opacity:.55;cursor:default;transform:none;box-shadow:none}
    button.secondary{
      background:rgba(255,255,255,.72);color:#26332c;border-color:rgba(40,74,57,.16);
      box-shadow:none
    }
    button.secondary:hover{background:#fff;border-color:rgba(22,163,106,.35)}
    button.danger{background:linear-gradient(135deg,#e55a5a,#cc3f46);border-color:#cc3f46}
    .page{width:min(1120px,calc(100% - 28px));margin:0 auto;padding:34px 0 48px}
    .narrow{width:min(560px,calc(100% - 28px))}
    .header{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:22px}
    .brand{display:flex;align-items:center;gap:13px}
    .brand-mark{
      width:44px;height:44px;border-radius:14px;
      background:linear-gradient(145deg,#2bd28e,#078653);
      box-shadow:0 10px 25px rgba(16,143,91,.22);
      position:relative;overflow:hidden
    }
    .brand-mark:after{content:"";position:absolute;width:28px;height:28px;border:2px solid rgba(255,255,255,.72);border-radius:9px;left:8px;top:8px;transform:rotate(12deg)}
    .title{margin:0;font-size:28px;line-height:1.2;font-weight:760;letter-spacing:-.5px}
    .subtitle{margin-top:7px;color:var(--muted);font-size:13px}
    .panel{
      background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
      padding:24px;box-shadow:var(--shadow);backdrop-filter:blur(18px);margin-bottom:18px
    }
    .section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}
    .section-title{margin:0;font-size:17px;font-weight:720}
    .section-desc{margin:4px 0 0;color:var(--muted);font-size:13px}
    .field{margin-bottom:14px}
    label{display:block;margin-bottom:7px;font-weight:650;font-size:13px}
    input{
      width:100%;height:46px;padding:10px 14px;border:1px solid rgba(37,72,54,.14);
      border-radius:13px;background:rgba(255,255,255,.76);color:var(--text);outline:none;
      transition:.2s ease
    }
    input:focus{border-color:rgba(22,163,106,.65);box-shadow:0 0 0 4px rgba(22,163,106,.10);background:#fff}
    .form-grid{display:grid;grid-template-columns:220px 1fr auto;gap:12px;align-items:end}
    .form-grid .field{margin:0}
    .hint{color:var(--muted);font-size:12px;margin-top:6px}
    .toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:9px}
    .toolbar .search{flex:1;min-width:220px}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}
    .stat{
      padding:17px 18px;border:1px solid var(--line);border-radius:18px;
      background:rgba(255,255,255,.62)
    }
    .stat-label{color:var(--muted);font-size:12px}
    .stat-value{font-size:25px;font-weight:760;margin-top:4px;letter-spacing:-.5px}
    .table-wrap{overflow:auto;border:1px solid var(--line);border-radius:16px}
    table{width:100%;border-collapse:collapse;min-width:720px;background:rgba(255,255,255,.34)}
    th,td{padding:14px 13px;text-align:left;border-bottom:1px solid var(--line);vertical-align:middle}
    th{font-size:12px;color:var(--muted);font-weight:680;white-space:nowrap;background:rgba(248,250,249,.7)}
    tbody tr:last-child td{border-bottom:0}
    tbody tr:hover{background:rgba(22,163,106,.035)}
    .key-cell{font-weight:700;white-space:nowrap}
    .url-cell{max-width:420px;word-break:break-all}
    .url-link{color:#087f51;text-decoration:none}
    .url-link:hover{text-decoration:underline}
    .actions{display:flex;justify-content:flex-end;gap:7px;white-space:nowrap}
    .actions button{min-height:36px;padding:7px 12px;font-size:13px}
    .check{width:17px;height:17px;accent-color:var(--green)}
    .empty{text-align:center;color:var(--muted);padding:38px 20px}
    .bulkbar{
      display:none;align-items:center;justify-content:space-between;gap:12px;
      margin-top:12px;padding:11px 13px;border:1px solid rgba(22,163,106,.15);
      border-radius:14px;background:var(--green-soft)
    }
    .bulkbar.show{display:flex}
    .bulkbar-info{font-size:13px;font-weight:650}
    .modal-overlay{
      position:fixed;inset:0;display:none;align-items:center;justify-content:center;
      padding:18px;background:rgba(9,22,15,.28);backdrop-filter:blur(12px);z-index:1000
    }
    .modal-content{
      width:min(500px,100%);background:rgba(255,255,255,.95);border:1px solid rgba(255,255,255,.7);
      border-radius:24px;padding:25px;box-shadow:0 28px 80px rgba(10,35,22,.22)
    }
    .modal-title-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px}
    .modal-close{
      width:36px;height:36px;min-height:36px;padding:0;border-radius:11px;background:rgba(30,50,40,.06);
      color:#516057;border:0;box-shadow:none;font-size:20px
    }
    .modal-close:hover{background:rgba(30,50,40,.11);box-shadow:none}
    .modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:22px}
    .result-box{
      display:none;margin-top:17px;padding:17px;border-radius:17px;
      background:linear-gradient(135deg,rgba(37,198,128,.10),rgba(22,163,106,.04));
      border:1px solid rgba(22,163,106,.16)
    }
    .result-url{display:block;color:var(--green-dark);font-weight:700;word-break:break-all;text-decoration:none;margin:6px 0 13px}
    .toast{
      position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
      display:none;padding:12px 18px;border-radius:13px;background:rgba(19,27,23,.94);
      color:#fff;z-index:9999;font-weight:600;box-shadow:0 14px 45px rgba(0,0,0,.22)
    }
    .login-card{text-align:center;padding:34px}
    .login-card form{text-align:left;margin-top:24px}
    .login-error{margin-top:13px;text-align:center;color:#cf4148;font-weight:600}
    .footer-note{text-align:center;color:var(--muted);font-size:12px;margin-top:18px}
    @media(max-width:760px){
      .page{padding-top:22px}
      .header{align-items:flex-start;flex-direction:column}
      .header-actions{width:100%;display:grid!important;grid-template-columns:repeat(3,1fr)}
      .header-actions button{width:100%;padding-left:8px;padding-right:8px}
      .form-grid{grid-template-columns:1fr}
      .stats{grid-template-columns:1fr 1fr}
      .panel{padding:18px}
      .title{font-size:24px}
    }
    @media(max-width:460px){
      .stats{grid-template-columns:1fr}
      .toolbar{align-items:stretch}
      .toolbar button{flex:1}
      .toolbar .search{min-width:100%}
      .bulkbar{align-items:flex-start;flex-direction:column}
      .bulkbar .toolbar{width:100%}
      .bulkbar button{width:100%}
      .modal-content{padding:20px;border-radius:20px}
    }
    @media(prefers-color-scheme:dark){
      :root{--bg:#0c1210;--card:rgba(20,29,25,.82);--card-solid:#141d19;--text:#e8f0eb;--muted:#9ca9a2;--line:rgba(255,255,255,.09);--green-soft:rgba(41,201,132,.12)}
      body{background:radial-gradient(circle at 10% 0%,rgba(42,193,127,.13),transparent 30%),radial-gradient(circle at 95% 10%,rgba(22,120,82,.13),transparent 28%),var(--bg)}
      .panel,.stat{background:var(--card)}
      input{background:rgba(9,15,12,.72);color:var(--text);border-color:rgba(255,255,255,.10)}
      input:focus{background:#0b100d}
      button.secondary{background:rgba(255,255,255,.07);color:var(--text);border-color:rgba(255,255,255,.12)}
      button.secondary:hover{background:rgba(255,255,255,.11)}
      table{background:rgba(10,16,13,.25)}
      th{background:rgba(255,255,255,.035)}
      .url-link{color:#65d7a5}
      .modal-content{background:rgba(22,31,27,.97);border-color:rgba(255,255,255,.09)}
      .modal-close{background:rgba(255,255,255,.07);color:#b8c5bd}
    }
  `;
}

function renderScripts() {
  return `
    <script>
      let toastTimer;
      function showToast(message){
        const el=document.getElementById('toast');
        if(!el)return;
        el.textContent=message;
        el.style.display='block';
        clearTimeout(toastTimer);
        toastTimer=setTimeout(()=>el.style.display='none',1800);
      }
      function escapeHtml(text){
        const div=document.createElement('div');
        div.textContent=String(text ?? '');
        return div.innerHTML;
      }
      function formatUrlInput(inputEl){
        let val=String(inputEl.value||'').trim();
        if(val && !/^https?:\\/\\//i.test(val)) val='https://'+val;
        inputEl.value=val;
      }
    </script>
  `;
}

function renderIndex() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#16a36a">
<title>CF-SURL</title>
<style>${getToolStyles()}</style>
</head>
<body>
<div id="toast" class="toast"></div>
<main class="page narrow" style="padding-top:12vh">
  <section class="panel" style="padding:30px">
    <div class="brand" style="margin-bottom:24px">
      <div class="brand-mark"></div>
      <div><h1 class="title">CF-SURL</h1><div class="subtitle">短链接生成与管理</div></div>
    </div>
    <div class="field">
      <label for="longUrl">目标 URL</label>
      <input type="url" id="longUrl" placeholder="输入完整网址，例如 example.com" autocomplete="off">
      <div class="hint">支持直接输入域名，生成时会自动补全 HTTPS。</div>
    </div>
    <button id="generateBtn" style="width:100%;margin-top:4px" onclick="shortenUrl()">生成短链接</button>
    <div class="result-box" id="resultBox">
      <div style="font-size:12px;color:var(--muted)">短链接已生成</div>
      <a href="#" id="shortUrl" target="_blank" rel="noopener noreferrer" class="result-url"></a>
      <div class="toolbar">
        <button class="secondary" type="button" onclick="copyToClipboard()">复制链接</button>
        <button class="secondary" type="button" onclick="openShortUrl()">打开链接</button>
      </div>
    </div>
  </section>
  <div class="footer-note">CF-SURL</div>
</main>
${renderScripts()}
<script>
async function shortenUrl(){
  const input=document.getElementById('longUrl');
  formatUrlInput(input);
  const btn=document.getElementById('generateBtn');
  const longUrl=input.value.trim();
  if(!longUrl)return showToast('请输入目标 URL');
  if(!/^https?:\\/\\//i.test(longUrl))return showToast('网址格式不正确');
  btn.disabled=true;btn.textContent='生成中...';
  try{
    const res=await fetch('/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:longUrl})});
    const data=await res.json();
    if(!res.ok||!data.short_url)return showToast(data.error||'生成失败');
    const finalUrl=new URL(data.short_url,location.origin).href;
    const link=document.getElementById('shortUrl');
    link.href=finalUrl;link.textContent=finalUrl;
    document.getElementById('resultBox').style.display='block';
  }catch(e){showToast('网络错误，请稍后重试')}
  finally{btn.disabled=false;btn.textContent='生成短链接'}
}
function openShortUrl(){const a=document.getElementById('shortUrl');if(a&&a.href)window.open(a.href,'_blank','noopener')}
async function copyToClipboard(){
  const text=document.getElementById('shortUrl').textContent;
  try{await navigator.clipboard.writeText(text);showToast('已复制')}
  catch(e){showToast('复制失败，请手动复制')}
}
</script>
</body>
</html>`;
}

function renderAdmin(adminUser, adminPath = DEFAULT_ADMIN_PATH) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#16a36a">
<title>CF-SURL 管理后台</title>
<style>${getToolStyles()}</style>
</head>
<body>
<div id="toast" class="toast"></div>

<div class="modal-overlay" id="securityModal">
  <div class="modal-content" onclick="event.stopPropagation()">
    <div class="modal-title-row"><h2 class="section-title">账户与安全</h2><button class="modal-close" onclick="closeSecurityModal()">×</button></div>
    <div class="field"><label>后台登录账号</label><input type="text" id="sec-user" value="${escapeHTML(adminUser)}" placeholder="留空则关闭登录验证"></div>
    <div class="field"><label>后台登录密码</label><input type="password" id="sec-pass" placeholder="输入新密码"></div>
    <div class="field"><label>确认新密码</label><input type="password" id="sec-pass-confirm" placeholder="再次输入新密码"></div>
    <div class="modal-actions"><button class="secondary" onclick="closeSecurityModal()">取消</button><button onclick="saveSecurity()">保存</button></div>
  </div>
</div>

<div class="modal-overlay" id="adminPathModal">
  <div class="modal-content" onclick="event.stopPropagation()">
    <div class="modal-title-row"><h2 class="section-title">后台路径</h2><button class="modal-close" onclick="closeAdminPathModal()">×</button></div>
    <div class="field">
      <label>自定义后台路径</label>
      <input type="text" id="admin-path-input" value="${escapeHTML(adminPath)}" maxlength="64" placeholder="例如 admin-panel">
      <div class="hint">只填写路径名称，不要输入 /。</div>
    </div>
    <div class="modal-actions"><button class="secondary" onclick="closeAdminPathModal()">取消</button><button onclick="saveAdminPath()">保存</button></div>
  </div>
</div>

<div class="modal-overlay" id="editModal">
  <div class="modal-content" onclick="event.stopPropagation()">
    <div class="modal-title-row"><h2 class="section-title">编辑短链接</h2><button class="modal-close" onclick="closeEditModal()">×</button></div>
    <div class="field">
      <label>短链接 Key</label>
      <input type="text" id="editKey" maxlength="64" oninput="updateEditLinkPreview()">
      <div id="editLinkPreview" class="hint" style="display:none;margin-top:8px"></div>
    </div>
    <div class="field"><label>目标 URL</label><input type="url" id="editUrl" onblur="formatUrlInput(this)"></div>
    <div class="modal-actions"><button class="secondary" onclick="closeEditModal()">取消</button><button onclick="saveEdit()">保存修改</button></div>
  </div>
</div>

<main class="page">
  <header class="header">
    <div class="brand">
      <div class="brand-mark"></div>
      <div><h1 class="title">CF-SURL</h1><div class="subtitle">短链接管理控制台</div></div>
    </div>
    <div class="header-actions" style="display:flex;gap:8px">
      <button class="secondary" onclick="openSecurityModal()">安全设置</button>
      <button class="secondary" onclick="openAdminPathModal()">后台路径</button>
      <button class="danger" onclick="logoutAdmin()">退出登录</button>
    </div>
  </header>

  <section class="stats">
    <div class="stat"><div class="stat-label">短链接总数</div><div class="stat-value" id="statTotal">-</div></div>
    <div class="stat"><div class="stat-label">当前显示</div><div class="stat-value" id="statShown">-</div></div>
    <div class="stat"><div class="stat-label">已选择</div><div class="stat-value" id="statSelected">0</div></div>
  </section>

  <section class="panel">
    <div class="section-head">
      <div><h2 class="section-title">创建短链接</h2><p class="section-desc">自定义 Key 后即可直接使用 /Key 访问。</p></div>
    </div>
    <div class="form-grid">
      <div class="field"><label>自定义 Key</label><input type="text" id="addKey" maxlength="64" placeholder="例如 google"></div>
      <div class="field"><label>目标 URL</label><input type="url" id="addUrl" placeholder="输入域名或完整网址" onblur="formatUrlInput(this)"></div>
      <button onclick="createLink()">添加链接</button>
    </div>
  </section>

  <section class="panel">
    <div class="section-head">
      <div><h2 class="section-title">短链接列表</h2><p class="section-desc">支持搜索、编辑、复制、打开和批量删除。</p></div>
      <button class="secondary" onclick="loadLinks()">刷新</button>
    </div>
    <div class="toolbar" style="margin-bottom:12px">
      <input class="search" id="searchInput" type="search" placeholder="搜索 Key 或目标 URL" oninput="renderFilteredLinks()">
      <button class="secondary" onclick="selectAllVisible()">全选当前</button>
      <button class="secondary" onclick="clearSelection()">取消选择</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th style="width:45px"><input class="check" id="selectAll" type="checkbox" onchange="toggleAllVisible(this.checked)"></th><th>Key</th><th>目标 URL</th><th style="text-align:right">操作</th></tr></thead>
        <tbody id="linkList"><tr><td colspan="4" class="empty">加载中...</td></tr></tbody>
      </table>
    </div>
    <div class="bulkbar" id="bulkBar">
      <div class="bulkbar-info">已选择 <span id="selectedCount">0</span> 个链接</div>
      <div class="toolbar"><button class="secondary" onclick="clearSelection()">取消选择</button><button class="danger" onclick="deleteSelected()">删除所选</button></div>
    </div>
  </section>
</main>
${renderScripts()}
<script>
let editingOldKey='';
let allLinks=[];
let selectedKeys=new Set();

function openSecurityModal(){document.getElementById('sec-pass').value='';document.getElementById('sec-pass-confirm').value='';document.getElementById('securityModal').style.display='flex'}
function closeSecurityModal(){document.getElementById('securityModal').style.display='none';document.getElementById('sec-pass').value='';document.getElementById('sec-pass-confirm').value=''}
async function saveSecurity(){
  const user=document.getElementById('sec-user').value.trim(),pass=document.getElementById('sec-pass').value,confirmPass=document.getElementById('sec-pass-confirm').value;
  if(!pass||!confirmPass)return showToast('请将密码输入两次');
  if(pass!==confirmPass)return showToast('两次输入的密码不一致');
  try{
    const res=await fetch("${getAdminBasePath(adminPath)}/api/config",{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user,pass,confirm_pass:confirmPass})});
    const data=await res.json();if(!res.ok)return showToast(data.error||'保存失败');
    closeSecurityModal();window.location.replace('/');
  }catch(e){showToast('网络错误')}
}
function openAdminPathModal(){document.getElementById('admin-path-input').value=${JSON.stringify(adminPath)};document.getElementById('adminPathModal').style.display='flex'}
function closeAdminPathModal(){document.getElementById('adminPathModal').style.display='none'}
async function saveAdminPath(){
  const value=document.getElementById('admin-path-input').value.trim();
  if(!value)return showToast('后台路径不能为空');
  if(!/^[A-Za-z0-9_-]+$/.test(value))return showToast('路径只能使用字母、数字、下划线和短横线');
  if(value.length>64)return showToast('后台路径最长 64 个字符');
  if(['api','config'].includes(value.toLowerCase()))return showToast('该路径为系统保留字');
  try{
    const res=await fetch("${getAdminBasePath(adminPath)}/api/config",{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({admin_path:value})});
    const data=await res.json();if(!res.ok)return showToast(data.error||'保存失败');
    closeAdminPathModal();window.location.replace('/');
  }catch(e){showToast('网络错误')}
}
async function logoutAdmin(){
  try{await fetch('/'+${JSON.stringify(adminPath)}+'/logout',{method:'POST',credentials:'same-origin'})}catch(e){}
  window.location.replace('/');
}

async function loadLinks(){
  const tbody=document.getElementById('linkList');
  tbody.innerHTML='<tr><td colspan="4" class="empty">加载中...</td></tr>';
  try{
    const res=await fetch("${getAdminBasePath(adminPath)}/api/links",{credentials:'same-origin',cache:'no-store'});
    const data=await res.json();if(!res.ok)throw new Error(data.error||'加载失败');
    allLinks=Array.isArray(data.links)?data.links:[];
    const validKeys=new Set(allLinks.map(x=>x.key));selectedKeys=new Set([...selectedKeys].filter(k=>validKeys.has(k)));
    document.getElementById('statTotal').textContent=allLinks.length;
    renderFilteredLinks();
  }catch(e){
    tbody.innerHTML='<tr><td colspan="4" class="empty">加载失败：'+escapeHtml(e.message)+'</td></tr>';
  }
}
function getFilteredLinks(){
  const q=document.getElementById('searchInput').value.trim().toLowerCase();
  if(!q)return allLinks;
  return allLinks.filter(item=>String(item.key).toLowerCase().includes(q)||String(item.url).toLowerCase().includes(q));
}
function renderFilteredLinks(){
  const tbody=document.getElementById('linkList'),items=getFilteredLinks();
  document.getElementById('statShown').textContent=items.length;
  document.getElementById('statSelected').textContent=selectedKeys.size;
  document.getElementById('selectedCount').textContent=selectedKeys.size;
  document.getElementById('bulkBar').classList.toggle('show',selectedKeys.size>0);
  const master=document.getElementById('selectAll');
  master.checked=items.length>0&&items.every(x=>selectedKeys.has(x.key));
  master.indeterminate=items.some(x=>selectedKeys.has(x.key))&&!master.checked;
  if(!items.length){tbody.innerHTML='<tr><td colspan="4" class="empty">'+(allLinks.length?'没有匹配的短链接':'暂无短链接')+'</td></tr>';return}
  tbody.innerHTML='';
  items.forEach(item=>{
    const tr=document.createElement('tr');
    const checkTd=document.createElement('td');
    const check=document.createElement('input');check.type='checkbox';check.className='check';check.checked=selectedKeys.has(item.key);
    check.onchange=()=>{check.checked?selectedKeys.add(item.key):selectedKeys.delete(item.key);renderFilteredLinks()};
    checkTd.appendChild(check);
    const keyTd=document.createElement('td');keyTd.className='key-cell';keyTd.textContent=item.key;
    const urlTd=document.createElement('td');urlTd.className='url-cell';
    const a=document.createElement('a');a.className='url-link';a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=item.url;urlTd.appendChild(a);
    const opTd=document.createElement('td');const actions=document.createElement('div');actions.className='actions';
    const copy=document.createElement('button');copy.className='secondary';copy.textContent='复制';copy.onclick=()=>copyText(new URL('/'+item.key,location.origin).href);
    const open=document.createElement('button');open.className='secondary';open.textContent='打开';open.onclick=()=>window.open('/'+encodeURIComponent(item.key),'_blank','noopener');
    const edit=document.createElement('button');edit.className='secondary';edit.textContent='编辑';edit.onclick=()=>openEditModal(item.key,item.url);
    const del=document.createElement('button');del.className='danger';del.textContent='删除';del.onclick=()=>deleteLink(item.key);
    actions.append(copy,open,edit,del);opTd.appendChild(actions);
    tr.append(checkTd,keyTd,urlTd,opTd);tbody.appendChild(tr);
  });
}
function selectAllVisible(){toggleAllVisible(true)}
function clearSelection(){selectedKeys.clear();renderFilteredLinks()}
function toggleAllVisible(checked){
  getFilteredLinks().forEach(x=>checked?selectedKeys.add(x.key):selectedKeys.delete(x.key));
  renderFilteredLinks();
}
async function copyText(text){
  try{await navigator.clipboard.writeText(text);showToast('已复制')}catch(e){showToast('复制失败')}
}
async function createLink(){
  const key=document.getElementById('addKey').value.trim(),input=document.getElementById('addUrl');formatUrlInput(input);const url=input.value.trim();
  if(!key)return showToast('请输入 Key');if(!url)return showToast('请输入目标 URL');
  try{
    const res=await fetch("${getAdminBasePath(adminPath)}/api/create",{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,url})});
    const data=await res.json();if(!res.ok)return showToast(data.error||'添加失败');
    document.getElementById('addKey').value='';input.value='';showToast('添加成功');await loadLinks();
  }catch(e){showToast('网络错误，请稍后重试')}
}
function updateEditLinkPreview(){
  const key=document.getElementById('editKey').value.trim(),el=document.getElementById('editLinkPreview');
  if(!key){el.style.display='none';return}
  el.textContent=location.origin+'/'+key;el.style.display='block';
}
function openEditModal(key,url){
  editingOldKey=key;document.getElementById('editKey').value=key;document.getElementById('editUrl').value=url;formatUrlInput(document.getElementById('editUrl'));updateEditLinkPreview();document.getElementById('editModal').style.display='flex'
}
function closeEditModal(){editingOldKey='';document.getElementById('editModal').style.display='none'}
async function saveEdit(){
  const input=document.getElementById('editUrl');formatUrlInput(input);const newKey=document.getElementById('editKey').value.trim(),newUrl=input.value.trim();
  if(!newKey||!newUrl)return showToast('Key 或 URL 不能为空');
  try{
    const res=await fetch("${getAdminBasePath(adminPath)}/api/update",{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({oldKey:editingOldKey,key:newKey,url:newUrl})});
    const data=await res.json();if(!res.ok)return showToast(data.error||'修改失败');
    closeEditModal();showToast('修改成功');await loadLinks();
  }catch(e){showToast('网络错误')}
}
async function deleteLink(key){
  if(!confirm('确定删除短链接「'+key+'」吗？'))return;
  try{
    const res=await fetch("${getAdminBasePath(adminPath)}/api/delete",{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});
    const data=await res.json();if(!res.ok)return showToast(data.error||'删除失败');
    selectedKeys.delete(key);showToast('删除成功');await loadLinks();
  }catch(e){showToast('网络错误')}
}
async function deleteSelected(){
  const keys=[...selectedKeys];if(!keys.length)return;
  if(!confirm('确定删除已选择的 '+keys.length+' 个短链接吗？'))return;
  try{
    const res=await fetch("${getAdminBasePath(adminPath)}/api/bulk-delete",{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keys})});
    const data=await res.json();if(!res.ok)return showToast(data.error||'批量删除失败');
    selectedKeys.clear();showToast('已删除 '+(data.deleted||0)+' 个链接');await loadLinks();
  }catch(e){showToast('网络错误')}
}
['editModal','securityModal','adminPathModal'].forEach(id=>document.getElementById(id).addEventListener('click',e=>{if(e.target.id===id){document.getElementById(id).style.display='none'}}));
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeEditModal();closeSecurityModal();closeAdminPathModal()}});
loadLinks();
</script>
</body>
</html>`;
}

function renderLoginPage(error = '', adminPath = DEFAULT_ADMIN_PATH) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CF-SURL 管理登录</title><style>${getToolStyles()}</style></head>
<body>
<main class="page narrow" style="padding-top:12vh">
  <section class="panel login-card">
    <div class="brand" style="justify-content:center;margin-bottom:20px"><div class="brand-mark"></div></div>
    <h1 class="title" style="font-size:25px">CF-SURL</h1>
    <div class="subtitle">管理员登录</div>
    <form method="POST" action="${getAdminBasePath(adminPath)}/login">
      <div class="field"><label>用户名</label><input name="username" type="text" required autofocus></div>
      <div class="field"><label>密码</label><input name="password" type="password" required></div>
      <button type="submit" style="width:100%;margin-top:8px">登录</button>
      ${error ? `<div class="login-error">${escapeHTML(error)}</div>` : ''}
    </form>
  </section>
</main>
</body>
</html>`;
}

function render404() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CF-SURL</title><style>${getToolStyles()}</style></head>
<body>
<main class="page narrow" style="padding-top:15vh">
  <section class="panel" style="text-align:center;padding:42px 28px">
    <div style="font-size:58px;font-weight:800;letter-spacing:-2px;margin-bottom:8px">404</div>
    <h1 class="section-title" style="font-size:21px">短链接不存在</h1>
    <p class="subtitle" style="margin:8px 0 24px">您访问的短链接不存在或已过期。</p>
    <button class="secondary" onclick="location.href='/'">返回首页</button>
  </section>
</main>
</body>
</html>`;
}

// ================= API 请求核心路由 =================
export default {
  async fetch(request, env) {
    if (!env.KV) return new Response("Error: 请先绑定名为 KV 的 Cloudflare KV Namespace", { status: 500 });

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
    let adminPath = DEFAULT_ADMIN_PATH;
    try {
      adminPath = normalizeAdminPath(kvConfig.admin_path);
    } catch (e) {
      adminPath = DEFAULT_ADMIN_PATH;
    }
    const adminBasePath = getAdminBasePath(adminPath);
    const adminApiPath = `${adminBasePath}/api`;

    // === 后台路由与鉴权拦截 ===
    if (path === adminBasePath || path.startsWith(adminBasePath + '/')) {
      
      // 如果设置了密码，执行鉴权
      if (isAdminLoginEnabled(adminUser, adminPass)) {
        const isLoggedIn = await isAdminLoggedIn(request, adminUser, adminPass);
        
        // 未登录处理
        if (!isLoggedIn) {
          if (request.method === 'POST' && path === `${adminBasePath}/login`) {
            return await handleAdminLogin(request, adminUser, adminPass, adminPath);
          }
          if (path === adminApiPath || path.startsWith(adminApiPath + '/')) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders });
          }
          return new Response(renderLoginPage('', adminPath), { headers: htmlHeaders });
        }
      }
      
      // 安全退出
      if (path === `${adminBasePath}/logout`) {
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
      if (request.method === "GET" && path === adminBasePath) {
        return new Response(renderAdmin(adminUser, adminPath), { headers: htmlHeaders });
      }

      // API 接口
      if (path === adminApiPath || path.startsWith(adminApiPath + '/')) {
        try {
          // 保存账户设置 / 管理员后台路径
          if (request.method === "POST" && path === `${adminApiPath}/config`) {
            const req = await request.json();
            let oldConfig = {};
            try {
              const oldConfigStr = await env.KV.get('CONFIG.json');
              if (oldConfigStr) oldConfig = JSON.parse(oldConfigStr);
            } catch (e) {}

            // 独立保存管理员后台路径
            if (typeof req.admin_path === 'string' && !('user' in req) && !('pass' in req) && !('confirm_pass' in req)) {
              const newAdminPath = normalizeAdminPath(req.admin_path);
              await env.KV.put('CONFIG.json', JSON.stringify({
                ...oldConfig,
                admin_path: newAdminPath
              }));
              return new Response(JSON.stringify({ status: 200, message: "后台路径已保存", admin_path: newAdminPath }), { headers: jsonHeaders });
            }

            // 保存账户用户名和密码，未提交后台路径时保持原值
            const newUser = typeof req.user === 'string' ? req.user.trim() : '';
            const newPass = typeof req.pass === 'string' ? req.pass : '';
            const confirmPass = typeof req.confirm_pass === 'string' ? req.confirm_pass : '';
            if (!newPass || !confirmPass) throw new Error("密码必须输入两次");
            if (newPass !== confirmPass) throw new Error("两次输入的密码不一致");
            const newAdminPath = typeof req.admin_path === 'string'
              ? normalizeAdminPath(req.admin_path)
              : normalizeAdminPath(oldConfig.admin_path);

            await env.KV.put('CONFIG.json', JSON.stringify({
              ...oldConfig,
              user: newUser,
              pass: newPass,
              admin_path: newAdminPath
            }));
            return new Response(JSON.stringify({ status: 200, message: "设置已保存", admin_path: newAdminPath }), { headers: jsonHeaders });
          }
          
          if (request.method === "GET" && path === `${adminApiPath}/links`) {
            return new Response(JSON.stringify({ status: 200, links: await adminListLinks(env) }), { headers: jsonHeaders });
          }
          if (request.method === "POST") {
            const req = await request.json();
            if (path === `${adminApiPath}/create`) {
              await adminCreateLink(env, req.key, req.url);
              return new Response(JSON.stringify({ status: 200, message: "添加成功" }), { headers: jsonHeaders });
            }
            if (path === `${adminApiPath}/update`) {
              await adminUpdateLink(env, req.oldKey, req.key, req.url);
              return new Response(JSON.stringify({ status: 200, message: "修改成功" }), { headers: jsonHeaders });
            }
            if (path === `${adminApiPath}/delete`) {
              await adminDeleteLink(env, req.key);
              return new Response(JSON.stringify({ status: 200, message: "删除成功" }), { headers: jsonHeaders });
            }
            if (path === `${adminApiPath}/bulk-delete`) {
              const keys = Array.isArray(req.keys) ? req.keys.slice(0, 500) : [];
              if (!keys.length) throw new Error("未选择短链接");
              let deleted = 0;
              for (const key of keys) {
                try {
                  await adminDeleteLink(env, key);
                  deleted++;
                } catch (e) {}
              }
              return new Response(JSON.stringify({ status: 200, deleted }), { headers: jsonHeaders });
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
