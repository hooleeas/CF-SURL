/**
 * CF-SUBS
 * 基于 CF-SUB 核心能力扩展的多 SUB / 多订阅链接 URL 管理版
 *
 * 核心原则：
 * 1. 只使用一个 Cloudflare KV Binding：KV
 * 2. 保留 CF-SUB 的核心订阅获取、聚合、去重、NOADS、SUBAPI、格式识别、
 *    WARP、主页伪装、管理员登录、二维码、API/CONFIG 状态检测等能力。
 * 3. SUB 是“聚合节点配置”，不是公开订阅链接。
 * 4. URL 才是公开订阅入口。
 *
 * KV：
 *   CONFIG.json
 *   SUB:<id>
 *   URL:<url>
 *
 * Pages / Workers 环境变量仍兼容原 CF-SUB：
 *   USER
 *   PASS
 *   URL
 *   URL302
 *   CODE
 *   SUBUPTIME
 *   WARP
 *   LINK
 *   LINKSUB
 */

let mytoken = 'auto';
let FileName = 'CF-SUBS';
let SUBUpdateTime = 6;
let total = 99;
let timestamp = 4102329600000;

let MainData = `
https://cfxr.eu.org/getSub
`;

let urls = [];

// ================= 全局默认配置 =================
const defaultSubConverter = "SUBAPI.cmliussss.net";
const defaultSubConfig = "https://raw.githubusercontent.com/hooleeas/ACL4SSR/refs/heads/master/Clash/config/China_Direct_Overseas_Proxy.ini";
const defaultSubProtocol = "https";
// ================================================

let subConverter = defaultSubConverter;
let subConfig = defaultSubConfig;
let subProtocol = defaultSubProtocol;
let config_noAds = '';

// ================= 主页配置 =================
let fakeMode = '';
let fakeUrl = '';
let fakeUrl302 = '';
let fakeCode = '';
// ==============================================

const SUB_PREFIX = 'SUB:';
const URL_PREFIX = 'URL:';
const ID_CHARS = 'ABCDEFGHJKMNPQRSTWXYZabcdefghijkmnpqrstwxyz2345678';
const DEFAULT_ADMIN_PATH = 'admin';

export default {
    async fetch(request, env) {
        try {
            return await handleRequest(request, env);
        } catch (error) {
            console.error('CF-SUBS request error:', error);
            return new Response('CF-SUBS Worker Error: ' + (error?.message || String(error)), {
                status: 500,
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store'
                }
            });
        }
    }
};

async function handleRequest(request, env) {
        const userAgentHeader = request.headers.get('User-Agent') || '';
        const userAgent = userAgentHeader.toLowerCase();
        const url = new URL(request.url);
        const queryToken = url.searchParams.get('token') || '';
        // SUBAPI 转换内部请求：记录原始订阅 URL，确保转换时只使用该 URL 绑定的 SUB
        const conversionSourceToken = url.searchParams.get('sourceToken') || '';

        // 每次请求重新从环境变量读取，保持 CF-SUB 原有变量行为
        // 不再使用 TOKEN 环境变量；旧 /auto 入口继续由内部默认值兼容。
        let adminUser = env.USER || '';
        let adminPass = env.PASS || '';
        let adminPath = DEFAULT_ADMIN_PATH;

        fakeUrl = env.URL || '';
        fakeUrl302 = env.URL302 || '';
        fakeCode = env.CODE || '';

        // 读取 KV 配置
        if (env.KV) {
            try {
                const kvConfigStr = await env.KV.get('CONFIG.json');
                if (kvConfigStr) {
                    const kvConfig = JSON.parse(kvConfigStr);

                    FileName = kvConfig.subName || 'CF-SUBS';

                    subConverter = kvConfig.subApi || '';
                    subConfig = kvConfig.subConfig || '';
                    config_noAds = kvConfig.noAds || '';

                    // 原 CF-SUB 配置仍然兼容
                    adminUser = kvConfig.user || adminUser;
                    adminPass = kvConfig.pass || adminPass;
                    adminPath = normalizeAdminPath(kvConfig.adminPath) || DEFAULT_ADMIN_PATH;

                    fakeMode = kvConfig.fakeMode !== undefined ? kvConfig.fakeMode : '';
                    fakeUrl = kvConfig.fakeUrl !== undefined ? kvConfig.fakeUrl : fakeUrl;
                    fakeUrl302 = kvConfig.fakeUrl302 !== undefined ? kvConfig.fakeUrl302 : fakeUrl302;
                    fakeCode = kvConfig.fakeCode !== undefined ? kvConfig.fakeCode : fakeCode;
                }
            } catch (e) {
                console.error('解析 KV 配置失败', e);
            }
        }

        const customSubApi = String(subConverter || '').trim();
        const customSubConfig = String(subConfig || '').trim();
        const hasCustomApi = !!customSubApi;
        const hasCustomConfig = !!customSubConfig;

        subConverter = customSubApi;
        subConfig = customSubConfig;
        subProtocol = defaultSubProtocol;

        if (subConverter.includes('http://')) {
            subConverter = subConverter.split('//')[1];
            subProtocol = 'http';
        } else if (subConverter.includes('https://')) {
            subConverter = subConverter.split('//')[1] || subConverter;
        }

        const effectiveSubConverter = hasCustomApi ? subConverter : defaultSubConverter;
        const effectiveSubProtocol = hasCustomApi ? subProtocol : defaultSubProtocol;
        const effectiveSubConfig = hasCustomConfig ? subConfig : defaultSubConfig;

        const currentDate = new Date();
        currentDate.setHours(0, 0, 0, 0);
        const timeTemp = Math.ceil(currentDate.getTime() / 1000);
        const fakeToken = await MD5MD5(`${mytoken}${timeTemp}`);

        let UD = Math.floor(((timestamp - Date.now()) / timestamp * total * 1099511627776) / 2);
        total = total * 1099511627776;
        let expire = Math.floor(timestamp / 1000);
        SUBUpdateTime = env.SUBUPTIME || SUBUpdateTime;

        const isProxyClientUA = [
            'clash', 'meta', 'mihomo', 'sing-box', 'singbox', 'surge',
            'quantumult', 'loon', 'nekobox', 'v2rayn', 'v2rayng',
            'shadowrocket', 'subconverter'
        ].some(keyword => userAgent.includes(keyword));

        // 退出登录：直接跳回主页，不显示 logout 中间页面
        if (url.searchParams.has('logout') || url.pathname === `/${adminPath}/logout`) {
            return new Response(null, {
                status: 302,
                headers: {
                    'Location': '/',
                    'Cache-Control': 'no-store',
                    'Set-Cookie': 'CF_SUB_ADMIN=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
                }
            });
        }

        // ==================== 管理后台 ====================
        if (url.pathname === `/${adminPath}`) {
            if (isAdminLoginEnabled(adminUser, adminPass)) {
                const isLoggedIn = await isAdminLoggedIn(request, mytoken, adminUser, adminPass);
                if (!isLoggedIn) {
                    if (request.method === 'POST') {
                        return await handleAdminLogin(request, url, mytoken, adminUser, adminPass);
                    }
                    return new Response(renderLoginPage(url), {
                        headers: {
                            'Content-Type': 'text/html;charset=utf-8',
                            'Cache-Control': 'no-store'
                        }
                    });
                }
            }

            return await handleAdmin(request, env, {
                adminUser,
                adminPass,
                effectiveSubConverter,
                effectiveSubConfig,
                effectiveSubProtocol,
                hasCustomApi,
                hasCustomConfig,
                adminPath
            });
        }

        // ==================== 解析公开 URL ====================
        // 新版 URL：
        //   /abc123
        //   /abc123?clash
        //   /?token=abc123
        //
        // 兼容旧 CF-SUB：
        //   /auto
        //   /?token=auto
        let publicToken = queryToken;

        if (!publicToken && url.pathname !== '/') {
            publicToken = decodeURIComponent(url.pathname.slice(1));
        }

        let tokenData = null;

        if (env.KV && publicToken) {
            tokenData = await getToken(env, publicToken);
        }

        const legacyAdminPath =
            publicToken === mytoken ||
            publicToken.toLowerCase() === String(mytoken).toLowerCase();

        const isFakeTokenRequest =
            publicToken === fakeToken ||
            url.pathname === '/' + fakeToken;

        // 新 URL / auto / fakeToken 都属于有效入口
        const validPublicEntry =
            !!tokenData || legacyAdminPath || isFakeTokenRequest;

        // ==================== 无效路径 / 主页 ====================
        if (!validPublicEntry && url.pathname !== '/') {
            return Response.redirect(url.origin + '/', 302);
        }

        if (!validPublicEntry && url.pathname === '/') {
            if (fakeMode === '1' && fakeUrl) {
                try {
                    return await proxyURL(fakeUrl, url, FileName);
                } catch (e) {}
            } else if (fakeMode === '2' && fakeUrl302) {
                return Response.redirect(fakeUrl302, 302);
            } else if (fakeMode === '3' && fakeCode && fakeCode.trim() !== '') {
                let html = fakeCode;
                const title = `<title>${escapeHTML(FileName)}</title>`;
                if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) {
                    html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, title);
                } else if (/<head\b[^>]*>/i.test(html)) {
                    html = html.replace(/<head\b[^>]*>/i, match => match + title);
                } else {
                    html = title + html;
                }
                return new Response(html, {
                    headers: { 'Content-Type': 'text/html; charset=UTF-8' }
                });
            }

            return new Response(await nginx(FileName), {
                headers: { 'Content-Type': 'text/html; charset=UTF-8' }
            });
        }

        // ==================== 获取当前入口的来源 ====================
        let selectedSources = [];

        if (tokenData) {
            // 新架构：URL -> 多个 SUB -> 多个来源
            selectedSources = await getSourcesForToken(env, tokenData);
        } else {
            // 兼容旧 CF-SUB：
            // auto = 所有 SUBS；fake = 所有 SUBS
            if (isFakeTokenRequest && conversionSourceToken) {
                const sourceTokenData = await getToken(env, conversionSourceToken);
                if (sourceTokenData) {
                    selectedSources = await getSourcesForToken(env, sourceTokenData);
                } else {
                    selectedSources = await getAllManagedSources(env);
                }
            } else if (legacyAdminPath || isFakeTokenRequest) {
                selectedSources = await getAllManagedSources(env);
            } else if (legacyGuestPath) {
                // 如果没有 SUBS，则使用旧 LINK.txt / LINK 环境变量。
                selectedSources = await getLegacySources(env);
                if (!selectedSources.length) {
                    selectedSources = await getAllManagedSources(env);
                }
            }
        }

        // ==================== 浏览器 UI ====================
        if (
            userAgent.includes('mozilla') &&
            !url.search &&
            !isProxyClientUA
        ) {
            const status = await getBackendStatus(
                effectiveSubConverter,
                effectiveSubConfig,
                effectiveSubProtocol,
                hasCustomApi,
                hasCustomConfig
            );

            // 新 URL：订阅页面
            if (tokenData) {
                return new Response(
                    renderGuestPage(
                        url,
                        tokenData.url,
                        tokenData.name
                    ),
                    { headers: { 'Content-Type': 'text/html;charset=utf-8' } }
                );
            }

            // auto / mytoken：管理员后台仍支持旧入口，但新项目推荐 /admin
            if (legacyAdminPath) {
                if (isAdminLoginEnabled(adminUser, adminPass)) {
                    const isLoggedIn = await isAdminLoggedIn(request, mytoken, adminUser, adminPass);
                    if (!isLoggedIn) {
                        if (request.method === 'POST') {
                            return await handleAdminLogin(request, url, mytoken, adminUser, adminPass);
                        }
                        return new Response(renderLoginPage(url), {
                            headers: {
                                'Content-Type': 'text/html;charset=utf-8',
                                'Cache-Control': 'no-store'
                            }
                        });
                    }
                }

                return await handleAdmin(request, env, {
                    adminUser,
                    adminPass,
                    effectiveSubConverter,
                    effectiveSubConfig,
                    effectiveSubProtocol,
                    hasCustomApi,
                    hasCustomConfig
                });
            }
        }

        // ==================== 原 CF-SUB 核心订阅处理 ====================
        return await generateSubscription(
            request,
            env,
            selectedSources,
            {
                mytoken,
                fakeToken,
                effectiveSubConverter,
                effectiveSubConfig,
                effectiveSubProtocol,
                userAgent,
                userAgentHeader,
                config_noAds,
                FileName,
                UD,
                expire
            },
            publicToken
        );
}

/* =========================================================
 * 配置 / 后台状态
 * ======================================================= */

async function getBackendStatus(api, config, protocol, hasCustomApi, hasCustomConfig) {
    let customApiOk = false;
    let customApiVersion = '';
    let defaultApiOk = false;
    let defaultApiVersion = '';
    let customConfigOk = false;
    let defaultConfigOk = false;

    async function probeApi(targetApi, targetProtocol) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1200);
            const res = await fetch(`${targetProtocol}://${targetApi}/version`, {
                signal: controller.signal
            });
            clearTimeout(timeout);
            if (res.ok) {
                return {
                    ok: true,
                    version: (await res.text()).trim().substring(0, 30)
                };
            }
        } catch (e) {}
        return { ok: false };
    }

    async function probeConfig(configUrl) {
        if (!configUrl) return false;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1200);
            const res = await fetch(configUrl, {
                method: 'GET',
                signal: controller.signal
            });
            clearTimeout(timeout);
            return res.ok;
        } catch (e) {
            return false;
        }
    }

    if (hasCustomApi) {
        const res = await probeApi(api, protocol);
        customApiOk = res.ok;
        customApiVersion = res.version || '';
        if (!customApiOk) {
            const resDef = await probeApi(defaultSubConverter, defaultSubProtocol);
            defaultApiOk = resDef.ok;
            defaultApiVersion = resDef.version || '';
        }
    } else {
        const resDef = await probeApi(defaultSubConverter, defaultSubProtocol);
        defaultApiOk = resDef.ok;
        defaultApiVersion = resDef.version || '';
    }

    if (hasCustomConfig) {
        customConfigOk = await probeConfig(config);
        if (!customConfigOk) defaultConfigOk = await probeConfig(defaultSubConfig);
    } else {
        defaultConfigOk = await probeConfig(defaultSubConfig);
    }

    let adminApiHtml = '';
    let guestApiHtml = '';
    let finalApiUrl = '';
    let adminApiCss = '';
    let guestApiCss = '';

    if (hasCustomApi && customApiOk) {
        adminApiHtml = `✅SUBAPI状态正常 (${escapeHTML(customApiVersion)})`;
        guestApiHtml = adminApiHtml;
        finalApiUrl = `${protocol}://${api}`;
        adminApiCss = 'status-ok';
        guestApiCss = 'status-ok';
    } else if (hasCustomApi && !customApiOk && defaultApiOk) {
        adminApiHtml = `⚠️SUBAPI无效 已切换为默认配置 ✅默认值可用`;
        guestApiHtml = `✅SUBAPI状态正常 (${escapeHTML(defaultApiVersion)})`;
        finalApiUrl = `${defaultSubProtocol}://${defaultSubConverter}`;
        adminApiCss = 'status-warn';
        guestApiCss = 'status-ok';
    } else if (!hasCustomApi && defaultApiOk) {
        adminApiHtml = `⚠️SUBAPI为空 已切换为默认配置 ✅默认值可用`;
        guestApiHtml = `✅SUBAPI状态正常 (${escapeHTML(defaultApiVersion)})`;
        finalApiUrl = `${defaultSubProtocol}://${defaultSubConverter}`;
        adminApiCss = 'status-warn';
        guestApiCss = 'status-ok';
    } else {
        adminApiHtml = '❌SUBAPI无效待维护';
        guestApiHtml = adminApiHtml;
        finalApiUrl = `${defaultSubProtocol}://${defaultSubConverter}`;
        adminApiCss = 'status-error';
        guestApiCss = 'status-error';
    }

    let adminConfigHtml = '';
    let guestConfigHtml = '';
    let finalConfigUrl = '';
    let adminConfigCss = '';
    let guestConfigCss = '';

    if (hasCustomConfig && customConfigOk) {
        adminConfigHtml = '✅SUBCONFIG状态正常';
        guestConfigHtml = adminConfigHtml;
        finalConfigUrl = config;
        adminConfigCss = 'status-ok';
        guestConfigCss = 'status-ok';
    } else if (hasCustomConfig && !customConfigOk && defaultConfigOk) {
        adminConfigHtml = '⚠️SUBCONFIG无效 已切换为默认配置 ✅默认值可用';
        guestConfigHtml = '✅SUBCONFIG状态正常';
        finalConfigUrl = defaultSubConfig;
        adminConfigCss = 'status-warn';
        guestConfigCss = 'status-ok';
    } else if (!hasCustomConfig && defaultConfigOk) {
        adminConfigHtml = '⚠️SUBCONFIG为空 已切换为默认配置 ✅默认值可用';
        guestConfigHtml = '✅SUBCONFIG状态正常';
        finalConfigUrl = defaultSubConfig;
        adminConfigCss = 'status-warn';
        guestConfigCss = 'status-ok';
    } else {
        adminConfigHtml = '❌SUBCONFIG无效待维护';
        guestConfigHtml = adminConfigHtml;
        finalConfigUrl = defaultSubConfig;
        adminConfigCss = 'status-error';
        guestConfigCss = 'status-error';
    }

    return {
        adminApiHtml,
        guestApiHtml,
        finalApiUrl,
        adminApiCss,
        guestApiCss,
        adminConfigHtml,
        guestConfigHtml,
        finalConfigUrl,
        adminConfigCss,
        guestConfigCss
    };
}

/* =========================================================
 * SUB / URL 数据
 * ======================================================= */

function makeSubId() {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    let value = '';
    for (const b of bytes) value += ID_CHARS[b % ID_CHARS.length];
    return value;
}

async function makeRandomToken(env, length = 6) {
    for (let n = 0; n < 30; n++) {
        const bytes = crypto.getRandomValues(new Uint8Array(length));
        let token = '';
        for (const b of bytes) token += ID_CHARS[b % ID_CHARS.length];

        if (
            !['admin', 'api', 'login', 'logout', 'favicon.ico'].includes(token.toLowerCase()) &&
            !(await getToken(env, token))
        ) {
            return token;
        }
    }
    throw new Error('随机 URL 生成失败，请重试');
}

async function getSub(env, id) {
    if (!env.KV || !id) return null;
    try {
        return await env.KV.get(`${SUB_PREFIX}${id}`, 'json');
    } catch (e) {
        return null;
    }
}

async function getToken(env, token) {
    if (!env.KV || !token) return null;
    try {
        return await env.KV.get(`${URL_PREFIX}${token}`, 'json');
    } catch (e) {
        return null;
    }
}

