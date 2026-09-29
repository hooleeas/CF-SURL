# CF-SURL

基于 Cloudflare Workers 和 KV 构建的极简、安全的专属短链接生成器。

## ✨ 核心特性

* **开箱即用**：自带极简的前台生成页面与安全的后台管理面板。
* **API 兼容**：兼容 `sub-web-modify` 短链接生成 API。
* **唯一链接**：相同长链接自动返回已有短链接（哈希校验）。
* **安全管理**：支持自定义后台账号密码，支持后台直接编辑、删除、自定义 Key。
* **跨域支持**：原生支持 CORS，方便其他项目直接调用。

---

## ⚙️ 部署与配置

在 Cloudflare Dashboard 中配置以下环境变量与绑定：

* **KV 命名空间绑定** (必需):
* 变量名: `LINKS`


* **环境变量** (可选，用于保护 `/admin` 后台):
* `USER`: 后台登录用户名
* `PASS`: 后台登录密码



---

## 🔌 API 文档

本项目提供两套公开短链接生成 API，均支持跨域（CORS）。

### 1. 兼容型 API（推荐）

兼容 `sub-web-modify` 格式，返回完整的短链接 URL。

* **接口地址**: `/api/shorten`
* **请求方式**: `POST`
* **Content-Type**: `application/json` 或 `multipart/form-data`
* **请求参数**:
| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `url` | String | 是 | 需要缩短的目标长链接（也支持使用 `target` 或 `long_url` 字段） |


* **请求示例**:
```json
{
  "url": "https://github.com"
}

```


* **成功响应 (200 OK)**:
```json
{
  "status": 200,
  "key": "A1b2Cd",
  "url": "https://你的域名/A1b2Cd",
  "short_url": "https://你的域名/A1b2Cd"
}

```


* **失败响应 (400 Bad Request)**:
```json
{
  "status": 400,
  "error": "缺少 url 参数"
}

```



### 2. 标准极简 API

本项目自带前台页面所使用的原生接口，仅返回相对路径。

* **接口地址**: `/`
* **请求方式**: `POST`
* **Content-Type**: `application/json`
* **请求参数**:
| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `url` | String | 是 | 需要缩短的目标长链接 |


* **请求示例**:
```json
{
  "url": "https://github.com"
}

```


* **成功响应 (200 OK)**:
```json
{
  "status": 200,
  "key": "/A1b2Cd",
  "short_url": "/A1b2Cd"
}

```



---

## 🛠️ 后台管理 API（内部接口）

管理后台默认挂载于 `/admin`，前端通过调用以下内部 API 实现管理功能（需要身份验证 Cookie `CF_SHORT_ADMIN`）：

* **获取链接列表**: `GET /admin/api/links`
* **创建自定义链接**: `POST /admin/api/create` 参数 `{ "key": "...", "url": "..." }`
* **更新链接**: `POST /admin/api/update` 参数 `{ "oldKey": "...", "key": "...", "url": "..." }`
* **删除链接**: `POST /admin/api/delete` 参数 `{ "key": "..." }`
* **更新账户密码**: `POST /admin/api/config` 参数 `{ "user": "...", "pass": "...", "confirm_pass": "..." }`
