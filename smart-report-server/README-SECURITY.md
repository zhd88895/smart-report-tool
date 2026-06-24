# 安全加固说明

## 概述

本文档描述了智能报告生成工具后端服务在 v0.3.0 版本中引入的安全加固措施。

## 新增安全功能

### 1. JWT 认证

- **机制**：使用 JSON Web Token (JWT) 进行用户认证
- **适用范围**：所有 API 端点（除 `/api/health`、`/api/users/login` 和 `/api/users/register`）
- **Token 传递**：通过 `Authorization` 请求头传递，格式为 `Bearer <token>`
- **Token 有效期**：默认 24 小时（可通过环境变量 `JWT_EXPIRES_IN` 配置）
- **签名算法**：HS256（HMAC-SHA256）

#### 使用示例

```bash
# 登录获取 Token
curl -X POST http://localhost:3001/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"username":"your_username","password":"your_password"}'

# 使用 Token 访问受保护端点
curl http://localhost:3001/api/scripts \
  -H "Authorization: Bearer <your_token>"
```

### 2. 密码安全

- **哈希算法**：使用 bcryptjs 进行密码哈希
- **加密轮数**：默认 12 轮（可通过环境变量 `BCRYPT_ROUNDS` 配置，范围 4-31）
- **密码强度要求**：
  - 至少 8 个字符
  - 包含至少一个大写字母
  - 包含至少一个小写字母
  - 包含至少一个数字

### 3. 文件安全

- **文件名验证**：仅允许 `[a-zA-Z0-9_\-.]` 字符，防止特殊字符注入
- **路径遍历防护**：禁止包含 `..` 的路径，防止目录遍历攻击
- **文件完整性校验**：使用 SHA-256 哈希验证辅助文件完整性
- **文件大小限制**：JSON 请求体限制 10MB

### 4. CORS 配置

- **来源控制**：从环境变量 `ALLOWED_ORIGINS` 读取允许的来源列表
- **默认允许来源**：`http://localhost:5173`, `http://localhost:3000`
- **凭证支持**：默认启用 `Access-Control-Allow-Credentials`
- **预检缓存**：默认 24 小时（86400 秒）

### 5. 角色权限控制

- **角色类型**：`admin`（管理员）、`senior`（高级用户）、`member`（普通成员）
- **权限粒度**：路由级别的角色授权中间件
- **默认权限**：未指定角色的用户默认为 `member`

### 6. 请求日志

- **日志级别**：DEBUG、INFO、WARN、ERROR
- **日志轮转**：按文件大小自动轮转，默认 10MB/文件，保留 10 个文件
- **记录内容**：请求方法、路径、状态码、耗时

## 环境变量配置

### 创建 .env 文件

```bash
cp .env.example .env
```

### 必需配置项

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `JWT_SECRET` | JWT 签名密钥（**必须修改！**） | `your-secure-random-string-here` |

### 可选配置项

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | `3001` |
| `DATA_DIR` | 数据目录路径 | `./data` |
| `JWT_EXPIRES_IN` | JWT Token 过期时间 | `24h` |
| `ALLOWED_ORIGINS` | 允许的 CORS 来源（逗号分隔） | `http://localhost:5173,http://localhost:3000` |
| `BCRYPT_ROUNDS` | bcrypt 加密轮数 | `12` |
| `LOG_MAX_SIZE` | 日志文件最大大小（字节） | `10485760` (10MB) |
| `LOG_MAX_FILES` | 保留的日志文件数量 | `10` |
| `NODE_ENV` | 运行环境 | `development` |

### 生成安全的 JWT_SECRET

```bash
# 使用 Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 使用 OpenSSL
openssl rand -hex 64
```

## 升级指南

### 从 v0.2.x 升级到 v0.3.0

1. **安装新依赖**：
   ```bash
   npm install
   ```

2. **配置环境变量**：
   ```bash
   cp .env.example .env
   # 编辑 .env，至少设置 JWT_SECRET
   ```

3. **重启服务**：
   ```bash
   npm run dev
   ```

### 重要变更

- **认证要求**：除登录和注册外的所有 API 端点现在需要 JWT Token
- **响应格式**：所有 API 响应统一为 `{ code, data, message, error? }` 格式
- **401 响应**：表示 Token 无效、过期或未提供

## API 变更

### 认证端点（无需 Token）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/users/register` | 用户注册 |
| POST | `/api/users/login` | 用户登录 |
| GET | `/api/health` | 健康检查 |

### 受保护端点（需要 Token）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/users` | 获取用户列表 |
| GET/POST | `/api/scripts` | 脚本管理 |
| GET/POST | `/api/templates` | 模板管理 |
| GET/POST | `/api/reports` | 报告管理 |
| GET/POST | `/api/conversations` | 对话管理 |

### 错误响应格式

```json
{
  "code": 401,
  "data": null,
  "message": "认证失败",
  "error": "Token已过期"
}
```

## 安全最佳实践

1. **生产环境**：
   - 使用强随机字符串作为 `JWT_SECRET`
   - 设置 `NODE_ENV=production`
   - 配置具体的 `ALLOWED_ORIGINS`（不要使用 `*`）
   - 使用 HTTPS

2. **定期维护**：
   - 定期轮换 `JWT_SECRET`
   - 监控日志文件大小
   - 审查用户权限

3. **开发环境**：
   - 使用独立的 `.env` 文件
   - 不要将 `.env` 文件提交到版本控制
   - 测试时使用测试专用的 JWT_SECRET

## 架构说明

本次安全加固采用模块化设计：

```
src/
├── index.ts              # 主入口（重构版）
├── index.old.ts          # 原始入口（备份）
├── config.ts             # 配置管理
├── types.ts              # 类型定义
├── middleware/
│   ├── auth.ts           # JWT 认证中间件
│   ├── cors.ts           # CORS 配置中间件
│   └── security.ts       # 安全校验工具
├── routes/
│   ├── users.ts          # 用户路由
│   ├── scripts.ts        # 脚本路由
│   ├── templates.ts      # 模板路由
│   ├── reports.ts        # 报告路由
│   └── conversations.ts  # 对话路由
├── services/
│   ├── userService.ts    # 用户服务
│   ├── scriptService.ts  # 脚本服务
│   └── reportService.ts  # 报告服务
└── utils/
    ├── db.ts             # 数据库操作
    ├── file.ts           # 文件操作
    └── logger.ts         # 日志工具
```

## 联系方式

如有安全问题或建议，请联系项目维护者。