async function listSubs(env) {
    if (!env.KV) return [];
    const result = [];
    let cursor;

    do {
        const page = await env.KV.list({
            prefix: SUB_PREFIX,
            ...(cursor ? { cursor } : {})
        });

        const values = await Promise.all(page.keys.map(item =>
            getSub(env, item.name.slice(SUB_PREFIX.length))
        ));
        for (const data of values) {
            if (data) result.push(data);
        }

        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    result.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
    return result;
}

async function listTokens(env) {
    if (!env.KV) return [];
    const result = [];
    let cursor;

    do {
        const page = await env.KV.list({
            prefix: URL_PREFIX,
            ...(cursor ? { cursor } : {})
        });

        const values = await Promise.all(page.keys.map(item =>
            getToken(env, item.name.slice(URL_PREFIX.length))
        ));
        for (const data of values) {
            if (data) result.push(data);
        }

        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    result.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
    return result;
}

function normalizeAdminPath(value) {
    let path = String(value || '').trim();
    if (!path) return DEFAULT_ADMIN_PATH;
    path = path.replace(/^[/]+/, '').replace(/[/]+$/, '');
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(path)) return '';
    return path;
}

function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeToken(value) {
    return String(value || '').trim();
}

function validName(name) {
    return name.length >= 1 && name.length <= 80;
}

function validCustomToken(token) {
    const lower = token.toLowerCase();
    const reserved = new Set([
        'admin', 'api', 'login', 'logout', 'favicon.ico', 'auto',
        String(mytoken || '').toLowerCase(),
    ]);

    return (
        token.length >= 3 &&
        token.length <= 80 &&
        /^[A-Za-z0-9_-]+$/.test(token) &&
        !reserved.has(lower)
    );
}

async function isSubNameUsed(env, name, exceptId = '') {
    const subs = await listSubs(env);
    return subs.some(s =>
        s.id !== exceptId &&
        String(s.name).toLowerCase() === String(name).toLowerCase()
    );
}

async function isTokenNameUsed(env, name, exceptToken = '') {
    const tokens = await listTokens(env);
    return tokens.some(t =>
        t.url !== exceptToken &&
        String(t.name).toLowerCase() === String(name).toLowerCase()
    );
}

function cleanSourceList(input) {
    if (Array.isArray(input)) {
        return input
            .flatMap(x => String(x || '').split(/\r?\n/))
            .map(x => x.trim())
            .filter(Boolean);
    }

    return String(input || '')
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean);
}

async function getSourcesForToken(env, tokenData) {
    const result = [];
    const ids = Array.isArray(tokenData.subs) ? tokenData.subs : [];

    for (const id of ids) {
        const sub = await getSub(env, id);
        if (!sub || sub.enabled === false) continue;

        if (Array.isArray(sub.sources)) result.push(...sub.sources);
    }

    return [...new Set(result.map(x => String(x).trim()).filter(Boolean))];
}

async function getAllManagedSources(env) {
    const result = [];
    const subs = await listSubs(env);

    for (const sub of subs) {
        if (sub.enabled === false) continue;
        if (Array.isArray(sub.sources)) result.push(...sub.sources);
    }

    // 如果没有创建 SUBS，则兼容旧 CF-SUB 数据
    if (!result.length) {
        return await getLegacySources(env);
    }

    return [...new Set(result.map(x => String(x).trim()).filter(Boolean))];
}

async function getLegacySources(env) {
    let data = '';
    let legacyUrls = [];

    if (env.KV) {
        await 迁移地址列表(env, 'LINK.txt');
        data = await env.KV.get('LINK.txt') || '';
    }

    if (!data) data = env.LINK || MainData || '';

    if (env.KVUB) {
        legacyUrls = await ADD(env.KVUB);
    }

    const all = await ADD(`${data}\n${legacyUrls.join('\n')}`);
    return [...new Set(all.map(x => String(x).trim()).filter(Boolean))];
}

async function handleAdmin(request, env, runtime) {
    if (!env.KV) {
        return new Response(
            '未绑定名为 KV 的 Cloudflare KV Namespace。',
            { status: 500 }
        );
    }

    // 管理后台 POST：统一处理配置 / SUB / URL
    if (request.method === 'POST') {
        const contentType = request.headers.get('content-type') || '';

        if (contentType.includes('application/x-www-form-urlencoded')) {
            return new Response('不支持的数据格式', { status: 400 });
        }

        try {
            const data = await request.json();

            if (data.type === 'config') {
                const old = await getConfig(env);

                const next = {
                    subName: normalizeName(data.settings?.subName) || 'CF-SUBS',
                    subApi: String(data.settings?.subApi || '').trim(),
                    subConfig: String(data.settings?.subConfig || '').trim(),
                    noAds: String(data.settings?.noAds || '').trim(),

                    // 保留旧配置
                    user: String(data.settings?.user || old.user || ''),
                    pass: data.settings?.pass
                        ? String(data.settings.pass)
                        : String(old.pass || ''),
                    adminPath: normalizeAdminPath(data.settings?.adminPath || old.adminPath) || DEFAULT_ADMIN_PATH,

                    fakeMode: String(data.settings?.fakeMode ?? old.fakeMode ?? ''),
                    fakeUrl: String(data.settings?.fakeUrl ?? old.fakeUrl ?? ''),
                    fakeUrl302: String(data.settings?.fakeUrl302 ?? old.fakeUrl302 ?? ''),
                    fakeCode: String(data.settings?.fakeCode ?? old.fakeCode ?? '')
                };

                await env.KV.put('CONFIG.json', JSON.stringify(next));
                return jsonResponse({ ok: true, adminPath: next.adminPath });
            }

            if (data.type === 'sub_create') {
                const name = normalizeName(data.name);
                const sources = cleanSourceList(data.sources);

                if (!validName(name)) return new Response('SUBS 名称不能为空且不能超过 80 个字符', { status: 400 });
                if (await isSubNameUsed(env, name)) return new Response('SUBS 名称已存在，不能重名', { status: 409 });
                if (!sources.length) return new Response('至少添加一个订阅地址或单节点', { status: 400 });

                const id = makeSubId();
                const item = {
                    id,
                    name,
                    enabled: data.enabled !== false,
                    sources,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                await env.KV.put(`${SUB_PREFIX}${id}`, JSON.stringify(item));
                return jsonResponse({ ok: true, sub: item });
            }

            if (data.type === 'sub_update') {
                const id = String(data.id || '');
                const old = await getSub(env, id);
                if (!old) return new Response('SUBS 不存在', { status: 404 });

                const name = normalizeName(data.name);
                const sources = cleanSourceList(data.sources);

                if (!validName(name)) return new Response('SUBS 名称不能为空且不能超过 80 个字符', { status: 400 });
                if (await isSubNameUsed(env, name, id)) return new Response('SUBS 名称已存在，不能重名', { status: 409 });
                if (!sources.length) return new Response('至少添加一个订阅地址或单节点', { status: 400 });

                const item = {
                    ...old,
                    name,
                    sources,
                    enabled: data.enabled !== false,
                    updatedAt: new Date().toISOString()
                };

                await env.KV.put(`${SUB_PREFIX}${id}`, JSON.stringify(item));
                return jsonResponse({ ok: true, sub: item });
            }

            if (data.type === 'sub_delete') {
                const id = String(data.id || '');
                if (!(await getSub(env, id))) return new Response('SUBS 不存在', { status: 404 });

                await env.KV.delete(`${SUB_PREFIX}${id}`);

                // 删除 SUB 后，自动从所有 URL 的绑定列表移除
                const tokens = await listTokens(env);
                const affected = tokens.filter(item => Array.isArray(item.subs) && item.subs.includes(id));
                await Promise.all(affected.map(item => {
                    item.subs = item.subs.filter(x => x !== id);
                    item.updatedAt = new Date().toISOString();
                    return env.KV.put(`${URL_PREFIX}${item.url}`, JSON.stringify(item));
                }));

                return jsonResponse({ ok: true });
            }

            if (data.type === 'url_create') {
                const name = normalizeName(data.name);
                const mode = data.mode === 'custom' ? 'custom' : 'random';
                let token = normalizeToken(data.url || data.token);
                const selected = Array.isArray(data.subs)
                    ? [...new Set(data.subs.map(String))]
                    : [];

                if (!validName(name)) return new Response('链接名称不能为空且不能超过 80 个字符', { status: 400 });
                if (await isTokenNameUsed(env, name)) return new Response('链接名称已存在，不能重名', { status: 409 });

                if (mode === 'custom') {
                    if (!validCustomToken(token)) {
                        return new Response('自定义 URL 只能使用 3-80 位字母、数字、下划线和短横线', { status: 400 });
                    }
                    if (await getToken(env, token)) {
                        return new Response('URL 已存在，请使用其他 URL', { status: 409 });
                    }
                } else {
                    token = await makeRandomToken(env, 6);
                }

                const validSubs = [];
                for (const id of selected) {
                    if (await getSub(env, id)) validSubs.push(id);
                }

                if (!validSubs.length) {
                    return new Response('至少选择一个聚合节点', { status: 400 });
                }

                const item = {
                    url: token,
                    name,
                    subs: validSubs,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                await env.KV.put(`${URL_PREFIX}${token}`, JSON.stringify(item));
                return jsonResponse({ ok: true, url: item });
            }

            if (data.type === 'url_update') {
                const oldToken = normalizeToken(data.oldUrl || data.oldToken || data.url || data.token);
                const newToken = normalizeToken(data.newUrl || data.newToken || data.url || data.token);
                const old = await getToken(env, oldToken);
                if (!old) return new Response('URL 不存在', { status: 404 });

                const name = normalizeName(data.name);
                const selected = Array.isArray(data.subs)
                    ? [...new Set(data.subs.map(String))]
                    : [];

                if (!validName(name)) return new Response('链接名称不能为空且不能超过 80 个字符', { status: 400 });
                if (!validCustomToken(newToken)) {
                    return new Response('URL 只能使用 3-80 位字母、数字、下划线和短横线', { status: 400 });
                }
                if (await isTokenNameUsed(env, name, oldToken)) return new Response('链接名称已存在，不能重名', { status: 409 });

                if (newToken !== oldToken && await getToken(env, newToken)) {
                    return new Response('新的 URL 已存在，请使用其他 URL', { status: 409 });
                }

                const validSubs = [];
                for (const id of selected) {
                    if (await getSub(env, id)) validSubs.push(id);
                }

                if (!validSubs.length) return new Response('至少选择一个聚合节点', { status: 400 });

                const item = {
                    ...old,
                    url: newToken,
                    name,
                    subs: validSubs,
                    updatedAt: new Date().toISOString()
                };

                // URL 本身发生变化时，迁移 KV Key，确保旧地址立即失效、新地址立即生效。
                if (newToken !== oldToken) {
                    await env.KV.put(`${URL_PREFIX}${newToken}`, JSON.stringify(item));
                    await env.KV.delete(`${URL_PREFIX}${oldToken}`);
                } else {
                    await env.KV.put(`${URL_PREFIX}${oldToken}`, JSON.stringify(item));
                }

                return jsonResponse({ ok: true, url: item, oldUrl: oldToken });
            }

            if (data.type === 'url_delete') {
                const token = normalizeToken(data.url || data.token);
                if (!(await getToken(env, token))) return new Response('URL 不存在', { status: 404 });

                await env.KV.delete(`${URL_PREFIX}${token}`);
                return jsonResponse({ ok: true });
            }

            return new Response('不支持的数据类型', { status: 400 });
        } catch (e) {
            return new Response(`服务器错误: ${e.message}`, { status: 500 });
        }
    }

    const [subs, tokens, settings] = await Promise.all([
        listSubs(env),
        listTokens(env),
        getConfig(env)
    ]);

    const status = await getBackendStatus(
        runtime.effectiveSubConverter,
        runtime.effectiveSubConfig,
        runtime.effectiveSubProtocol,
        runtime.hasCustomApi,
        runtime.hasCustomConfig
    );

    return new Response(
        renderAdminPage(
            new URL(request.url),
            env,
            subs,
            tokens,
            settings,
            status
        ),
        {
            headers: {
                'Content-Type': 'text/html;charset=utf-8',
                'Cache-Control': 'no-store'
            }
        }
    );
}

async function getConfig(env) {
    const defaults = {
        subName: 'CF-SUBS',
        subApi: '',
        subConfig: '',
        noAds: '',
        user: '',
        pass: '',
        adminPath: DEFAULT_ADMIN_PATH,
        fakeMode: '',
        fakeUrl: '',
        fakeUrl302: '',
        fakeCode: ''
    };

    if (!env.KV) return defaults;

    try {
        const raw = await env.KV.get('CONFIG.json');
        return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch (e) {
        return defaults;
    }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'Cache-Control': 'no-store'
        }
    });
}

/* =========================================================
 * 订阅输出：保留 CF-SUB 原核心逻辑
 * ======================================================= */

async function generateSubscription(request, env, sourceList, runtime, token) {
    let allSources = [...new Set((sourceList || []).map(x => String(x).trim()).filter(Boolean))];

    let 自建节点 = '';
    let 订阅链接 = '';

    for (const x of allSources) {
        if (x.toLowerCase().startsWith('http')) {
            订阅链接 += x + '\n';
        } else {
            自建节点 += x + '\n';
        }
    }

    let nodeUrls = await ADD(订阅链接);
    let req_data = 自建节点;

    const isSubConverterRequest =
        request.headers.get('subconverter-request') ||
        request.headers.get('subconverter-version') ||
        runtime.userAgent.includes('subconverter');

    let 订阅格式 = 'base64';

    if (
        !(
            runtime.userAgent.includes('null') ||
            isSubConverterRequest ||
            runtime.userAgent.includes('nekobox') ||
            runtime.userAgent.includes('cf-sub')
        )
    ) {
        if (
            runtime.userAgent.includes('sing-box') ||
            runtime.userAgent.includes('singbox') ||
            new URL(request.url).searchParams.has('sb') ||
            new URL(request.url).searchParams.has('singbox')
        ) {
            订阅格式 = 'singbox';
        } else if (
            runtime.userAgent.includes('surge') ||
            new URL(request.url).searchParams.has('surge')
        ) {
            订阅格式 = 'surge';
        } else if (
            runtime.userAgent.includes('quantumult') ||
            new URL(request.url).searchParams.has('quanx')
        ) {
            订阅格式 = 'quanx';
        } else if (
            runtime.userAgent.includes('loon') ||
            new URL(request.url).searchParams.has('loon')
        ) {
            订阅格式 = 'loon';
        } else if (
            runtime.userAgent.includes('clash') ||
            runtime.userAgent.includes('meta') ||
            runtime.userAgent.includes('mihomo') ||
            new URL(request.url).searchParams.has('clash')
        ) {
            订阅格式 = 'clash';
        }
    }

    const sourceToken = new URL(request.url).searchParams.get('sourceToken') || token || '';
    const conversionSeed = `${new URL(request.url).origin}/${await MD5MD5(runtime.fakeToken)}?token=${encodeURIComponent(runtime.fakeToken)}${sourceToken ? `&sourceToken=${encodeURIComponent(sourceToken)}` : ''}`;
    let 订阅转换URL = conversionSeed;
    let 追加UA = 'v2rayn';
    const requestUrl = new URL(request.url);

    if (requestUrl.searchParams.has('b64') || requestUrl.searchParams.has('base64')) {
        订阅格式 = 'base64';
    } else if (requestUrl.searchParams.has('clash')) {
        追加UA = 'clash';
    } else if (requestUrl.searchParams.has('singbox')) {
        追加UA = 'singbox';
    } else if (requestUrl.searchParams.has('surge')) {
        追加UA = 'surge';
    } else if (requestUrl.searchParams.has('quanx')) {
        追加UA = 'Quantumult%20X';
    } else if (requestUrl.searchParams.has('loon')) {
        追加UA = 'Loon';
    }

    nodeUrls = [...new Set(nodeUrls)].filter(item => item && item.trim());

    if (nodeUrls.length > 0) {
        const 请求订阅响应内容 = await getSUB(
            nodeUrls,
            request,
            追加UA,
            runtime.userAgentHeader
        );

        req_data += 请求订阅响应内容[0].join('\n');
        订阅转换URL += '|' + 请求订阅响应内容[1];

        // 原 CF-SUB：base64 模式下，对结构化订阅再做 mixed 转换
        if (
            订阅格式 === 'base64' &&
            !isSubConverterRequest &&
            请求订阅响应内容[1].includes('://')
        ) {
            try {
                const u = buildSubUrl(
                    runtime.effectiveSubConverter,
                    runtime.effectiveSubConfig,
                    'mixed',
                    请求订阅响应内容[1],
                    runtime.effectiveSubProtocol
                );

                const res = await fetch(u, {
                    headers: { 'User-Agent': 'v2rayn/CF-SUB' }
                });

                if (!res.ok) throw new Error();

                req_data += '\n' + atob(await res.text());
            } catch (error) {
                try {
                    const fallbackU = buildSubUrl(
                        defaultSubConverter,
                        defaultSubConfig,
                        'mixed',
                        请求订阅响应内容[1],
                        defaultSubProtocol
                    );

                    const res2 = await fetch(fallbackU, {
                        headers: { 'User-Agent': 'v2rayn/CF-SUB' }
                    });

                    if (res2.ok) req_data += '\n' + atob(await res2.text());
                } catch (e) {}
            }
        }
    }

    // 原 CF-SUB WARP 支持
    if (env.WARP) {
        const warpList = await ADD(env.WARP);
        订阅转换URL += '|' + warpList.join('|');
    }

    const text = new TextDecoder().decode(
        new TextEncoder().encode(req_data)
    );

    // 原 CF-SUB NOADS
    let filteredLines = text.split('\n');

    if (runtime.config_noAds) {
        const adKeywords = runtime.config_noAds
            .split(/[, \r\n]+/)
            .map(k => k.trim().toLowerCase())
            .filter(k => k.length > 0);

        if (adKeywords.length > 0) {
            filteredLines = filteredLines.filter(line => {
                const lowerLine = line.toLowerCase();
                return !adKeywords.some(keyword => lowerLine.includes(keyword));
            });
        }
    }

    const uniqueLines = new Set(filteredLines);
    const result = [...uniqueLines].join('\n');

    let base64Data;

    try {
        base64Data = btoa(result);
    } catch (e) {
        base64Data = encodeBase64(result);
    }

    const responseHeaders = {
        'content-type': 'text/plain; charset=utf-8',
        'Profile-Update-Interval': `${SUBUpdateTime}`,
        'Profile-web-page-url': request.url.includes('?')
            ? request.url.split('?')[0]
            : request.url
    };

    if (订阅格式 === 'base64' || token === runtime.fakeToken) {
        return new Response(base64Data, { headers: responseHeaders });
    }

    try {
        const finalUrl = buildSubUrl(
            runtime.effectiveSubConverter,
            runtime.effectiveSubConfig,
            订阅格式,
            订阅转换URL,
            runtime.effectiveSubProtocol
        );

        const res = await fetch(finalUrl, {
            headers: { 'User-Agent': runtime.userAgentHeader }
        });

        if (!res.ok) throw new Error();

        let content = await res.text();

        if (订阅格式 === 'clash') content = clashFix(content);

        if (!runtime.userAgent.includes('mozilla')) {
            responseHeaders['Content-Disposition'] =
                `attachment; filename*=utf-8''${encodeURIComponent(runtime.FileName)}`;
        }

        return new Response(content, { headers: responseHeaders });
    } catch (error) {
        try {
            const fallbackUrl = buildSubUrl(
                defaultSubConverter,
                defaultSubConfig,
                订阅格式,
                订阅转换URL,
                defaultSubProtocol
            );

            const resFb = await fetch(fallbackUrl, {
                headers: { 'User-Agent': runtime.userAgentHeader }
            });

            if (!resFb.ok) throw new Error();

            let contentFb = await resFb.text();

            if (订阅格式 === 'clash') contentFb = clashFix(contentFb);

            if (!runtime.userAgent.includes('mozilla')) {
                responseHeaders['Content-Disposition'] =
                    `attachment; filename*=utf-8''${encodeURIComponent(runtime.FileName)}`;
            }

            return new Response(contentFb, { headers: responseHeaders });
        } catch (fallbackError) {
            return new Response(base64Data, { headers: responseHeaders });
        }
    }
}

