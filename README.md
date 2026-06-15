# 智能报告生成工具 - 本地部署版

## 系统架构

```
┌─────────────────┐      HTTP API      ┌─────────────────┐
│   React 前端     │ ◄────────────────► │  Node.js 后端   │
│  (Vite + TS)    │   localhost:5173   │  (Express)      │
│                 │                    │  localhost:3001 │
└─────────────────┘                    └────────┬────────┘
                                                 │
                    ┌────────────────────────────┼────────────────────────────┐
                    │                            │                            │
              ┌─────▼─────┐              ┌───────▼────────┐         ┌────────▼────────┐
              │  scripts/  │              │  uploads/      │         │  templates/     │
              │ (脚本目录)  │              │ (巡检文件)      │         │ (文档模板)      │
              └───────────┘              └────────────────┘         └─────────────────┘
```

## 本地启动步骤

### 1. 安装依赖

```bash
# 进入项目根目录
cd 智能报告生成工具

# 安装前端依赖
cd smart-report-tool
npm install

# 安装后端依赖（不需要安装，直接用 npx tsx 运行）
cd ../smart-report-server
# 后端零依赖，无需安装

# 安装同时启动工具（可选）
cd ..
npm install
```

### 2. 启动后端服务

```bash
cd smart-report-server
npx tsx watch src/index.ts
```

后端服务将启动在 `http://localhost:3001`

数据存储目录：`C:\Users\{用户名}\智能报告生成工具\`

### 3. 启动前端（新终端）

```bash
cd smart-report-tool
npx vite --port 5173
```

前端将启动在 `http://localhost:5173`

### 4. 使用系统

打开浏览器访问 `http://localhost:5173`

## 功能说明

### 后端能力
- **脚本管理**：接收上传的 Python/BAT/PowerShell/Shell 脚本，存储在本地文件系统
- **模板管理**：接收 docx/xlsx/md/pdf 模板上传
- **文件上传**：接收巡检数据文件（支持批量上传和压缩包）
- **脚本执行**：真实执行用户上传的脚本，使用 `child_process.spawn`
- **实时日志**：通过 SSE 流式返回脚本执行日志到前端
- **报告生成**：脚本输出 + 模板套用 → 生成最终报告文件
- **报告下载**：按格式下载生成的报告

### 数据存储
- 所有元数据存储在 `~/智能报告生成工具/db.json`
- 脚本文件：`~/智能报告生成工具/scripts/{scriptId}/`
- 模板文件：`~/智能报告生成工具/templates/{templateId}/`
- 巡检文件：`~/智能报告生成工具/uploads/`
- 生成报告：`~/智能报告生成工具/reports/{reportId}/`

### API 列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查 |
| GET | /api/scripts | 获取脚本列表 |
| POST | /api/scripts | 上传脚本（multipart） |
| DELETE | /api/scripts/:id | 删除脚本 |
| GET | /api/templates | 获取模板列表 |
| POST | /api/templates | 上传模板（multipart） |
| GET | /api/reports | 获取报告列表 |
| POST | /api/reports | 创建报告记录 |
| DELETE | /api/reports/:id | 删除报告 |
| POST | /api/reports/generate | 生成报告（SSE 流） |
| GET | /api/reports/:id/download | 下载报告 |

## 脚本执行流程

1. 前端上传巡检文件 → 后端存储到 `uploads/`
2. 前端选择脚本和模板 → 发送生成请求到后端
3. 后端创建临时工作目录 `reports/{reportId}/`
4. 后端将脚本、辅助文件、模板复制到工作目录
5. 后端将巡检文件映射到工作目录的 `input/` 子目录
6. 后端根据脚本类型选择执行命令：`python`/`bash`/`powershell` 等
7. 后端通过 SSE 实时推送执行日志到前端
8. 脚本执行完成后，后端根据输出格式生成报告文件
9. 前端下载生成的报告文件

## 环境要求

- Node.js 18+
- Python 3.x（如果要执行 Python 脚本）
- PowerShell（如果要执行 .ps1 脚本）
- Bash（如果在 Linux/Mac 上执行 .sh 脚本）