/* =========================================================
 * 以下为原 CF-SUB 核心函数：保持原行为
 * ======================================================= */

function buildSubUrl(api, config, target, urlToConvert, protocol) {
    let base = `${protocol}://${api}/sub?target=${target}&url=${encodeURIComponent(urlToConvert)}&insert=false&config=${encodeURIComponent(config)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false`;
    if (target === 'surge') base += '&ver=4&new_name=true';
    else if (target === 'quanx') base += '&udp=true';
    else if (target === 'clash' || target === 'singbox' || target === 'mixed') base += '&new_name=true';
    return base;
}

async function ADD(envadd) {
    var addtext = envadd.replace(/[ "'|\r\n]+/g, '\n').replace(/\n+/g, '\n');
    if (addtext.charAt(0) == '\n') addtext = addtext.slice(1);
    if (addtext.charAt(addtext.length - 1) == '\n') addtext = addtext.slice(0, addtext.length - 1);
    return addtext.split('\n');
}

// ================== 原生页面兜底 ==================
async function nginx(titleName) {
    return `<!DOCTYPE html>
<html>
<head>
<title>${escapeHTML(titleName)}</title>
<style>
    body { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p>
<p>For online documentation and support please refer to <a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at <a href="http://nginx.com/">nginx.com</a>.</p>
<p><em>Thank you for using nginx.</em></p>
</body>
</html>`;
}

function base64Decode(str) {
    const bytes = new Uint8Array(atob(str).split('').map(c => c.charCodeAt(0)));
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
}

// Cloudflare Workers 不保证 WebCrypto 支持 MD5。
// 使用纯 JS MD5，避免 crypto.subtle.digest('MD5') 触发 Worker 1101。
function md5Hex(input) {
    const data = new TextEncoder().encode(String(input));
    const bitLen = data.length * 8;
    const len = (((data.length + 8) >> 6) + 1) * 64;
    const bytes = new Uint8Array(len);
    bytes.set(data);
    bytes[data.length] = 0x80;

    const view = new DataView(bytes.buffer);
    view.setUint32(len - 8, bitLen >>> 0, true);
    view.setUint32(len - 4, Math.floor(bitLen / 0x100000000), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    const s = [
        7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
        5,9,14,20, 5,9,14,20, 5,9,14,20, 5,9,14,20,
        4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
        6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21
    ];
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) {
        K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
    }

    const leftRotate = (x, amount) => ((x << amount) | (x >>> (32 - amount))) >>> 0;

    for (let offset = 0; offset < bytes.length; offset += 64) {
        const M = new Uint32Array(16);
        for (let i = 0; i < 16; i++) M[i] = view.getUint32(offset + i * 4, true);

        let A = a0, B = b0, C = c0, D = d0;
        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16) { F = (B & C) | (~B & D); g = i; }
            else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
            else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * i) % 16; }
            F = (F + A + K[i] + M[g]) >>> 0;
            A = D; D = C; C = B; B = (B + leftRotate(F, s[i])) >>> 0;
        }
        a0 = (a0 + A) >>> 0;
        b0 = (b0 + B) >>> 0;
        c0 = (c0 + C) >>> 0;
        d0 = (d0 + D) >>> 0;
    }

    const out = new Uint8Array(16);
    const outView = new DataView(out.buffer);
    outView.setUint32(0, a0, true);
    outView.setUint32(4, b0, true);
    outView.setUint32(8, c0, true);
    outView.setUint32(12, d0, true);
    return Array.from(out, b => b.toString(16).padStart(2, '0')).join('');
}

async function MD5MD5(text) {
    const firstHex = md5Hex(text);
    return md5Hex(firstHex.slice(7, 27));
}

function clashFix(content) {
    if (content.includes('wireguard') && !content.includes('remote-dns-resolve')) {
        let lines = content.includes('\r\n') ? content.split('\r\n') : content.split('\n');
        let result = "";
        for (let line of lines) {
            if (line.includes('type: wireguard')) {
                result += line.replace(new RegExp(`, mtu: 1280, udp: true`, 'g'), `, mtu: 1280, remote-dns-resolve: true, udp: true`) + '\n';
            } else {
                result += line + '\n';
            }
        }
        return result;
    }
    return content;
}

// 代理模式自动替换 HTML 标题
async function proxyURL(proxyURL, url, titleName) {
    const URLs = await ADD(proxyURL);
    const fullURL = URLs[Math.floor(Math.random() * URLs.length)];
    let parsedURL = new URL(fullURL);
    let URLPathname = parsedURL.pathname;
    if (URLPathname.charAt(URLPathname.length - 1) == '/') URLPathname = URLPathname.slice(0, -1);
    URLPathname += url.pathname;
    let newURL = `${parsedURL.protocol.slice(0, -1) || 'https'}://${parsedURL.hostname}${URLPathname}${parsedURL.search}`;
    
    let response = await fetch(newURL);
    const contentType = response.headers.get('content-type') || '';
    
    // 如果反代的是网页，则动态注入配置文件名作为标题
    if (contentType.includes('text/html')) {
        let html = await response.text();
        const title = `<title>${escapeHTML(titleName)}</title>`;
        if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) {
            html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, title);
        } else if (/<head\b[^>]*>/i.test(html)) {
            html = html.replace(/<head\b[^>]*>/i, match => match + title);
        } else {
            html = title + html;
        }
        let newResponse = new Response(html, {
            status: response.status,
            statusText: response.statusText,
            headers: new Headers(response.headers)
        });
        newResponse.headers.delete('content-length');
        newResponse.headers.set('X-New-URL', newURL);
        return newResponse;
    } else {
        let newResponse = new Response(response.body, { 
            status: response.status, 
            statusText: response.statusText, 
            headers: response.headers 
        });
        newResponse.headers.set('X-New-URL', newURL);
        return newResponse;
    }
}

async function getSUB(api, request, 追加UA, userAgentHeader) {
    if (!api || api.length === 0) return [];
    else api = [...new Set(api)];
    let newapi = "";
    let 订阅转换URLs = "";
    let 异常订阅 = "";
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, 2000);
    try {
        const responses = await Promise.allSettled(api.map(apiUrl => getUrl(request, apiUrl, 追加UA, userAgentHeader).then(response => response.ok ? response.text() : Promise.reject(response))));
        const modifiedResponses = responses.map((response, index) => {
            if (response.status === 'rejected') {
                return { status: response.reason && response.reason.name === 'AbortError' ? '超时' : '请求失败', value: null, apiUrl: api[index] };
            }
            return { status: response.status, value: response.value, apiUrl: api[index] };
        });
        for (const response of modifiedResponses) {
            if (response.status === 'fulfilled') {
                const content = await response.value || 'null';
                if (content.includes('proxies:') || (content.includes('outbounds"') && content.includes('inbounds"'))) {
                    订阅转换URLs += "|" + response.apiUrl;
                } else if (content.includes('://')) {
                    newapi += content + '\n';
                } else if (isValidBase64(content)) {
                    newapi += base64Decode(content) + '\n';
                } else {
                    const 异常订阅LINK = `trojan://CMLiussss@127.0.0.1:8888?security=tls&allowInsecure=1&type=tcp&headerType=none#%E5%BC%82%E5%B8%B8%E8%AE%A2%E9%98%85%20${response.apiUrl.split('://')[1].split('/')[0]}`;
                    异常订阅 += `${异常订阅LINK}\n`;
                }
            }
        }
    } catch (error) {
    } finally {
        clearTimeout(timeout);
    }
    return [await ADD(newapi + 异常订阅), 订阅转换URLs];
}

async function getUrl(request, targetUrl, 追加UA, userAgentHeader) {
    const newHeaders = new Headers(request.headers);
    newHeaders.set("User-Agent", `${atob('djJyYXlOLzYuNDU=')} cmliu/CF-SUB ${追加UA}(${userAgentHeader})`);
    return fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.method === "GET" ? null : request.body,
        redirect: "follow",
        cf: { insecureSkipVerify: true, allowUntrusted: true, validateCertificate: false }
    }));
}

function isValidBase64(str) { const v = String(str || '').replace(/\s/g, ''); return v.length >= 4 && v.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v); }

async function 迁移地址列表(env, txt = 'ADD.txt') {
    const 旧数据 = await env.KV.get(`/${txt}`);
    const 新数据 = await env.KV.get(txt);
    if (旧数据 && !新数据) {
        await env.KV.put(txt, 旧数据);
        await env.KV.delete(`/${txt}`);
        return true;
    }
    return false;
}

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

function escapeHTML(text = '') {
    return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function getAdminSessionValue(user, pass, token) {
    if (!user || !pass) return '';
    return await MD5MD5(`${user}:${pass}:${token}:admin-login`);
}

function isAdminLoginEnabled(user, pass) { return !!(user && pass); }

async function isAdminLoggedIn(request, token, user, pass) {
    const session = await getAdminSessionValue(user, pass, token);
    return session ? getCookie(request, 'CF_SUB_ADMIN') === session : false;
}

function buildAdminCookie(value, url) {
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return `CF_SUB_ADMIN=${encodeURIComponent(value)}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

async function handleAdminLogin(request, url, token, user, pass) {
    let inputUser = '';
    let inputPass = '';
    try {
        const form = await request.formData();
        inputUser = String(form.get('username') || '');
        inputPass = String(form.get('password') || '');
    } catch (e) {
        return new Response(renderLoginPage(url, '登录请求格式不正确'), { status: 400, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (inputUser === user && inputPass === pass) {
        const session = await getAdminSessionValue(user, pass, token);
        return new Response('', { status: 302, headers: { 'Location': url.pathname, 'Set-Cookie': buildAdminCookie(session, url), 'Cache-Control': 'no-store' } });
    }
    return new Response(renderLoginPage(url, '用户名或密码错误'), { status: 401, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ==================== UI 样式与渲染模块 ====================
function getToolStyles() {
    return `
        * { box-sizing: border-box; }
        body { margin: 0; background: #f5f7fa; color: #202124; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; min-height: 100vh; transition: background 0.3s, color 0.3s; }
        .page { width: 100%; max-width: 760px; margin: 0 auto; padding: 18px 14px 28px; }
        .header { margin-bottom: 14px; }
        .title { margin: 0; font-size: 28px; font-weight: 700; line-height: 1.2; color: #1a1a1a; transition: color 0.3s; }
        .subtitle { margin-top: 8px; color: #666; font-size: 13px; }
        .panel { background: rgba(255, 255, 255, 0.85); border: 1px solid rgba(229, 229, 223, 0.8); border-radius: 20px; padding: 16px; margin-top: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05); transition: background 0.3s, border-color 0.3s; }
        .section-title { margin: 0 0 10px; font-size: 15px; font-weight: 700; }
        .section-note { margin: 4px 0 10px; color: #888; font-size: 12px; }
        .link-list { display: grid; gap: 10px; }
        .link-item { border: 1px solid rgba(229, 229, 223, 0.6); border-radius: 12px; padding: 12px; background: rgba(255, 255, 255, 0.5); transition: background 0.3s, border-color 0.3s; }
        .link-label { font-weight: 600; margin-bottom: 8px; color: #1a1a1a; transition: color 0.3s; }
        .link-url { display: block; width: 100%; word-wrap: break-word; overflow-wrap: break-word; word-break: break-all; white-space: normal; padding: 10px; border: 1px solid rgba(229, 229, 223, 0.8); border-radius: 8px; background: rgba(250, 250, 250, 0.7); color: #1f4b99; text-decoration: none; transition: all 0.3s ease; }
        .link-url:hover { background: rgba(31, 75, 153, 0.05); border-color: #1f4b99; }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        button, .button { min-height: 36px; padding: 8px 16px; border: 1px solid #343a40; border-radius: 10px; background: #2f3338; color: #fff; font-size: 14px; cursor: pointer; font-weight: 600; transition: all 0.3s ease; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; }
        button:hover, .button:hover { background: #1f2327; box-shadow: 0 4px 12px rgba(34, 34, 34, 0.15); }
        button.secondary { background: #fff; color: #222; border-color: #c8c8c0; }
        button.secondary:hover { background: #f1f3f5; }
        button.danger, .button.danger { background: #dc3545; border-color: #dc3545; }
        button.danger:hover, .button.danger:hover { background: #c82333; box-shadow: 0 4px 12px rgba(220, 53, 69, 0.2); }
        button:disabled { opacity: 0.65; cursor: default; }
        .field { margin-top: 12px; }
        label { display: block; margin-bottom: 6px; font-weight: 600; color: #1a1a1a; transition: color 0.3s; }
        input, textarea, select { width: 100%; border: 1px solid rgba(207, 207, 200, 0.6); border-radius: 10px; background: rgba(255, 255, 255, 0.8); color: #202124; font-size: 14px; padding: 10px; transition: all 0.3s ease; word-wrap: break-word; word-break: break-all; white-space: pre-wrap; }
        input:focus, textarea:focus, select:focus { outline: none; border-color: #3b82f6; background: #fff; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
        input, select { height: 42px; white-space: normal; }
        textarea { min-height: 200px; line-height: 1.5; resize: vertical; }
        .error { color: #b00020; margin-top: 10px; }
        .muted { color: #666; font-size: 13px; margin-left: 8px; transition: color 0.3s; }
        .toast { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); display: none; min-width: 190px; max-width: calc(100vw - 40px); padding: 12px 18px; text-align: center; color: #fff; background: rgba(0, 0, 0, 0.82); border-radius: 12px; z-index: 9999; }
        .status-indicator { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 8px; font-weight: 600; width: 100%; word-break: break-all; transition: background 0.3s, color 0.3s, border-color 0.3s; }
        .status-ok { background: rgba(76, 175, 80, 0.1); color: #2e7d32; border: 1px solid rgba(76, 175, 80, 0.2); }
        .status-warn { background: rgba(255, 152, 0, 0.1); color: #f57c00; border: 1px solid rgba(255, 152, 0, 0.2); }
        .status-error { background: rgba(244, 67, 54, 0.1); color: #c62828; border: 1px solid rgba(244, 67, 54, 0.2); }
        #current-qrcode { display: none; margin-top: 12px; padding: 12px; border: 1px solid rgba(229, 229, 223, 0.6); border-radius: 12px; background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(10px); width: fit-content; max-width: 100%; }
        .hidden { display: none !important; }
        .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: none; justify-content: center; align-items: center; z-index: 1000; overflow-y: auto; }
        .modal-content { background: rgba(255, 255, 255, 0.95); border-radius: 20px; padding: 24px; width: 90%; max-width: 480px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); border: 1px solid rgba(255, 255, 255, 0.5); transition: background 0.3s, border-color 0.3s; margin: 20px auto; }
        @media (prefers-color-scheme: dark) {
            body { background: #121212; color: #e0e0e0; }
            .title { color: #f5f5f5; }
            .subtitle, .section-note, .muted { color: #aaa; }
            .panel { background: rgba(30, 30, 30, 0.75); border-color: rgba(255, 255, 255, 0.1); box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
            .link-item { background: rgba(40, 40, 40, 0.5); border-color: rgba(255, 255, 255, 0.1); }
            .link-label, label { color: #ddd; }
            .link-url { background: rgba(0, 0, 0, 0.3); color: #64b5f6; border-color: rgba(255,255,255,0.1); }
            .link-url:hover { background: rgba(100, 181, 246, 0.1); border-color: #64b5f6; }
            input, textarea, select { background: rgba(20, 20, 20, 0.8); color: #fff; border-color: rgba(255,255,255,0.2); }
            input:focus, textarea:focus, select:focus { background: #000; border-color: #3b82f6; }
            button, .button { background: #3f4650; color: #fff; border-color: #69717c; box-shadow: 0 2px 8px rgba(0,0,0,0.28); }
            button:hover, .button:hover { background: #525b67; border-color: #858f9b; box-shadow: 0 4px 14px rgba(0,0,0,0.4); }
            button.secondary { background: #3a414a; color: #fff; border-color: #69717c; }
            button.secondary:hover { background: #4b5561; border-color: #858f9b; }
            button.danger { background: #b8323f; color: #fff; border-color: #d24b58; }
            button.danger:hover { background: #d13e4d; border-color: #e16a75; }
            .status-ok { background: rgba(129, 199, 132, 0.1); color: #81c784; border-color: rgba(129, 199, 132, 0.2); }
            .status-warn { background: rgba(255, 183, 77, 0.1); color: #ffb74d; border-color: rgba(255, 183, 77, 0.2); }
            .status-error { background: rgba(229, 115, 115, 0.1); color: #e57373; border-color: rgba(229, 115, 115, 0.2); }
            .modal-content { background: rgba(30, 30, 30, 0.95); border-color: rgba(255, 255, 255, 0.1); }
            #current-qrcode { background: rgba(255, 255, 255, 0.9); }
        }
    `;
}

function getSubscriptionLinks(url, token) {
    const base = `https://${url.hostname}/${token}`;
    return [
        ['自适应订阅地址', base],
        ['Base64订阅地址', `${base}?b64`],
        ['Clash订阅地址', `${base}?clash`],
        ['Sing-box订阅地址', `${base}?sb`],
        ['Surge订阅地址', `${base}?surge`],
        ['Loon订阅地址', `${base}?loon`],
    ];
}

function renderLinkList(links) {
    return `<div class="link-list">
        ${links.map(([label, value]) => `
            <div class="link-item">
                <div class="link-label">${escapeHTML(label)}</div>
                <a class="link-url" href="${escapeHTML(value)}" target="_blank">${escapeHTML(value)}</a>
                <div class="actions">
                    <button type="button" class="copy-btn" onclick="copySubscription(this)" data-url="${escapeHTML(value)}">复制</button>
                    <button type="button" class="secondary hide-btn hidden" onclick="hideQrcode(this)">隐藏二维码</button>
                </div>
            </div>
        `).join('')}
    </div>`;
}

function renderToolScripts(includeEditor = false) {
    return `<script>
        let toastTimer;
        function showToast(message) {
            const toast = document.getElementById('copyNotice');
            toast.textContent = message;
            toast.style.display = 'block';
            clearTimeout(toastTimer);
            toastTimer = setTimeout(function () { toast.style.display = 'none'; }, 1500);
        }
        function copySubscription(button) {
            navigator.clipboard.writeText(button.dataset.url).then(function () {
                showToast('已复制到剪贴板');
                showQrcode(button);
                button.classList.add('hidden');
                const hideBtn = button.closest('.actions').querySelector('.hide-btn');
                if (hideBtn) hideBtn.classList.remove('hidden');
            }).catch(function () { showToast('复制失败，请手动复制'); });
        }
        function showQrcode(button) {
            const qrcodeDiv = document.getElementById('current-qrcode');
            button.closest('.link-item').appendChild(qrcodeDiv);
            qrcodeDiv.innerHTML = '';
            qrcodeDiv.style.display = 'block';
            new QRCode(qrcodeDiv, { text: button.dataset.url, width: 220, height: 220, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.Q });
        }
        function hideQrcode(button) {
            const qrcodeDiv = document.getElementById('current-qrcode');
            qrcodeDiv.style.display = 'none';
            qrcodeDiv.innerHTML = '';
            button.classList.add('hidden');
            const copyBtn = button.closest('.actions').querySelector('.copy-btn');
            if (copyBtn) copyBtn.classList.remove('hidden');
        }

        ${includeEditor ? `
        function openSecurityModal() { document.getElementById('securityModal').style.display = 'flex'; }
        function closeSecurityModal() { document.getElementById('securityModal').style.display = 'none'; }
        
        function openFakeModal() { document.getElementById('fakeModal').style.display = 'flex'; }
        function closeFakeModal() { document.getElementById('fakeModal').style.display = 'none'; }
        
        function switchFakeMode() {
            const mode = document.getElementById('fake-mode').value;
            document.getElementById('fake-group-url').classList.add('hidden');
            document.getElementById('fake-group-url302').classList.add('hidden');
            document.getElementById('fake-group-code').classList.add('hidden');
            
            if (mode === '1') document.getElementById('fake-group-url').classList.remove('hidden');
            if (mode === '2') document.getElementById('fake-group-url302').classList.remove('hidden');
            if (mode === '3') document.getElementById('fake-group-code').classList.remove('hidden');
        }

        function saveConfig(button, type) {
            const isSec = type === 'sec';
            const isFake = type === 'fake';
            const statusElem = document.getElementById(isSec ? 'secSaveStatus' : (isFake ? 'fakeSaveStatus' : 'configSaveStatus'));

            const secPass = document.getElementById('sec-pass') ? document.getElementById('sec-pass').value : '';
            const secPass2 = document.getElementById('sec-pass2') ? document.getElementById('sec-pass2').value : '';
            if (isSec && secPass !== secPass2) { alert('两次输入的密码不一致！'); return; }

            button.disabled = true;
            const originalText = button.textContent;
            button.textContent = '保存中...';

            fetch(window.location.href, {
                method: 'POST',
                body: JSON.stringify({
                    type: 'config',
                    settings: {
                        user: document.getElementById('sec-user') ? document.getElementById('sec-user').value : '',
                        pass: secPass,
                        adminPath: document.getElementById('sec-admin-path') ? document.getElementById('sec-admin-path').value : 'admin',
                        subName: document.getElementById('config-subname') ? document.getElementById('config-subname').value : '',
                        subApi: document.getElementById('config-subapi') ? document.getElementById('config-subapi').value : '',
                        subConfig: document.getElementById('config-subconfig') ? document.getElementById('config-subconfig').value : '',
                        noAds: document.getElementById('config-noads') ? document.getElementById('config-noads').value : '',
                        fakeMode: document.getElementById('fake-mode') ? document.getElementById('fake-mode').value : '',
                        fakeUrl: document.getElementById('fake-url') ? document.getElementById('fake-url').value : '',
                        fakeUrl302: document.getElementById('fake-url302') ? document.getElementById('fake-url302').value : '',
                        fakeCode: document.getElementById('fake-code') ? document.getElementById('fake-code').value : ''
                    }
                }),
                headers: { 'Content-Type': 'application/json' }
            }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.text();
            }).then(function (res) {
                return res.text().then(function (text) {
                    let data = {};
                    try { data = JSON.parse(text); } catch (e) {}
                    statusElem.textContent = '已保存 ' + new Date().toLocaleString();
                    statusElem.style.color = 'var(--coral, #2e7d32)';
                    if (isSec && data.adminPath) {
                        setTimeout(() => window.location.replace('/'), 300);
                    } else {
                        setTimeout(() => window.location.reload(), 500);
                    }
                });
            }).catch(function (err) {
                statusElem.textContent = '保存失败: 网络异常或超时';
                statusElem.style.color = '#c62828';
                console.error(err);
            }).finally(function () {
                button.disabled = false;
                button.textContent = originalText;
            });
        }

        function saveContent(button) {
            const textarea = document.getElementById('content');
            const statusElem = document.getElementById('saveStatus');
            if (!textarea) return;
            textarea.value = textarea.value.replace(/：/g, ':');
            button.disabled = true;
            button.textContent = '保存中...';
            fetch(window.location.href, {
                method: 'POST',
                body: JSON.stringify({ type: 'content', content: textarea.value || '' }),
                headers: { 'Content-Type': 'application/json' }
            }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                statusElem.textContent = '已保存 ' + new Date().toLocaleString();
                statusElem.style.color = '#2e7d32';
            }).catch(function (err) {
                statusElem.textContent = '保存失败: 网络异常';
                statusElem.style.color = '#c62828';
                console.error(err);
            }).finally(function () {
                button.disabled = false;
                button.textContent = '保存节点订阅';
            });
        }
        ` : ''}
    </script>`;
}

function renderLoginPage(url, error = '') {
    return `<!DOCTYPE html>
<html>
<head>
<title>${escapeHTML(FileName)}管理面板</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${getToolStyles()}
.login-btn { display: block; width: 100%; max-width: 280px; min-height: 44px; margin: 28px auto 6px; background: #2f3338; border: 1px solid #343a40; border-radius: 12px; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; }
.login-btn:hover { background: #1f2327; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25); }
@media (prefers-color-scheme: dark) { .login-btn { background: #3f4650; border-color: #69717c; } .login-btn:hover { background: #525b67; border-color: #858f9b; } }
.error { text-align: center; margin-top: 15px; color: #c62828; }
</style>
</head>
<body style="display:flex; justify-content:center; align-items:center; min-height:100vh; margin:0;">
<main class="page" style="width:100%; max-width:420px; padding:20px; margin:0;">
<section class="panel" style="padding:30px 24px; text-align:center;">
<h1 class="title" style="margin-bottom:10px;">${escapeHTML(FileName)}</h1>
<div class="subtitle" style="margin-bottom:24px;">请登录管理员控制台</div>
<form method="POST" action="${escapeHTML(url.pathname)}" style="text-align:left;">
<div class="field"><label>用户名</label><input name="username" type="text" required autofocus></div>
<div class="field"><label>密码</label><input name="password" type="password" required></div>
<button type="submit" class="login-btn">登录</button>
${error ? `<div class="error">${escapeHTML(error)}</div>` : ''}
</form>
</section>
</main>
</body>
</html>`;
}

function renderGuestPage(url, guest, guestName = '') {
    return `<!DOCTYPE html>
<html>
<head>
<title>${escapeHTML(FileName)}访客订阅</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${getToolStyles()}</style>
<script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script>
</head>
<body>
<div id="copyNotice" class="toast"></div>
<main class="page">
<header class="header">
<h1 class="title">${escapeHTML(guestName ? `${FileName} · ${guestName}` : `${FileName} 访客订阅`)}</h1>
<div class="subtitle">复制订阅链接或生成二维码</div>
</header>
<section class="panel">
<h2 class="section-title">订阅地址</h2>
${renderLinkList(getSubscriptionLinks(url, guest))}
</section>
<div id="current-qrcode"></div>
</main>
${renderToolScripts(false)}
</body>
</html>`;
}


/* =========================================================
 * 新版管理后台
 * 保持 CF-SUB 原有视觉风格
 * ======================================================= */

function renderAdminPage(url, env, subs, tokens, settings, status) {
    const origin = url.origin;

    const fakeStatusHtml =
        settings.fakeMode === '1'
            ? (settings.fakeUrl ? '✅ 当前使用: URL反向代理' : '❌ 无效: 未填写URL，自动拦截为原生NGINX')
            : settings.fakeMode === '2'
                ? (settings.fakeUrl302 ? '✅ 当前使用: URL重定向(302)' : '❌ 无效: 未填写目标地址，自动拦截为原生NGINX')
                : settings.fakeMode === '3'
                    ? (settings.fakeCode ? '✅ 当前使用: 自定义HTML' : '❌ 无效: 代码为空，自动拦截为原生NGINX')
                    : '✅ 当前使用: 默认防嗅探 (原生NGINX 强制覆盖模式)';

    const fakeStatusCss =
        settings.fakeMode === '1'
            ? (settings.fakeUrl ? 'status-ok' : 'status-error')
            : settings.fakeMode === '2'
                ? (settings.fakeUrl302 ? 'status-ok' : 'status-error')
                : settings.fakeMode === '3'
                    ? (settings.fakeCode ? 'status-ok' : 'status-error')
                    : 'status-ok';

    return `<!DOCTYPE html>
<html>
<head>
<title>${escapeHTML(settings.subName)}管理面板</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${getToolStyles()}
.sub-grid{display:grid;gap:10px}
.sub-row{border:1px solid rgba(229,229,223,.6);border-radius:12px;padding:12px;background:rgba(255,255,255,.5);color:inherit}
.sub-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}
.sub-name{font-weight:700;font-size:15px;color:inherit}
.sub-count{color:#888;font-size:12px;margin-top:3px}
.source-box{margin-top:9px;padding:9px;border-radius:9px;background:rgba(250,250,250,.75);font-size:12px;word-break:break-all;white-space:pre-wrap;max-height:120px;overflow:auto;color:inherit}
.token-url{color:#1f4b99;word-break:break-all}
.chip{display:inline-block;padding:3px 8px;margin:2px 3px 2px 0;border-radius:8px;background:rgba(31,75,153,.08);color:#1f4b99;font-size:12px}
.check-list{display:grid;gap:8px;max-height:230px;overflow:auto;border:1px solid rgba(207,207,200,.6);padding:10px;border-radius:10px}
.check-item{display:flex;align-items:center;gap:8px;font-weight:400;margin:0}
.check-item input{width:18px;height:18px}
.inline-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.small-note{font-size:12px;color:#888;margin-top:6px}
.edit-button{background:#111!important;color:#fff!important;border-color:#111!important;min-height:34px;padding:7px 14px}
.edit-button:hover{background:#000!important;border-color:#000!important}
.panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.panel-head .section-title{margin-bottom:0}
.config-value{margin-top:10px;padding:10px 12px;border:1px solid rgba(229,229,223,.7);border-radius:10px;background:rgba(250,250,250,.65);font-size:13px;word-break:break-all;white-space:pre-wrap}
@media(prefers-color-scheme:dark){
.sub-row{background:rgba(30,30,30,.82);border-color:rgba(255,255,255,.12);color:#eee;box-shadow:0 2px 10px rgba(0,0,0,.18)}
.sub-name{color:#f3f3f3}
.sub-count{color:#aaa}
.source-box{background:rgba(10,10,10,.55);border:1px solid rgba(255,255,255,.08);color:#ddd}
.token-url{color:#64b5f6}
.chip{background:rgba(100,181,246,.12);color:#90caf9}
.check-list{background:rgba(20,20,20,.65);border-color:rgba(255,255,255,.12)}
.check-item{color:#ddd}
.config-value{background:rgba(0,0,0,.22);border-color:rgba(255,255,255,.1);color:#ddd}
.edit-button{background:#111!important;border-color:#444!important}
}
@media(max-width:600px){.inline-row{grid-template-columns:1fr}}
</style>
<script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script>
</head>
<body>

<div id="copyNotice" class="toast"></div>

<!-- SUB Modal -->
<div id="subsModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px;margin-bottom:20px;">📦 <span id="subsModalTitle">创建聚合节点</span></h2>
<div class="field">
<label>聚合节点名称</label>
<input id="sub-edit-name" type="text" placeholder="例如：Japan">
</div>
<div class="field">
<label>订阅地址 / 自建节点</label>
<textarea id="sub-edit-sources" style="min-height:220px" placeholder="一行一个订阅地址或节点"></textarea>
<div class="section-note">可以同时放订阅 URL 和自建节点。SUBS 本身不会生成公开订阅链接。</div>
</div>
<div class="field">
<label><input id="sub-edit-enabled" type="checkbox" checked style="width:18px;height:18px;vertical-align:middle;margin-right:6px;">启用此聚合节点</label>
</div>
<div class="actions" style="justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeSubsModal()">取消</button>
<button type="button" onclick="saveSubs()">保存</button>
</div>
<span id="subSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</div>
</div>

<!-- URL Modal -->
<div id="urlModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px;margin-bottom:20px;">🔗 <span id="urlModalTitle">创建订阅链接</span></h2>

<div class="field">
<label>链接名称</label>
<input id="url-edit-name" type="text" placeholder="例如：我的主订阅">
</div>

<div class="field">
<label>订阅链接路径</label>
<input id="url-edit-value" type="text" placeholder="留空自动随机生成">
<div class="small-note" id="urlModeNote">留空将自动生成类似 SURL 的 6 位随机路径；填写后使用自定义路径。</div>
</div>

<div class="field">
<label>可使用的聚合节点</label>
<div id="url-sub-list" class="check-list"></div>
<div class="small-note">一个订阅链接可以选择多个 SUB；一个 SUB 也可以被多个订阅链接使用。</div>
</div>

<div class="actions" style="justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeUrlModal()">取消</button>
<button type="button" onclick="saveUrl()">保存</button>
</div>
<span id="urlSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</div>
</div>


<!-- SUBAPI 编辑 Modal -->
<div id="subApiModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px;margin-bottom:20px;">编辑 SUBAPI</h2>
<div class="field">
<label>订阅转换后端 SUBAPI</label>
<input id="config-subapi" type="text" value="${escapeHTML(settings.subApi || '')}" placeholder="[默认值]">
<div class="section-note">留空使用默认 SUBAPI。</div>
</div>
<div class="actions" style="justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeSubApiModal()">取消</button>
<button type="button" onclick="saveConfig(this,'subapi')">保存</button>
</div>
<span id="subApiSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</div>
</div>

<!-- SUBCONFIG 编辑 Modal -->
<div id="subConfigModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px;margin-bottom:20px;">编辑 SUBCONFIG</h2>
<div class="field">
<label>订阅转换规则 SUBCONFIG</label>
<textarea id="config-subconfig" style="min-height:150px" placeholder="[默认值]">${escapeHTML(settings.subConfig || '')}</textarea>
<div class="section-note">留空使用默认 SUBCONFIG。</div>
</div>
<div class="actions" style="justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeSubConfigModal()">取消</button>
<button type="button" onclick="saveConfig(this,'subconfig')">保存</button>
</div>
<span id="subConfigSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</div>
</div>

<!-- NOADS 编辑 Modal -->
<div id="noAdsModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px;margin-bottom:20px;">编辑 节点屏蔽（NOADS）</h2>
<div class="field">
<label>节点屏蔽关键字</label>
<textarea id="config-noads" style="min-height:150px" placeholder="示例: 加入TG群, 订阅YouTube频道, https://t.me ......">${escapeHTML(settings.noAds || '')}</textarea>
<div class="section-note">使用英文逗号、空格或换行分隔。</div>
</div>
<div class="actions" style="justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeNoAdsModal()">取消</button>
<button type="button" onclick="saveConfig(this,'noads')">保存</button>
</div>
<span id="noAdsSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</div>
</div>

<!-- 安全设置 Modal -->
<div id="securityModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px;margin-bottom:20px;">🛡️ 账户与安全设置</h2>
<div class="field"><label>后台登录账号 (USER)</label><input id="sec-user" type="text" value="${escapeHTML(settings.user || '')}" placeholder="例如：admin"></div>
<div class="field"><label>后台登录密码 (PASS)</label><input id="sec-pass" type="password" value="" placeholder="留空则不修改当前密码"></div>
<div class="field"><label>确认登录密码</label><input id="sec-pass2" type="password" value="" placeholder="留空则不修改当前密码"></div>
<div class="field"><label>管理员后台路径</label><input id="sec-admin-path" type="text" value="${escapeHTML(normalizeAdminPath(settings.adminPath) || DEFAULT_ADMIN_PATH)}" placeholder="例如：admin 或 manage"><div class="section-note">只填写路径单词，不需要填写 /。修改后会立即退出后台并返回主页；例如改成 apple 后，使用 /apple 进入后台。</div></div>
<div class="actions" style="margin-top:24px;justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeSecurityModal()">取消</button>
<button type="button" onclick="saveConfig(this,'sec')">保存修改</button>
</div>
<span id="secSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</div>
</div>

<!-- 主页设置 Modal -->
<div id="fakeModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px;margin-bottom:20px;">🏠 主页设置</h2>
<div class="status-indicator ${fakeStatusCss}" style="margin-bottom:16px;">${fakeStatusHtml}</div>
<div class="field">
<label>主页模式</label>
<select id="fake-mode" onchange="switchFakeMode()">
<option value="" ${!settings.fakeMode ? 'selected' : ''}>[关闭] 强制原生 NGINX</option>
<option value="1" ${settings.fakeMode === '1' ? 'selected' : ''}>[URL] 网页反向代理</option>
<option value="2" ${settings.fakeMode === '2' ? 'selected' : ''}>[URL302] 强制重定向</option>
<option value="3" ${settings.fakeMode === '3' ? 'selected' : ''}>[HTML] 自定义代码</option>
</select>
</div>
<div class="field hidden" id="fake-group-url">
<label>反代目标地址 (URL)</label>
<input id="fake-url" type="text" value="${escapeHTML(settings.fakeUrl || '')}" placeholder="例如: https://www.bing.com">
</div>
<div class="field hidden" id="fake-group-url302">
<label>重定向地址 (URL302)</label>
<input id="fake-url302" type="text" value="${escapeHTML(settings.fakeUrl302 || '')}" placeholder="例如: https://github.com">
</div>
<div class="field hidden" id="fake-group-code">
<label>自定义 HTML 代码 (CODE)</label>
<textarea id="fake-code" style="min-height:180px" placeholder="在此粘贴网页 HTML 代码...">${escapeHTML(settings.fakeCode || '')}</textarea>
</div>
<div class="actions" style="margin-top:24px;justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeFakeModal()">取消</button>
<button type="button" onclick="saveConfig(this,'fake')">保存修改</button>
</div>
<span id="fakeSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</div>
</div>

<main class="page">
<header class="header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
<div>
<h1 class="title">${escapeHTML(settings.subName)}</h1>
<div class="subtitle">CF-SUBS · 汇聚订阅控制台</div>
</div>
<div style="display:flex;gap:8px;flex-wrap:wrap;">
<button type="button" onclick="openFakeModal()">🏠 主页</button>
<button type="button" onclick="openSecurityModal()">🛡️ 安全</button>
<a class="button danger" href="/${escapeHTML(normalizeAdminPath(settings.adminPath) || DEFAULT_ADMIN_PATH)}/logout">🚪 退出</a>
</div>
</header>

<section class="panel">
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
<div>
<h2 class="section-title">全局名称设置 (SUBNAME)</h2>
<div class="section-note">设置订阅名称，将显示在生成的订阅信息中。</div>
</div>
<button type="button" class="edit-button" onclick="saveConfig(this,'subname')">保存</button>
</div>
<div class="field" style="margin-top:12px;"><input id="config-subname" type="text" value="${escapeHTML(settings.subName)}" placeholder="例如：CF-SUBS"></div>
<span id="configSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</section>

<section class="panel">
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
<div>
<h2 class="section-title">聚合节点 (SUB)</h2>
<div class="section-note">SUB 是聚合节点配置，不是订阅链接。默认为空，可创建多个且名称不能重复。</div>
</div>
<button type="button" onclick="openSubCreate()">＋ 创建聚合节点</button>
</div>

<div id="sub-list" class="sub-grid" style="margin-top:12px;">
${subs.length ? subs.map(s => `
<div class="sub-row">
<div class="sub-head">
<div>
<div class="sub-name">${escapeHTML(s.name)}</div>
<div class="sub-count">${s.sources?.length || 0} 个来源 · ${s.enabled === false ? '已禁用' : '已启用'}</div>
</div>
<div class="actions" style="margin-top:0;">
<button type="button" class="edit-button" onclick="editSub('${escapeHTML(s.id)}')">编辑</button>
<button type="button" class="danger" onclick="deleteSub('${escapeHTML(s.id)}')">删除</button>
</div>
</div>
<div class="source-box">${escapeHTML((s.sources || []).join('\n'))}</div>
</div>
`).join('') : `<div class="empty">暂无聚合节点。SUB 默认就是空的，请点击“创建聚合节点”。</div>`}
</div>
</section>

<section class="panel">
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
<div>
<h2 class="section-title">订阅链接 (URL)</h2>
<div class="section-note">创建订阅链接才会生成公开订阅入口。URL 可以绑定一个或多个 SUB。</div>
</div>
<button type="button" onclick="openUrlCreate()">＋ 创建订阅链接</button>
</div>

<div id="url-list" class="sub-grid" style="margin-top:12px;">
${tokens.length ? tokens.map(t => {
    const tokenUrl = `${origin}/${encodeURIComponent(t.url)}`;
    const subNames = (t.subs || []).map(id => {
        const s = subs.find(x => x.id === id);
        return s ? s.name : '已删除';
    });

    return `
<div class="sub-row">
<div class="sub-head">
<div style="min-width:0;">
<div class="sub-name">${escapeHTML(t.name)}</div>
<div class="sub-count">URL：${escapeHTML(t.url)}</div>
</div>
<div class="actions" style="margin-top:0;">
<button type="button" class="secondary" onclick="copyValue('${escapeHTML(tokenUrl)}')">复制</button>
<button type="button" class="edit-button" onclick="editUrl('${escapeHTML(t.url)}')">编辑</button>
<button type="button" class="danger" onclick="deleteUrl('${escapeHTML(t.url)}')">删除</button>
</div>
</div>
<a class="link-url token-url" href="${escapeHTML(tokenUrl)}" target="_blank">${escapeHTML(tokenUrl)}</a>
<div style="margin-top:8px;">
${subNames.length ? subNames.map(x => `<span class="chip">${escapeHTML(x)}</span>`).join('') : '<span class="small-note">未绑定聚合节点</span>'}
</div>
</div>`;
}).join('') : `<div class="empty">暂无订阅链接。创建订阅链接后才会产生公开订阅地址。</div>`}
</div>
</section>

<section class="panel">
<div class="panel-head">
<div>
<h2 class="section-title">订阅转换后端 SUBAPI</h2>
<div class="section-note">当前订阅转换后端</div>
</div>
<button type="button" class="edit-button" onclick="openSubApiModal()">编辑</button>
</div>
<div class="status-indicator ${status.adminApiCss}" style="margin-top:10px;">${status.adminApiHtml}</div>
<a class="link-url" href="${escapeHTML(status.finalApiUrl)}" target="_blank">${escapeHTML(status.finalApiUrl)}</a>
</section>

<section class="panel">
<div class="panel-head">
<div>
<h2 class="section-title">订阅转换规则 SUBCONFIG</h2>
<div class="section-note">当前订阅转换规则</div>
</div>
<button type="button" class="edit-button" onclick="openSubConfigModal()">编辑</button>
</div>
<div class="status-indicator ${status.adminConfigCss}" style="margin-top:10px;">${status.adminConfigHtml}</div>
<a class="link-url" href="${escapeHTML(status.finalConfigUrl)}" target="_blank">${escapeHTML(status.finalConfigUrl)}</a>
</section>

<section class="panel">
<div class="panel-head">
<div>
<h2 class="section-title">节点屏蔽 (NOADS)</h2>
<div class="section-note">按关键字屏蔽不需要的节点</div>
</div>
<button type="button" class="edit-button" onclick="openNoAdsModal()">编辑</button>
</div>
<div class="config-value">${escapeHTML(settings.noAds || '未设置')}</div>
</section>

<div id="current-qrcode"></div>
</main>

<script>
const SUBS = ${JSON.stringify(subs)};
const TOKENS = ${JSON.stringify(tokens)};
let editingSub = '';
let editingUrlValue = '';


function renderSubList(){
 const box=document.getElementById('sub-list');
 if(!box)return;
 if(!SUBS.length){
   box.innerHTML='<div class="empty">暂无聚合节点。SUB 默认就是空的，请点击“创建聚合节点”。</div>';
   return;
 }
 box.innerHTML=SUBS.map(function(s){
   const sources=escapeJS((s.sources||[]).join('\\n'));
   const name=escapeJS(s.name||'');
   const id=escapeJS(s.id||'');
   const count=s.sources?.length||0;
   const enabled=s.enabled===false?'已禁用':'已启用';
   return '<div class="sub-row">'
    +'<div class="sub-head">'
    +'<div>'
    +'<div class="sub-name">'+name+'</div>'
    +'<div class="sub-count">'+count+' 个来源 · '+enabled+'</div>'
    +'</div>'
    +'<div class="actions" style="margin-top:0;">'
    +'<button type="button" class="edit-button" onclick="editSub(\\\''+id+'\\\')">编辑</button>'
    +'<button type="button" class="danger" onclick="deleteSub(\\\''+id+'\\\')">删除</button>'
    +'</div>'
    +'</div>'
    +'<div class="source-box">'+sources+'</div>'
    +'</div>';
 }).join('');
}

function renderUrlList(){
 const box=document.getElementById('url-list');
 if(!box)return;
 const origin=window.location.origin;
 if(!TOKENS.length){
   box.innerHTML='<div class="empty">暂无订阅链接。创建订阅链接后才会产生公开订阅地址。</div>';
   return;
 }
 box.innerHTML=TOKENS.map(function(t){
   const tokenUrl=origin+'/'+encodeURIComponent(t.url||'');
   const name=escapeJS(t.name||'');
   const path=escapeJS(t.url||'');
   const safeUrl=escapeJS(tokenUrl);
   const subNames=(t.subs||[]).map(function(id){
     const sub=SUBS.find(function(x){return x.id===id;});
     return sub?sub.name:'已删除';
   });
   const chips=subNames.length
     ? subNames.map(function(x){return '<span class="chip">'+escapeJS(x)+'</span>';}).join('')
     : '<span class="small-note">未绑定聚合节点</span>';
   return '<div class="sub-row">'
    +'<div class="sub-head">'
    +'<div style="min-width:0;">'
    +'<div class="sub-name">'+name+'</div>'
    +'<div class="sub-count">URL：'+path+'</div>'
    +'</div>'
    +'<div class="actions" style="margin-top:0;">'
    +'<button type="button" class="secondary" onclick="copyValue(\\\''+safeUrl+'\\\')">复制</button>'
    +'<button type="button" class="edit-button" onclick="editUrl(\\\''+path+'\\\')">编辑</button>'
    +'<button type="button" class="danger" onclick="deleteUrl(\\\''+path+'\\\')">删除</button>'
    +'</div>'
    +'</div>'
    +'<a class="link-url token-url" href="'+safeUrl+'" target="_blank">'+safeUrl+'</a>'
    +'<div style="margin-top:8px;">'+chips+'</div>'
    +'</div>';
 }).join('');
}

function refreshSubscriptionUI(){
 renderSubList();
 renderUrlList();
}

function showToast(message){
 const el=document.getElementById('copyNotice');
 el.textContent=message;
 el.style.display='block';
 clearTimeout(window.__toast);
 window.__toast=setTimeout(()=>el.style.display='none',1500);
}

function copyValue(value){
 navigator.clipboard.writeText(value).then(()=>showToast('已复制到剪贴板')).catch(()=>showToast('复制失败，请手动复制'));
}

function openSubApiModal(){document.getElementById('subApiModal').style.display='flex'}
function closeSubApiModal(){document.getElementById('subApiModal').style.display='none'}
function openSubConfigModal(){document.getElementById('subConfigModal').style.display='flex'}
function closeSubConfigModal(){document.getElementById('subConfigModal').style.display='none'}
function openNoAdsModal(){document.getElementById('noAdsModal').style.display='flex'}
function closeNoAdsModal(){document.getElementById('noAdsModal').style.display='none'}

function openSecurityModal(){document.getElementById('securityModal').style.display='flex'}
function closeSecurityModal(){document.getElementById('securityModal').style.display='none'}
function openFakeModal(){document.getElementById('fakeModal').style.display='flex'}
function closeFakeModal(){document.getElementById('fakeModal').style.display='none'}

function switchFakeMode(){
 const mode=document.getElementById('fake-mode').value;
 ['fake-group-url','fake-group-url302','fake-group-code'].forEach(id=>document.getElementById(id).classList.add('hidden'));
 if(mode==='1')document.getElementById('fake-group-url').classList.remove('hidden');
 if(mode==='2')document.getElementById('fake-group-url302').classList.remove('hidden');
 if(mode==='3')document.getElementById('fake-group-code').classList.remove('hidden');
}

function saveConfig(button,type){
 const isSec=type==='sec';
 const isFake=type==='fake';
 const statusId=isSec?'secSaveStatus':(isFake?'fakeSaveStatus':(type==='subapi'?'subApiSaveStatus':(type==='subconfig'?'subConfigSaveStatus':(type==='noads'?'noAdsSaveStatus':'configSaveStatus'))));
 const statusElem=document.getElementById(statusId);

 const secPass=document.getElementById('sec-pass')?.value||'';
 const secPass2=document.getElementById('sec-pass2')?.value||'';

 if(isSec && secPass!==secPass2){
   alert('两次输入的密码不一致！');
   return;
 }

 button.disabled=true;
 const oldText=button.textContent;
 button.textContent='保存中...';

 fetch(window.location.pathname,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({
     type:'config',
     settings:{
       user:document.getElementById('sec-user')?.value||'',
       pass:secPass,
       subName:document.getElementById('config-subname')?.value||'',
       subApi:document.getElementById('config-subapi')?.value||'',
       subConfig:document.getElementById('config-subconfig')?.value||'',
       noAds:document.getElementById('config-noads')?.value||'',
       fakeMode:document.getElementById('fake-mode')?.value||'',
       fakeUrl:document.getElementById('fake-url')?.value||'',
       fakeUrl302:document.getElementById('fake-url302')?.value||'',
       fakeCode:document.getElementById('fake-code')?.value||'',
       adminPath:document.getElementById('sec-admin-path')?.value||'admin'
     }
   })
 }).then(async res=>{
   if(!res.ok)throw new Error(await res.text());
   const data=await res.json().catch(()=>({}));
   statusElem.textContent='已保存 '+new Date().toLocaleString();
   statusElem.style.color='#2e7d32';
   if(type==='subapi')closeSubApiModal();
   if(type==='subconfig')closeSubConfigModal();
   if(type==='noads')closeNoAdsModal();
   if(isSec && data.adminPath){
     setTimeout(()=>window.location.replace('/'),300);
   }else{
     setTimeout(()=>location.reload(),500);
   }
 }).catch(err=>{
   statusElem.textContent='保存失败: '+err.message;
   statusElem.style.color='#c62828';
 }).finally(()=>{
   button.disabled=false;
   button.textContent=oldText;
 });
}

function openSubCreate(){
 editingSub='';
 document.getElementById('subsModalTitle').textContent='创建聚合节点';
 document.getElementById('sub-edit-name').value='';
 document.getElementById('sub-edit-sources').value='';
 document.getElementById('sub-edit-enabled').checked=true;
 document.getElementById('subSaveStatus').textContent='';
 document.getElementById('subsModal').style.display='flex';
}

function closeSubsModal(){document.getElementById('subsModal').style.display='none'}

function editSub(id){
 const item=SUBS.find(x=>x.id===id);
 if(!item)return;
 editingSub=id;
 document.getElementById('subsModalTitle').textContent='编辑聚合节点';
 document.getElementById('sub-edit-name').value=item.name||'';
 document.getElementById('sub-edit-sources').value=(item.sources||[]).join('\\n');
 document.getElementById('sub-edit-enabled').checked=item.enabled!==false;
 document.getElementById('subSaveStatus').textContent='';
 document.getElementById('subsModal').style.display='flex';
}

async function saveSubs(){
 const button=document.querySelector('#subsModal button:not(.secondary)');
 const status=document.getElementById('subSaveStatus');
 const oldId=editingSub;
 const payload={
   type:oldId?'sub_update':'sub_create',
   id:oldId,
   name:document.getElementById('sub-edit-name').value.trim(),
   sources:document.getElementById('sub-edit-sources').value,
   enabled:document.getElementById('sub-edit-enabled').checked
 };

 button.disabled=true;
 button.textContent='保存中...';
 status.textContent='正在保存...';
 try{
   const res=await fetch(window.location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const text=await res.text();
   if(!res.ok)throw new Error(text||'保存失败');
   const data=JSON.parse(text);
   if(!data.sub)throw new Error('服务器未返回聚合节点数据');

   if(oldId){
     const index=SUBS.findIndex(x=>x.id===oldId);
     if(index!==-1)SUBS[index]=data.sub; else SUBS.push(data.sub);
   }else{
     SUBS.push(data.sub);
   }

   refreshSubscriptionUI();
   status.textContent='保存成功';
   showToast(oldId?'聚合节点已更新':'聚合节点已创建');
   closeSubsModal();
 }catch(err){
   status.textContent=err.message||'保存失败';
   showToast(err.message||'保存失败');
 }finally{
   button.disabled=false;
   button.textContent='保存';
 }
}

async function deleteSub(id){
 const item=SUBS.find(x=>x.id===id);
 if(!item)return;
 if(!confirm('确定删除“'+item.name+'”吗？\\n已经绑定它的 URL 会自动解除绑定。'))return;

 const res=await fetch(window.location.pathname,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({type:'sub_delete',id})
 });
 const text=await res.text();

 if(!res.ok){showToast(text||'删除失败');return}
 const index=SUBS.findIndex(x=>x.id===id);
 if(index!==-1)SUBS.splice(index,1);
 TOKENS.forEach(t=>{t.subs=Array.isArray(t.subs)?t.subs.filter(x=>x!==id):[];});
 refreshSubscriptionUI();
 showToast('聚合节点已删除');
}

function renderUrlSubs(selected){
 const box=document.getElementById('url-sub-list');
 if(!SUBS.length){
   box.innerHTML='<div class="small-note">暂无 SUB，请先创建聚合节点。</div>';
   return;
 }
 box.innerHTML=SUBS.map(s=>\`
   <label class="check-item">
     <input type="checkbox" value="\${escapeJS(s.id)}" \${selected.includes(s.id)?'checked':''}>
     <span>\${escapeJS(s.name)}</span>
   </label>
 \`).join('');
}

function escapeJS(value){
 return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function openUrlCreate(){
 editingUrlValue='';
 document.getElementById('urlModalTitle').textContent='创建订阅链接';
 document.getElementById('url-edit-name').value='';
 document.getElementById('url-edit-value').value='';
 document.getElementById('url-edit-value').disabled=false;
 document.getElementById('urlModeNote').textContent='留空将自动生成类似 SURL 的 6 位随机路径；填写后使用自定义路径。';
 document.getElementById('urlSaveStatus').textContent='';
 renderUrlSubs([]);
 document.getElementById('urlModal').style.display='flex';
}

function closeUrlModal(){document.getElementById('urlModal').style.display='none'}

function editUrl(token){
 const item=TOKENS.find(x=>x.url===token);
 if(!item)return;
 editingUrlValue=token;
 document.getElementById('urlModalTitle').textContent='编辑订阅链接';
 document.getElementById('url-edit-name').value=item.name||'';
 document.getElementById('url-edit-value').value=item.url||'';
 document.getElementById('url-edit-value').disabled=false;
 document.getElementById('urlModeNote').textContent='可直接修改订阅链接路径；保存后旧路径立即失效，新路径立即生效。';
 document.getElementById('urlSaveStatus').textContent='';
 renderUrlSubs(item.subs||[]);
 document.getElementById('urlModal').style.display='flex';
}

async function saveUrl(){
 const selected=[...document.querySelectorAll('#url-sub-list input[type=checkbox]:checked')].map(x=>x.value);
 const button=document.querySelector('#urlModal button:not(.secondary)');
 const status=document.getElementById('urlSaveStatus');

 if(!selected.length){
   showToast('至少选择一个聚合节点');
   return;
 }

 const oldUrl=editingUrlValue;
 const payload=oldUrl?{
   type:'url_update',
   oldUrl,
   newUrl:document.getElementById('url-edit-value').value.trim(),
   name:document.getElementById('url-edit-name').value.trim(),
   subs:selected
 }:{
   type:'url_create',
   name:document.getElementById('url-edit-name').value.trim(),
   mode:document.getElementById('url-edit-value').value.trim() ? 'custom' : 'random',
   url:document.getElementById('url-edit-value').value.trim(),
   subs:selected
 };

 button.disabled=true;
 button.textContent='保存中...';
 status.textContent='正在保存...';
 try{
   const res=await fetch(window.location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const text=await res.text();
   if(!res.ok)throw new Error(text||'保存失败');
   const data=JSON.parse(text);
   if(!data.url)throw new Error('服务器未返回订阅链接数据');

   if(oldUrl){
     const index=TOKENS.findIndex(x=>x.url===oldUrl);
     if(index!==-1)TOKENS[index]=data.url; else TOKENS.push(data.url);
   }else{
     TOKENS.push(data.url);
   }

   refreshSubscriptionUI();
   status.textContent='保存成功';
   showToast(oldUrl?'订阅链接已更新':'订阅链接已创建');
   closeUrlModal();
 }catch(err){
   status.textContent=err.message||'保存失败';
   showToast(err.message||'保存失败');
 }finally{
   button.disabled=false;
   button.textContent='保存';
 }
}

async function deleteUrl(token){
 const item=TOKENS.find(x=>x.url===token);
 if(!item)return;
 if(!confirm('确定删除“'+item.name+'”吗？'))return;

 const res=await fetch(window.location.pathname,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({type:'url_delete',url:token})
 });
 const text=await res.text();

 if(!res.ok){showToast(text||'删除失败');return}
 const index=TOKENS.findIndex(x=>x.url===token);
 if(index!==-1)TOKENS.splice(index,1);
 renderUrlList();
 showToast('订阅链接已删除');
}

switchFakeMode();
</script>
</body>
</html>`;
}
                try {
                    const kvConfig = JSON.parse(kvConfigStr);

                    FileName = kvConfig.subName || FileName;

                    // 后台输入框保持为空表示使用默认值
                    subConverter = kvConfig.subApi || '';
                    subConfig = kvConfig.subConfig || '';

                    config_noAds = kvConfig.noAds || '';
                    guestToken = kvConfig.guest || guestToken;
                    adminUser = kvConfig.user || adminUser;
                    adminPass = kvConfig.pass || adminPass;
                    
                    fakeMode = kvConfig.fakeMode !== undefined ? kvConfig.fakeMode : fakeMode;
                    fakeUrl = kvConfig.fakeUrl !== undefined ? kvConfig.fakeUrl : fakeUrl;
                    fakeUrl302 = kvConfig.fakeUrl302 !== undefined ? kvConfig.fakeUrl302 : fakeUrl302;
                    fakeCode = kvConfig.fakeCode !== undefined ? kvConfig.fakeCode : fakeCode;

                } catch (e) {
                    console.error('解析 KV 配置失败', e);
                }
            }
        }

        // 保存后台填写的原始配置状态
        const customSubApi = String(subConverter || '').trim();
        const customSubConfig = String(subConfig || '').trim();

        const hasCustomApi = !!customSubApi;
        const hasCustomConfig = !!customSubConfig;

        subConverter = customSubApi;
        subConfig = customSubConfig;
        subProtocol = defaultSubProtocol;

        if (subConverter.includes("http://")) {
            subConverter = subConverter.split("//")[1];
            subProtocol = 'http';
        } else if (subConverter.includes("https://")) {
            subConverter = subConverter.split("//")[1] || subConverter;
        }

        // 实际使用配置
        const effectiveSubConverter = hasCustomApi ? subConverter : defaultSubConverter;
        const effectiveSubProtocol = hasCustomApi ? subProtocol : defaultSubProtocol;
        const effectiveSubConfig = hasCustomConfig ? subConfig : defaultSubConfig;

        const currentDate = new Date();
        currentDate.setHours(0, 0, 0, 0);

        const timeTemp = Math.ceil(currentDate.getTime() / 1000);
        const fakeToken = await MD5MD5(`${mytoken}${timeTemp}`);

        guestToken = env.GUESTTOKEN || env.GUEST || guestToken;

        if (!guestToken) {
            guestToken = await MD5MD5(mytoken);
        }

        const 访客订阅 = guestToken;
        const guestPath = url.pathname === ("/" + 访客订阅) || url.pathname.toLowerCase() === ("/" + 访客订阅.toLowerCase());

        let UD = Math.floor(((timestamp - Date.now()) / timestamp * total * 1099511627776) / 2);
        total = total * 1099511627776;
        let expire = Math.floor(timestamp / 1000);
        SUBUpdateTime = env.SUBUPTIME || SUBUpdateTime;

        const isProxyClientUA = [
            'clash', 'meta', 'mihomo', 'sing-box', 'singbox', 'surge',
            'quantumult', 'loon', 'nekobox', 'v2rayn', 'v2rayng',
            'shadowrocket', 'subconverter'
        ].some(keyword => userAgent.includes(keyword));

        // 无效路径优先返回主页
        if (!([mytoken, fakeToken, 访客订阅].includes(token) || url.pathname == ("/" + mytoken) || url.pathname.includes("/" + mytoken + "?") || guestPath)) {
            
            // 【新增逻辑】：如果访问的不是根路径（例如 /abc 或 /无关字符），则强制 302 重定向到根目录 (主页)
            if (url.pathname !== '/') {
                return Response.redirect(url.origin + '/', 302);
            }

            if (fakeMode === '1' && fakeUrl) {
                try { return await proxyURL(fakeUrl, url, FileName); } catch (e) { }
            } else if (fakeMode === '2' && fakeUrl302) {
                return Response.redirect(fakeUrl302, 302);
            } else if (fakeMode === '3' && fakeCode && fakeCode.trim() !== '') {
                // 动态注入标题
                let html = fakeCode;
                const title = `<title>${escapeHTML(FileName)}</title>`;
                if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) {
                    html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, title);
                } else if (/<head\b[^>]*>/i.test(html)) {
                    html = html.replace(/<head\b[^>]*>/i, match => match + title);
                } else {
                    html = title + html;
                }
                return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
            }
            
            // 模式 0，或配置为空/异常时，全部兜底返回原生 NGINX
            return new Response(await nginx(FileName), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
        } else {

            if (env.KV) {
                await 迁移地址列表(env, 'LINK.txt');

                // 浏览器直接访问 UI
                if (userAgent.includes('mozilla') && !url.search && !isProxyClientUA) {

                    // ================= 后端连通性与规则有效性 =================
                    let customApiOk = false;
                    let customApiVersion = '';
                    let defaultApiOk = false;
                    let defaultApiVersion = '';
                    let customConfigOk = false;
                    let defaultConfigOk = false;

                    async function probeApi(api, protocol) {
                        try {
                            const controller = new AbortController();
                            const timeout = setTimeout(() => controller.abort(), 1200);
                            const res = await fetch(`${protocol}://${api}/version`, { signal: controller.signal });
                            clearTimeout(timeout);
                            if (res.ok) {
                                return { ok: true, version: (await res.text()).trim().substring(0, 30) };
                            }
                            return { ok: false };
                        } catch (e) {
                            return { ok: false };
                        }
                    }

                    async function probeConfig(configUrl) {
                        if (!configUrl) return false;
                        try {
                            const controller = new AbortController();
                            const timeout = setTimeout(() => controller.abort(), 1200);
                            const res = await fetch(configUrl, { method: 'GET', signal: controller.signal });
                            clearTimeout(timeout);
                            return res.ok;
                        } catch (e) {
                            return false;
                        }
                    }

                    // ====== 智能检测 API ======
                    if (hasCustomApi) {
                        const res = await probeApi(subConverter, subProtocol);
                        customApiOk = res.ok;
                        customApiVersion = res.version;
                        if (!customApiOk) {
                            const resDef = await probeApi(defaultSubConverter, defaultSubProtocol);
                            defaultApiOk = resDef.ok;
                            defaultApiVersion = resDef.version;
                        }
                    } else {
                        const resDef = await probeApi(defaultSubConverter, defaultSubProtocol);
                        defaultApiOk = resDef.ok;
                        defaultApiVersion = resDef.version;
                    }

                    // ====== 智能检测 CONFIG ======
                    if (hasCustomConfig) {
                        customConfigOk = await probeConfig(subConfig);
                        if (!customConfigOk) {
                            defaultConfigOk = await probeConfig(defaultSubConfig);
                        }
                    } else {
                        defaultConfigOk = await probeConfig(defaultSubConfig);
                    }

                    // ====== 构造 API 状态 UI ======
                    let adminApiHtml = '';
                    let guestApiHtml = '';
                    let finalApiUrl = '';
                    let adminApiCss = '';
                    let guestApiCss = '';

                    if (hasCustomApi && customApiOk) {
                        adminApiHtml = `✅SUBAPI状态正常 (${escapeHTML(customApiVersion)})`;
                        guestApiHtml = adminApiHtml;
                        finalApiUrl = `${subProtocol}://${subConverter}`;
                        adminApiCss = 'status-ok';
                        guestApiCss = 'status-ok';
                    } else if (hasCustomApi && !customApiOk && defaultApiOk) {
                        adminApiHtml = `⚠️SUBAPI无效 已切换为默认配置 ✅默认值可用`;
                        guestApiHtml = `✅SUBAPI状态正常 (${escapeHTML(defaultApiVersion)})`;
                        finalApiUrl = `${defaultSubProtocol}://${defaultSubConverter}`;
                        adminApiCss = 'status-warn';
                        guestApiCss = 'status-ok';
                    } else if (!hasCustomApi && defaultApiOk) {
                        adminApiHtml = `⚠️SUBAPI为空 已切换为默认配置 ✅默认值可用`;
                        guestApiHtml = `✅SUBAPI状态正常 (${escapeHTML(defaultApiVersion)})`;
                        finalApiUrl = `${defaultSubProtocol}://${defaultSubConverter}`;
                        adminApiCss = 'status-warn';
                        guestApiCss = 'status-ok';
                    } else {
                        adminApiHtml = `❌SUBAPI无效待维护`;
                        guestApiHtml = adminApiHtml;
                        finalApiUrl = `${defaultSubProtocol}://${defaultSubConverter}`;
                        adminApiCss = 'status-error';
                        guestApiCss = 'status-error';
                    }

                    // ====== 构造 CONFIG 状态 UI ======
                    let adminConfigHtml = '';
                    let guestConfigHtml = '';
                    let finalConfigUrl = '';
                    let adminConfigCss = '';
                    let guestConfigCss = '';

                    if (hasCustomConfig && customConfigOk) {
                        adminConfigHtml = `✅SUBCONFIG状态正常`;
                        guestConfigHtml = adminConfigHtml;
                        finalConfigUrl = subConfig;
                        adminConfigCss = 'status-ok';
                        guestConfigCss = 'status-ok';
                    } else if (hasCustomConfig && !customConfigOk && defaultConfigOk) {
                        adminConfigHtml = `⚠️SUBCONFIG无效 已切换为默认配置 ✅默认值可用`;
                        guestConfigHtml = `✅SUBCONFIG状态正常`;
                        finalConfigUrl = defaultSubConfig;
                        adminConfigCss = 'status-warn';
                        guestConfigCss = 'status-ok';
                    } else if (!hasCustomConfig && defaultConfigOk) {
                        adminConfigHtml = `⚠️SUBCONFIG为空 已切换为默认配置 ✅默认值可用`;
                        guestConfigHtml = `✅SUBCONFIG状态正常`;
                        finalConfigUrl = defaultSubConfig;
                        adminConfigCss = 'status-warn';
                        guestConfigCss = 'status-ok';
                    } else {
                        adminConfigHtml = `❌SUBCONFIG无效待维护`;
                        guestConfigHtml = adminConfigHtml;
                        finalConfigUrl = defaultSubConfig;
                        adminConfigCss = 'status-error';
                        guestConfigCss = 'status-error';
                    }

                    // ========================================================

                    if (guestPath) {
                        return new Response(
                            renderGuestPage(url, 访客订阅, finalApiUrl, finalConfigUrl, guestApiHtml, guestConfigHtml, guestApiCss, guestConfigCss),
                            { headers: { 'Content-Type': 'text/html;charset=utf-8' } }
                        );
                    } else {
                        if (isAdminLoginEnabled(adminUser, adminPass)) {
                            const isLoggedIn = await isAdminLoggedIn(request, mytoken, adminUser, adminPass);
                            if (!isLoggedIn) {
                                if (request.method === 'POST') {
                                    return await handleAdminLogin(request, url, mytoken, adminUser, adminPass);
                                }
                                return new Response(renderLoginPage(url), { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } });
                            }
                        }
                        return await KV(
                            request, env, 'LINK.txt', 访客订阅,
                            adminApiHtml, adminConfigHtml, finalApiUrl, finalConfigUrl, adminApiCss, adminConfigCss
                        );
                    }

                } else {
                    MainData = await env.KV.get('LINK.txt') || MainData;
                }
            } else {
                MainData = env.LINK || MainData;
                if (env.LINKSUB) {
                    urls = await ADD(env.LINKSUB);
                }
            }

            let 重新汇总所有链接 = await ADD(MainData + '\n' + urls.join('\n'));
            let 自建节点 = "";
            let 订阅链接 = "";

            for (let x of 重新汇总所有链接) {
                if (x.toLowerCase().startsWith('http')) {
                    订阅链接 += x + '\n';
                } else {
                    自建节点 += x + '\n';
                }
            }

            MainData = 自建节点;
            urls = await ADD(订阅链接);

            const isSubConverterRequest = request.headers.get('subconverter-request') || request.headers.get('subconverter-version') || userAgent.includes('subconverter');
            let 订阅格式 = 'base64';

            if (!(userAgent.includes('null') || isSubConverterRequest || userAgent.includes('nekobox') || userAgent.includes(('CF-SUB').toLowerCase()))) {
                if (userAgent.includes('sing-box') || userAgent.includes('singbox') || url.searchParams.has('sb') || url.searchParams.has('singbox')) {
                    订阅格式 = 'singbox';
                } else if (userAgent.includes('surge') || url.searchParams.has('surge')) {
                    订阅格式 = 'surge';
                } else if (userAgent.includes('quantumult') || url.searchParams.has('quanx')) {
                    订阅格式 = 'quanx';
                } else if (userAgent.includes('loon') || url.searchParams.has('loon')) {
                    订阅格式 = 'loon';
                } else if (userAgent.includes('clash') || userAgent.includes('meta') || userAgent.includes('mihomo') || url.searchParams.has('clash')) {
                    订阅格式 = 'clash';
                }
            }

            let 订阅转换URL = `${url.origin}/${await MD5MD5(fakeToken)}?token=${fakeToken}`;
            let req_data = MainData;
            let 追加UA = 'v2rayn';

            if (url.searchParams.has('b64') || url.searchParams.has('base64')) {
                订阅格式 = 'base64';
            } else if (url.searchParams.has('clash')) {
                追加UA = 'clash';
            } else if (url.searchParams.has('singbox')) {
                追加UA = 'singbox';
            } else if (url.searchParams.has('surge')) {
                追加UA = 'surge';
            } else if (url.searchParams.has('quanx')) {
                追加UA = 'Quantumult%20X';
            } else if (url.searchParams.has('loon')) {
                追加UA = 'Loon';
            }

            const 订阅链接数组 = [...new Set(urls)].filter(item => item?.trim?.());

            if (订阅链接数组.length > 0) {
                const 请求订阅响应内容 = await getSUB(订阅链接数组, request, 追加UA, userAgentHeader);
                req_data += 请求订阅响应内容[0].join('\n');
                订阅转换URL += "|" + 请求订阅响应内容[1];

                if (订阅格式 == 'base64' && !isSubConverterRequest && 请求订阅响应内容[1].includes('://')) {
                    try {
                        const u = buildSubUrl(effectiveSubConverter, effectiveSubConfig, 'mixed', 请求订阅响应内容[1], effectiveSubProtocol);
                        const res = await fetch(u, { headers: { 'User-Agent': 'v2rayn/CF-SUB' } });
                        if (!res.ok) throw new Error();
                        req_data += '\n' + atob(await res.text());
                    } catch (error) {
                        try {
                            const fallbackU = buildSubUrl(defaultSubConverter, defaultSubConfig, 'mixed', 请求订阅响应内容[1], defaultSubProtocol);
                            const res2 = await fetch(fallbackU, { headers: { 'User-Agent': 'v2rayn/CF-SUB' } });
                            if (res2.ok) req_data += '\n' + atob(await res2.text());
                        } catch (e) {}
                    }
                }
            }

            if (env.WARP) {
                订阅转换URL += "|" + (await ADD(env.WARP)).join("|");
            }

            const utf8Encoder = new TextEncoder();
            const text = new TextDecoder().decode(utf8Encoder.encode(req_data));

            // 去广告过滤
            let adKeywords = [];
            let filteredLines = text.split('\n');
            if (config_noAds) {
                adKeywords = config_noAds.split(/[, \r\n]+/).map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
                if (adKeywords.length > 0) {
                    filteredLines = filteredLines.filter(line => {
                        const lowerLine = line.toLowerCase();
                        return !adKeywords.some(keyword => lowerLine.includes(keyword));
                    });
                }
            }

            const uniqueLines = new Set(filteredLines);
            const result = [...uniqueLines].join('\n');
            let base64Data;
            try {
                base64Data = btoa(result);
            } catch (e) {
                function encodeBase64(data) {
                    const binary = new TextEncoder().encode(data);
                    let base64 = '';
                    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
                    for (let i = 0; i < binary.length; i += 3) {
                        const byte1 = binary[i];
                        const byte2 = binary[i + 1] || 0;
                        const byte3 = binary[i + 2] || 0;
                        base64 += chars[byte1 >> 2];
                        base64 += chars[((byte1 & 3) << 4) | (byte2 >> 4)];
                        base64 += chars[((byte2 & 15) << 2) | (byte3 >> 6)];
                        base64 += chars[byte3 & 63];
                    }
                    const padding = 3 - (binary.length % 3 || 3);
                    return base64.slice(0, base64.length - padding) + '=='.slice(0, padding);
                }
                base64Data = encodeBase64(result);
            }

            const responseHeaders = {
                "content-type": "text/plain; charset=utf-8",
                "Profile-Update-Interval": `${SUBUpdateTime}`,
                "Profile-web-page-url": request.url.includes('?') ? request.url.split('?')[0] : request.url,
            };

            if (订阅格式 == 'base64' || token == fakeToken) {
                return new Response(base64Data, { headers: responseHeaders });
            } else {
                try {
                    const finalUrl = buildSubUrl(effectiveSubConverter, effectiveSubConfig, 订阅格式, 订阅转换URL, effectiveSubProtocol);
                    const res = await fetch(finalUrl, { headers: { 'User-Agent': userAgentHeader } });
                    if (!res.ok) throw new Error();
                    let content = await res.text();
                    if (订阅格式 == 'clash') content = clashFix(content);
                    if (!userAgent.includes('mozilla')) {
                        responseHeaders["Content-Disposition"] = `attachment; filename*=utf-8''${encodeURIComponent(FileName)}`;
                    }
                    return new Response(content, { headers: responseHeaders });
                } catch (error) {
                    try {
                        const fallbackUrl = buildSubUrl(defaultSubConverter, defaultSubConfig, 订阅格式, 订阅转换URL, defaultSubProtocol);
                        const resFb = await fetch(fallbackUrl, { headers: { 'User-Agent': userAgentHeader } });
                        if (!resFb.ok) throw new Error();
                        let contentFb = await resFb.text();
                        if (订阅格式 == 'clash') contentFb = clashFix(contentFb);
                        if (!userAgent.includes('mozilla')) {
                            responseHeaders["Content-Disposition"] = `attachment; filename*=utf-8''${encodeURIComponent(FileName)}`;
                        }
                        return new Response(contentFb, { headers: responseHeaders });
                    } catch (fallbackError) {
                        return new Response(base64Data, { headers: responseHeaders });
                    }
                }
            }
        }
    }
};

function buildSubUrl(api, config, target, urlToConvert, protocol) {
    let base = `${protocol}://${api}/sub?target=${target}&url=${encodeURIComponent(urlToConvert)}&insert=false&config=${encodeURIComponent(config)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false`;
    if (target === 'surge') base += '&ver=4&new_name=true';
    else if (target === 'quanx') base += '&udp=true';
    else if (target === 'clash' || target === 'singbox' || target === 'mixed') base += '&new_name=true';
    return base;
}

async function ADD(envadd) {
    var addtext = envadd.replace(/[ "'|\r\n]+/g, '\n').replace(/\n+/g, '\n');
    if (addtext.charAt(0) == '\n') addtext = addtext.slice(1);
    if (addtext.charAt(addtext.length - 1) == '\n') addtext = addtext.slice(0, addtext.length - 1);
    return addtext.split('\n');
}

// ================== 原生页面兜底 ==================
async function nginx(titleName) {
    return `<!DOCTYPE html>
<html>
<head>
<title>${escapeHTML(titleName)}</title>
<style>
    body { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p>
<p>For online documentation and support please refer to <a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at <a href="http://nginx.com/">nginx.com</a>.</p>
<p><em>Thank you for using nginx.</em></p>
</body>
</html>`;
}

function base64Decode(str) {
    const bytes = new Uint8Array(atob(str).split('').map(c => c.charCodeAt(0)));
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
}

async function MD5MD5(text) {
    const encoder = new TextEncoder();
    const firstPass = await crypto.subtle.digest('MD5', encoder.encode(text));
    const firstHex = Array.from(new Uint8Array(firstPass)).map(b => b.toString(16).padStart(2, '0')).join('');
    const secondPass = await crypto.subtle.digest('MD5', encoder.encode(firstHex.slice(7, 27)));
    return Array.from(new Uint8Array(secondPass)).map(b => b.toString(16).padStart(2, '0')).join('').toLowerCase();
}

function clashFix(content) {
    if (content.includes('wireguard') && !content.includes('remote-dns-resolve')) {
        let lines = content.includes('\r\n') ? content.split('\r\n') : content.split('\n');
        let result = "";
        for (let line of lines) {
            if (line.includes('type: wireguard')) {
                result += line.replace(new RegExp(`, mtu: 1280, udp: true`, 'g'), `, mtu: 1280, remote-dns-resolve: true, udp: true`) + '\n';
            } else {
                result += line + '\n';
            }
        }
        return result;
    }
    return content;
}

// 代理模式自动替换 HTML 标题
async function proxyURL(proxyURL, url, titleName) {
    const URLs = await ADD(proxyURL);
    const fullURL = URLs[Math.floor(Math.random() * URLs.length)];
    let parsedURL = new URL(fullURL);
    let URLPathname = parsedURL.pathname;
    if (URLPathname.charAt(URLPathname.length - 1) == '/') URLPathname = URLPathname.slice(0, -1);
    URLPathname += url.pathname;
    let newURL = `${parsedURL.protocol.slice(0, -1) || 'https'}://${parsedURL.hostname}${URLPathname}${parsedURL.search}`;
    
    let response = await fetch(newURL);
    const contentType = response.headers.get('content-type') || '';
    
    // 如果反代的是网页，则动态注入配置文件名作为标题
    if (contentType.includes('text/html')) {
        let html = await response.text();
        const title = `<title>${escapeHTML(titleName)}</title>`;
        if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) {
            html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, title);
        } else if (/<head\b[^>]*>/i.test(html)) {
            html = html.replace(/<head\b[^>]*>/i, match => match + title);
        } else {
            html = title + html;
        }
        let newResponse = new Response(html, {
            status: response.status,
            statusText: response.statusText,
            headers: new Headers(response.headers)
        });
        newResponse.headers.delete('content-length');
        newResponse.headers.set('X-New-URL', newURL);
        return newResponse;
    } else {
        let newResponse = new Response(response.body, { 
            status: response.status, 
            statusText: response.statusText, 
            headers: response.headers 
        });
        newResponse.headers.set('X-New-URL', newURL);
        return newResponse;
    }
}

async function getSUB(api, request, 追加UA, userAgentHeader) {
    if (!api || api.length === 0) return [];
    else api = [...new Set(api)];
    let newapi = "";
    let 订阅转换URLs = "";
    let 异常订阅 = "";
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, 2000);
    try {
        const responses = await Promise.allSettled(api.map(apiUrl => getUrl(request, apiUrl, 追加UA, userAgentHeader).then(response => response.ok ? response.text() : Promise.reject(response))));
        const modifiedResponses = responses.map((response, index) => {
            if (response.status === 'rejected') {
                return { status: response.reason && response.reason.name === 'AbortError' ? '超时' : '请求失败', value: null, apiUrl: api[index] };
            }
            return { status: response.status, value: response.value, apiUrl: api[index] };
        });
        for (const response of modifiedResponses) {
            if (response.status === 'fulfilled') {
                const content = await response.value || 'null';
                if (content.includes('proxies:') || (content.includes('outbounds"') && content.includes('inbounds"'))) {
                    订阅转换URLs += "|" + response.apiUrl;
                } else if (content.includes('://')) {
                    newapi += content + '\n';
                } else if (isValidBase64(content)) {
                    newapi += base64Decode(content) + '\n';
                } else {
                    const 异常订阅LINK = `trojan://CMLiussss@127.0.0.1:8888?security=tls&allowInsecure=1&type=tcp&headerType=none#%E5%BC%82%E5%B8%B8%E8%AE%A2%E9%98%85%20${response.apiUrl.split('://')[1].split('/')[0]}`;
                    异常订阅 += `${异常订阅LINK}\n`;
                }
            }
        }
    } catch (error) {
    } finally {
        clearTimeout(timeout);
    }
    return [await ADD(newapi + 异常订阅), 订阅转换URLs];
}

async function getUrl(request, targetUrl, 追加UA, userAgentHeader) {
    const newHeaders = new Headers(request.headers);
    newHeaders.set("User-Agent", `${atob('djJyYXlOLzYuNDU=')} cmliu/CF-SUB ${追加UA}(${userAgentHeader})`);
    return fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.method === "GET" ? null : request.body,
        redirect: "follow",
        cf: { insecureSkipVerify: true, allowUntrusted: true, validateCertificate: false }
    }));
}

function isValidBase64(str) { return /^[A-Za-z0-9+/=]+$/.test(str.replace(/\s/g, '')); }

async function 迁移地址列表(env, txt = 'ADD.txt') {
    const 旧数据 = await env.KV.get(`/${txt}`);
    const 新数据 = await env.KV.get(txt);
    if (旧数据 && !新数据) {
        await env.KV.put(txt, 旧数据);
        await env.KV.delete(`/${txt}`);
        return true;
    }
    return false;
}

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

function escapeHTML(text = '') {
    return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function getAdminSessionValue(user, pass, token) {
    if (!user || !pass) return '';
    return await MD5MD5(`${user}:${pass}:${token}:admin-login`);
}

function isAdminLoginEnabled(user, pass) { return !!(user && pass); }

async function isAdminLoggedIn(request, token, user, pass) {
    const session = await getAdminSessionValue(user, pass, token);
    return session ? getCookie(request, 'CF_SUB_ADMIN') === session : false;
}

function buildAdminCookie(value, url) {
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return `CF_SUB_ADMIN=${encodeURIComponent(value)}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

async function handleAdminLogin(request, url, token, user, pass) {
    let inputUser = '';
    let inputPass = '';
    try {
        const form = await request.formData();
        inputUser = String(form.get('username') || '');
        inputPass = String(form.get('password') || '');
    } catch (e) {
        return new Response(renderLoginPage(url, '登录请求格式不正确'), { status: 400, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (inputUser === user && inputPass === pass) {
        const session = await getAdminSessionValue(user, pass, token);
        return new Response('', { status: 302, headers: { 'Location': url.pathname, 'Set-Cookie': buildAdminCookie(session, url), 'Cache-Control': 'no-store' } });
    }
    return new Response(renderLoginPage(url, '用户名或密码错误'), { status: 401, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ==================== UI 样式与渲染模块 ====================
function getToolStyles() {
    return `
        * { box-sizing: border-box; }
        body { margin: 0; background: #f5f7fa; color: #202124; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; min-height: 100vh; transition: background 0.3s, color 0.3s; }
        .page { width: 100%; max-width: 760px; margin: 0 auto; padding: 18px 14px 28px; }
        .header { margin-bottom: 14px; }
        .title { margin: 0; font-size: 28px; font-weight: 700; line-height: 1.2; color: #1a1a1a; transition: color 0.3s; }
        .subtitle { margin-top: 8px; color: #666; font-size: 13px; }
        .panel { background: rgba(255, 255, 255, 0.85); border: 1px solid rgba(229, 229, 223, 0.8); border-radius: 20px; padding: 16px; margin-top: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05); transition: background 0.3s, border-color 0.3s; }
        .section-title { margin: 0 0 10px; font-size: 15px; font-weight: 700; }
        .section-note { margin: 4px 0 10px; color: #888; font-size: 12px; }
        .link-list { display: grid; gap: 10px; }
        .link-item { border: 1px solid rgba(229, 229, 223, 0.6); border-radius: 12px; padding: 12px; background: rgba(255, 255, 255, 0.5); transition: background 0.3s, border-color 0.3s; }
        .link-label { font-weight: 600; margin-bottom: 8px; color: #1a1a1a; transition: color 0.3s; }
        .link-url { display: block; width: 100%; word-wrap: break-word; overflow-wrap: break-word; word-break: break-all; white-space: normal; padding: 10px; border: 1px solid rgba(229, 229, 223, 0.8); border-radius: 8px; background: rgba(250, 250, 250, 0.7); color: #1f4b99; text-decoration: none; transition: all 0.3s ease; }
        .link-url:hover { background: rgba(31, 75, 153, 0.05); border-color: #1f4b99; }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        button { min-height: 36px; padding: 8px 16px; border: 1px solid #343a40; border-radius: 10px; background: #2f3338; color: #fff; font-size: 14px; cursor: pointer; font-weight: 600; transition: all 0.3s ease; }
        button:hover { background: #1f2327; box-shadow: 0 4px 12px rgba(34, 34, 34, 0.15); }
        button.secondary { background: #fff; color: #222; border-color: #c8c8c0; }
        button.secondary:hover { background: #f1f3f5; }
        button.danger { background: #dc3545; border-color: #dc3545; }
        button.danger:hover { background: #c82333; box-shadow: 0 4px 12px rgba(220, 53, 69, 0.2); }
        button:disabled { opacity: 0.65; cursor: default; }
        .field { margin-top: 12px; }
        label { display: block; margin-bottom: 6px; font-weight: 600; color: #1a1a1a; transition: color 0.3s; }
        input, textarea, select { width: 100%; border: 1px solid rgba(207, 207, 200, 0.6); border-radius: 10px; background: rgba(255, 255, 255, 0.8); color: #202124; font-size: 14px; padding: 10px; transition: all 0.3s ease; word-wrap: break-word; word-break: break-all; white-space: pre-wrap; }
        input:focus, textarea:focus, select:focus { outline: none; border-color: #3b82f6; background: #fff; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
        input, select { height: 42px; white-space: normal; }
        textarea { min-height: 200px; line-height: 1.5; resize: vertical; }
        .error { color: #b00020; margin-top: 10px; }
        .muted { color: #666; font-size: 13px; margin-left: 8px; transition: color 0.3s; }
        .toast { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); display: none; min-width: 190px; max-width: calc(100vw - 40px); padding: 12px 18px; text-align: center; color: #fff; background: rgba(0, 0, 0, 0.82); border-radius: 12px; z-index: 9999; }
        .status-indicator { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 8px; font-weight: 600; width: 100%; word-break: break-all; transition: background 0.3s, color 0.3s, border-color 0.3s; }
        .status-ok { background: rgba(76, 175, 80, 0.1); color: #2e7d32; border: 1px solid rgba(76, 175, 80, 0.2); }
        .status-warn { background: rgba(255, 152, 0, 0.1); color: #f57c00; border: 1px solid rgba(255, 152, 0, 0.2); }
        .status-error { background: rgba(244, 67, 54, 0.1); color: #c62828; border: 1px solid rgba(244, 67, 54, 0.2); }
        #current-qrcode { display: none; margin-top: 12px; padding: 12px; border: 1px solid rgba(229, 229, 223, 0.6); border-radius: 12px; background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(10px); width: fit-content; max-width: 100%; }
        .hidden { display: none !important; }
        .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: none; justify-content: center; align-items: center; z-index: 1000; overflow-y: auto; }
        .modal-content { background: rgba(255, 255, 255, 0.95); border-radius: 20px; padding: 24px; width: 90%; max-width: 480px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); border: 1px solid rgba(255, 255, 255, 0.5); transition: background 0.3s, border-color 0.3s; margin: 20px auto; }
        @media (prefers-color-scheme: dark) {
            body { background: #121212; color: #e0e0e0; }
            .title { color: #f5f5f5; }
            .subtitle, .section-note, .muted { color: #aaa; }
            .panel { background: rgba(30, 30, 30, 0.75); border-color: rgba(255, 255, 255, 0.1); box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
            .link-item { background: rgba(40, 40, 40, 0.5); border-color: rgba(255, 255, 255, 0.1); }
            .link-label, label { color: #ddd; }
            .link-url { background: rgba(0, 0, 0, 0.3); color: #64b5f6; border-color: rgba(255,255,255,0.1); }
            .link-url:hover { background: rgba(100, 181, 246, 0.1); border-color: #64b5f6; }
            input, textarea, select { background: rgba(20, 20, 20, 0.8); color: #fff; border-color: rgba(255,255,255,0.2); }
            input:focus, textarea:focus, select:focus { background: #000; border-color: #3b82f6; }
            button { background: #3f4650; color: #fff; border-color: #69717c; box-shadow: 0 2px 8px rgba(0,0,0,0.28); }
            button:hover { background: #525b67; border-color: #858f9b; box-shadow: 0 4px 14px rgba(0,0,0,0.4); }
            button.secondary { background: #3a414a; color: #fff; border-color: #69717c; }
            button.secondary:hover { background: #4b5561; border-color: #858f9b; }
            button.danger { background: #b8323f; color: #fff; border-color: #d24b58; }
            button.danger:hover { background: #d13e4d; border-color: #e16a75; }
            .status-ok { background: rgba(129, 199, 132, 0.1); color: #81c784; border-color: rgba(129, 199, 132, 0.2); }
            .status-warn { background: rgba(255, 183, 77, 0.1); color: #ffb74d; border-color: rgba(255, 183, 77, 0.2); }
            .status-error { background: rgba(229, 115, 115, 0.1); color: #e57373; border-color: rgba(229, 115, 115, 0.2); }
            .modal-content { background: rgba(30, 30, 30, 0.95); border-color: rgba(255, 255, 255, 0.1); }
            #current-qrcode { background: rgba(255, 255, 255, 0.9); }
        }
    `;
}

function getSubscriptionLinks(url, token) {
    const base = `https://${url.hostname}/${token}`;
    return [
        ['自适应订阅地址', base],
        ['Base64订阅地址', `${base}?b64`],
        ['Clash订阅地址', `${base}?clash`],
        ['Sing-box订阅地址', `${base}?sb`],
        ['Surge订阅地址', `${base}?surge`],
        ['Loon订阅地址', `${base}?loon`],
    ];
}

function renderLinkList(links) {
    return `<div class="link-list">
        ${links.map(([label, value]) => `
            <div class="link-item">
                <div class="link-label">${escapeHTML(label)}</div>
                <a class="link-url" href="${escapeHTML(value)}" target="_blank">${escapeHTML(value)}</a>
                <div class="actions">
                    <button type="button" class="copy-btn" onclick="copySubscription(this)" data-url="${escapeHTML(value)}">复制</button>
                    <button type="button" class="secondary hide-btn hidden" onclick="hideQrcode(this)">隐藏二维码</button>
                </div>
            </div>
        `).join('')}
    </div>`;
}

function renderToolScripts(includeEditor = false) {
    return `<script>
        let toastTimer;
        function showToast(message) {
            const toast = document.getElementById('copyNotice');
            toast.textContent = message;
            toast.style.display = 'block';
            clearTimeout(toastTimer);
            toastTimer = setTimeout(function () { toast.style.display = 'none'; }, 1500);
        }
        function copySubscription(button) {
            navigator.clipboard.writeText(button.dataset.url).then(function () {
                showToast('已复制到剪贴板');
                showQrcode(button);
                button.classList.add('hidden');
                const hideBtn = button.closest('.actions').querySelector('.hide-btn');
                if (hideBtn) hideBtn.classList.remove('hidden');
            }).catch(function () { showToast('复制失败，请手动复制'); });
        }
        function showQrcode(button) {
            const qrcodeDiv = document.getElementById('current-qrcode');
            button.closest('.link-item').appendChild(qrcodeDiv);
            qrcodeDiv.innerHTML = '';
            qrcodeDiv.style.display = 'block';
            new QRCode(qrcodeDiv, { text: button.dataset.url, width: 220, height: 220, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.Q });
        }
        function hideQrcode(button) {
            const qrcodeDiv = document.getElementById('current-qrcode');
            qrcodeDiv.style.display = 'none';
            qrcodeDiv.innerHTML = '';
            button.classList.add('hidden');
            const copyBtn = button.closest('.actions').querySelector('.copy-btn');
            if (copyBtn) copyBtn.classList.remove('hidden');
        }

        ${includeEditor ? `
        function openSecurityModal() { document.getElementById('securityModal').style.display = 'flex'; }
        function closeSecurityModal() { document.getElementById('securityModal').style.display = 'none'; }
        
        function openFakeModal() { document.getElementById('fakeModal').style.display = 'flex'; }
        function closeFakeModal() { document.getElementById('fakeModal').style.display = 'none'; }
        
        function switchFakeMode() {
            const mode = document.getElementById('fake-mode').value;
            document.getElementById('fake-group-url').classList.add('hidden');
            document.getElementById('fake-group-url302').classList.add('hidden');
            document.getElementById('fake-group-code').classList.add('hidden');
            
            if (mode === '1') document.getElementById('fake-group-url').classList.remove('hidden');
            if (mode === '2') document.getElementById('fake-group-url302').classList.remove('hidden');
            if (mode === '3') document.getElementById('fake-group-code').classList.remove('hidden');
        }

        function saveConfig(button, type) {
            const isSec = type === 'sec';
            const isFake = type === 'fake';
            const statusElem = document.getElementById(isSec ? 'secSaveStatus' : (isFake ? 'fakeSaveStatus' : 'configSaveStatus'));

            const secPass = document.getElementById('sec-pass') ? document.getElementById('sec-pass').value : '';
            const secPass2 = document.getElementById('sec-pass2') ? document.getElementById('sec-pass2').value : '';
            if (isSec && secPass !== secPass2) { alert('两次输入的密码不一致！'); return; }

            button.disabled = true;
            const originalText = button.textContent;
            button.textContent = '保存中...';

            fetch(window.location.href, {
                method: 'POST',
                body: JSON.stringify({
                    type: 'config',
                    settings: {
                        guest: document.getElementById('sec-guest') ? document.getElementById('sec-guest').value : '',
                        user: document.getElementById('sec-user') ? document.getElementById('sec-user').value : '',
                        pass: secPass,
                        subName: document.getElementById('config-subname') ? document.getElementById('config-subname').value : '',
                        subApi: document.getElementById('config-subapi') ? document.getElementById('config-subapi').value : '',
                        subConfig: document.getElementById('config-subconfig') ? document.getElementById('config-subconfig').value : '',
                        noAds: document.getElementById('config-noads') ? document.getElementById('config-noads').value : '',
                        fakeMode: document.getElementById('fake-mode') ? document.getElementById('fake-mode').value : '',
                        fakeUrl: document.getElementById('fake-url') ? document.getElementById('fake-url').value : '',
                        fakeUrl302: document.getElementById('fake-url302') ? document.getElementById('fake-url302').value : '',
                        fakeCode: document.getElementById('fake-code') ? document.getElementById('fake-code').value : ''
                    }
                }),
                headers: { 'Content-Type': 'application/json' }
            }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.text();
            }).then(function () {
                statusElem.textContent = '已保存 ' + new Date().toLocaleString();
                statusElem.style.color = 'var(--coral, #2e7d32)';
                setTimeout(() => window.location.reload(), 500);
            }).catch(function (err) {
                statusElem.textContent = '保存失败: 网络异常或超时';
                statusElem.style.color = '#c62828';
                console.error(err);
            }).finally(function () {
                button.disabled = false;
                button.textContent = originalText;
            });
        }

        function saveContent(button) {
            const textarea = document.getElementById('content');
            const statusElem = document.getElementById('saveStatus');
            if (!textarea) return;
            textarea.value = textarea.value.replace(/：/g, ':');
            button.disabled = true;
            button.textContent = '保存中...';
            fetch(window.location.href, {
                method: 'POST',
                body: JSON.stringify({ type: 'content', content: textarea.value || '' }),
                headers: { 'Content-Type': 'application/json' }
            }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                statusElem.textContent = '已保存 ' + new Date().toLocaleString();
                statusElem.style.color = '#2e7d32';
            }).catch(function (err) {
                statusElem.textContent = '保存失败: 网络异常';
                statusElem.style.color = '#c62828';
                console.error(err);
            }).finally(function () {
                button.disabled = false;
                button.textContent = '保存节点订阅';
            });
        }
        ` : ''}
    </script>`;
}

function renderLoginPage(url, error = '') {
    return `<!DOCTYPE html>
<html>
<head>
<title>${escapeHTML(FileName)}管理面板</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${getToolStyles()}
.login-btn { display: block; width: 100%; max-width: 280px; min-height: 44px; margin: 28px auto 6px; background: #2f3338; border: 1px solid #343a40; border-radius: 12px; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; }
.login-btn:hover { background: #1f2327; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25); }
@media (prefers-color-scheme: dark) { .login-btn { background: #3f4650; border-color: #69717c; } .login-btn:hover { background: #525b67; border-color: #858f9b; } }
.error { text-align: center; margin-top: 15px; color: #c62828; }
</style>
</head>
<body style="display:flex; justify-content:center; align-items:center; min-height:100vh; margin:0;">
<main class="page" style="width:100%; max-width:420px; padding:20px; margin:0;">
<section class="panel" style="padding:30px 24px; text-align:center;">
<h1 class="title" style="margin-bottom:10px;">${escapeHTML(FileName)}</h1>
<div class="subtitle" style="margin-bottom:24px;">请登录管理员控制台</div>
<form method="POST" action="${escapeHTML(url.pathname)}" style="text-align:left;">
<div class="field"><label>用户名</label><input name="username" type="text" required autofocus></div>
<div class="field"><label>密码</label><input name="password" type="password" required></div>
<button type="submit" class="login-btn">登录</button>
${error ? `<div class="error">${escapeHTML(error)}</div>` : ''}
</form>
</section>
</main>
</body>
</html>`;
}

function renderGuestPage(url, guest, displayApiUrl, displayConfig, apiHtml, configHtml, apiCss, configCss) {
    return `<!DOCTYPE html>
<html>
<head>
<title>${escapeHTML(FileName)}访客订阅</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${getToolStyles()}</style>
<script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script>
</head>
<body>
<div id="copyNotice" class="toast"></div>
<main class="page">
<header class="header">
<h1 class="title">${escapeHTML(FileName)} 访客订阅</h1>
<div class="subtitle">复制订阅链接或生成二维码</div>
</header>
<section class="panel">
<h2 class="section-title">订阅链接</h2>
${renderLinkList(getSubscriptionLinks(url, guest))}
</section>
<section class="panel">
<h2 class="section-title">订阅转换服务</h2>
<div class="link-list">
<div class="link-item">
<div class="link-label">订阅转换后端 SUBAPI</div>
<div class="status-indicator ${apiCss}">${apiHtml}</div>
<div class="section-note" style="margin-top:12px; margin-bottom:6px;">当前配置</div>
<a class="link-url" href="${escapeHTML(displayApiUrl)}" target="_blank">${escapeHTML(displayApiUrl)}</a>
</div>
<div class="link-item">
<div class="link-label">订阅转换规则 SUBCONFIG</div>
<div class="status-indicator ${configCss}">${configHtml}</div>
<div class="section-note" style="margin-top:12px; margin-bottom:6px;">当前配置</div>
<a class="link-url" href="${escapeHTML(displayConfig)}" target="_blank">${escapeHTML(displayConfig)}</a>
</div>
</div>
</section>
<div id="current-qrcode"></div>
</main>
${renderToolScripts(false)}
</body>
</html>`;
}

function renderAdminPage(url, content, hasKV, settings, adminApiHtml, adminConfigHtml, currentApi, currentConfig, apiCss, configCss) {
    
    // 生成主页状态说明
    let fakeStatusHtml = '';
    let fakeStatusCss = '';
    if (settings.fakeMode === '1') {
        if (settings.fakeUrl) { fakeStatusHtml = `✅ 当前使用: URL反向代理`; fakeStatusCss = 'status-ok'; }
        else { fakeStatusHtml = `❌ 无效: 未填写URL，自动拦截为原生NGINX`; fakeStatusCss = 'status-error'; }
    } else if (settings.fakeMode === '2') {
        if (settings.fakeUrl302) { fakeStatusHtml = `✅ 当前使用: URL重定向(302)`; fakeStatusCss = 'status-ok'; }
        else { fakeStatusHtml = `❌ 无效: 未填写目标地址，自动拦截为原生NGINX`; fakeStatusCss = 'status-error'; }
    } else if (settings.fakeMode === '3') {
        if (settings.fakeCode) { fakeStatusHtml = `✅ 当前使用: 自定义HTML`; fakeStatusCss = 'status-ok'; }
        else { fakeStatusHtml = `❌ 无效: 代码为空，自动拦截为原生NGINX`; fakeStatusCss = 'status-error'; }
    } else {
        fakeStatusHtml = `✅ 当前使用: 默认防嗅探 (原生NGINX 强制覆盖模式)`;
        fakeStatusCss = 'status-ok';
    }

    return `<!DOCTYPE html>
<html>
<head>
<title>${escapeHTML(FileName)}管理面板</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${getToolStyles()}</style>
<script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script>
</head>
<body onload="switchFakeMode()">

<div id="copyNotice" class="toast"></div>

<!-- 安全设置 Modal -->
<div id="securityModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px; margin-bottom:20px;">🛡️ 账户与安全设置</h2>
<div class="field"><label>访客订阅入口 (GUEST)</label><input id="sec-guest" type="text" value="${escapeHTML(settings.guest || '')}" placeholder="留空则按内置算法自动生成"></div>
<div class="field"><label>后台登录账号 (USER)</label><input id="sec-user" type="text" value="${escapeHTML(settings.user || '')}" placeholder="例如：admin"></div>
<div class="field"><label>后台登录密码 (PASS)</label><input id="sec-pass" type="password" value="" placeholder="留空则不修改当前密码"></div>
<div class="field"><label>确认登录密码</label><input id="sec-pass2" type="password" value="" placeholder="留空则不修改当前密码"></div>
<div class="actions" style="margin-top:24px; justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeSecurityModal()">取消</button>
<button type="button" onclick="saveConfig(this, 'sec')">保存修改</button>
</div>
<span id="secSaveStatus" class="muted" style="display:block; text-align:right; margin-top:8px;"></span>
</div>
</div>

<!-- 主页设置 Modal -->
<div id="fakeModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px; margin-bottom:20px;">🏠 主页设置</h2>
<div class="status-indicator ${fakeStatusCss}" style="margin-bottom:16px;">${fakeStatusHtml}</div>
<div class="field">
<label>主页模式</label>
<select id="fake-mode" onchange="switchFakeMode()">
    <option value="0" ${settings.fakeMode === '0' || settings.fakeMode === '' ? 'selected' : ''}>[关闭] 强制原生 NGINX</option>
    <option value="1" ${settings.fakeMode === '1' ? 'selected' : ''}>[URL] 网页反向代理</option>
    <option value="2" ${settings.fakeMode === '2' ? 'selected' : ''}>[URL302] 强制重定向</option>
    <option value="3" ${settings.fakeMode === '3' ? 'selected' : ''}>[HTML] 自定义代码</option>
</select>
</div>
<div class="field hidden" id="fake-group-url">
<label>反代目标地址 (URL)</label>
<input id="fake-url" type="text" value="${escapeHTML(settings.fakeUrl || '')}" placeholder="例如: https://www.bing.com">
</div>
<div class="field hidden" id="fake-group-url302">
<label>重定向地址 (URL302)</label>
<input id="fake-url302" type="text" value="${escapeHTML(settings.fakeUrl302 || '')}" placeholder="例如: https://github.com">
</div>
<div class="field hidden" id="fake-group-code">
<label>自定义 HTML 代码 (CODE)</label>
<textarea id="fake-code" style="min-height:150px" placeholder="在此粘贴你的网页 HTML 代码...">${escapeHTML(settings.fakeCode || '')}</textarea>
<div class="section-note">填写后若代码为空将自动降级为默认NGINX页面。</div>
</div>
<div class="actions" style="margin-top:24px; justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeFakeModal()">取消</button>
<button type="button" onclick="saveConfig(this, 'fake')">保存修改</button>
</div>
<span id="fakeSaveStatus" class="muted" style="display:block; text-align:right; margin-top:8px;"></span>
</div>
</div>

<main class="page">
<header class="header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
<div>
<h1 class="title">${escapeHTML(settings.subName)}</h1>
<div class="subtitle">汇聚订阅控制台</div>
</div>
<div style="display:flex; gap:8px;">
${hasKV ? `<button type="button" onclick="openFakeModal()">🏠 主页</button>
           <button type="button" onclick="openSecurityModal()">🛡️ 安全</button>` : ''}
<button type="button" class="danger" onclick="window.location.href='?logout=1'">🚪 退出</button>
</div>
</header>

<section class="panel">
<h2 class="section-title">全局名称设置 (SUBNAME)</h2>
<div class="field"><input id="config-subname" type="text" value="${escapeHTML(settings.subName)}" placeholder="例如：CF-SUB"></div>
</section>

<section class="panel">
<h2 class="section-title">订阅转换后端 SUBAPI</h2>
<div class="field">
<input id="config-subapi" type="text" value="${escapeHTML(settings.subApi || '')}" placeholder="[默认值]">
<div class="status-indicator ${apiCss}" style="margin-top:8px;">${adminApiHtml}</div>
<div class="section-note" style="margin-top:12px; margin-bottom:6px;">当前配置</div>
<a class="link-url" href="${escapeHTML(currentApi)}" target="_blank">${escapeHTML(currentApi)}</a>
</div>
</section>

<section class="panel">
<h2 class="section-title">订阅转换规则 SUBCONFIG</h2>
<div class="field">
<textarea id="config-subconfig" style="min-height:80px" placeholder="[默认值]">${escapeHTML(settings.subConfig || '')}</textarea>
<div class="status-indicator ${configCss}" style="margin-top:8px;">${adminConfigHtml}</div>
<div class="section-note" style="margin-top:12px; margin-bottom:6px;">当前配置</div>
<a class="link-url" href="${escapeHTML(currentConfig)}" target="_blank">${escapeHTML(currentConfig)}</a>
</div>
</section>

<section class="panel">
<h2 class="section-title">去广告关键字 NOADS</h2>
<div class="field">
<textarea id="config-noads" style="min-height:80px;" placeholder="示例: 加入TG群, 订阅YouTube频道, https://t.me ......">${escapeHTML(settings.noAds)}</textarea>
<div class="section-note">使用英文逗号、空格或换行分隔</div>
</div>
${hasKV ? `<div class="actions" style="margin-top:16px;">
<button type="button" onclick="saveConfig(this, 'main')">保存全局设置并重载</button>
<span id="configSaveStatus" class="muted"></span>
</div>` : '<p class="muted">请绑定变量名称为 KV 的 KV 命名空间</p>'}
</section>

<section class="panel">
<h2 class="section-title">汇聚订阅节点编辑</h2>
${hasKV ? `<textarea id="content" placeholder="在此输入单节点链接或订阅地址...">${escapeHTML(content)}</textarea>
<div class="actions"><button type="button" onclick="saveContent(this)">保存节点订阅</button><span id="saveStatus" class="muted"></span></div>` : '<p class="muted">请绑定变量名称为 KV 的 KV 命名空间</p>'}
</section>

<section class="panel">
<h2 class="section-title">管理员直接订阅链接</h2>
${renderLinkList(getSubscriptionLinks(url, mytoken))}
</section>

<div id="current-qrcode"></div>
</main>

${renderToolScripts(true)}
</body>
</html>`;
}

async function KV(request, env, txt, guest, adminApiHtml, adminConfigHtml, currentApiUrl, currentConfigUrl, apiCss, configCss) {
    let settings = { subName: 'CF-SUB', subApi: '', subConfig: '', noAds: '', guest: '', user: '', pass: '', fakeMode: '', fakeUrl: '', fakeUrl302: '', fakeCode: '' };
    let hasKV = !!env.KV;

    if (hasKV) {
        try {
            const kvConfigStr = await env.KV.get('CONFIG.json');
            if (kvConfigStr) {
                settings = { ...settings, ...JSON.parse(kvConfigStr) };
            }
        } catch (e) {}
    }

    try {
        if (request.method === "POST") {
            if (!hasKV) return new Response("未绑定KV空间", { status: 400 });
            const contentType = request.headers.get('content-type') || '';
            if (contentType.includes('application/x-www-form-urlencoded')) return Response.redirect(request.url, 302);
            const text = await request.text();

            try {
                const data = JSON.parse(text);
                if (data.type === 'config') {
                    if (!data.settings.pass) {
                        let oldConfig = {};
                        try {
                            const oldKvStr = await env.KV.get('CONFIG.json');
                            if (oldKvStr) oldConfig = JSON.parse(oldKvStr);
                        } catch (e) {}
                        data.settings.pass = oldConfig.pass || '';
                    }
                    await env.KV.put('CONFIG.json', JSON.stringify(data.settings));
                    return new Response("设置保存成功");
                } else if (data.type === 'content') {
                    await env.KV.put(txt, data.content || '');
                    return new Response("订阅保存成功");
                }
            } catch (jsonErr) {
                return new Response("不支持的数据格式", { status: 400 });
            }
        }

        let content = '';
        if (hasKV) {
            try { content = await env.KV.get(txt) || ''; } catch (error) { content = '读取数据时发生错误'; }
        }

        return new Response(
            renderAdminPage(new URL(request.url), content, hasKV, settings, adminApiHtml, adminConfigHtml, currentApiUrl, currentConfigUrl, apiCss, configCss),
            { headers: { "Content-Type": "text/html;charset=utf-8" } }
        );
    } catch (error) {
        return new Response("服务器错误: " + error.message, { status: 500 });
    }
}
