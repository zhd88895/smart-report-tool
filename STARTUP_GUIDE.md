# 智能报告生成工具 - 启动指南

> **版本**: v0.4.0  
> **更新日期**: 2026-06-23

---

## 快速启动

### Windows 用户

**方式一：PowerShell（推荐）**
```powershell
.\start.ps1
```

**方式二：批处理**
```batch
start.bat
```

### Linux/Mac 用户

```bash
chmod +x start.sh
./start.sh
```

---

## 启动脚本说明

### start.ps1 / start.bat / start.sh

**功能：**
- ✅ 自动检查依赖（Node.js、npm包）
- ✅ 自动安装缺失的依赖
- ✅ 自动创建 `.env` 配置文件（如果不存在）
- ✅ 同时启动前端和后端服务
- ✅ 端口占用检测和警告
- ✅ 实时日志输出

**启动后访问：**
- 前端：http://localhost:5173
- 后端：http://localhost:3001
- 健康检查：http://localhost:3001/api/health

### stop.bat

**功能：**
- 停止前端和后端服务
- 清理占用的端口（3001、5173）

---

## 配置说明

### 环境变量配置

配置文件位于 `smart-report-server/.env`：

```env
# JWT签名密钥（必须修改！）
JWT_SECRET=your-secure-random-string-here

# 服务端口
PORT=3001

# 数据目录（相对于后端目录）
DATA_DIR=./data

# CORS配置
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

### 数据目录

所有数据文件存储在 `smart-report-server/data/` 目录下：

```
smart-report-server/
  └── data/                  # 数据根目录
      ├── db.json           # 数据库文件
      ├── scripts/          # 巡检脚本
      ├── templates/        # 报告模板
      ├── reports/          # 生成的报告
      ├── uploads/          # 上传的文件
      └── logs/             # 运行日志
```

---

## 首次使用

1. **启动服务**
   ```powershell
   # Windows
   .\start.ps1
   
   # Linux/Mac
   ./start.sh
   ```

2. **首次启动会自动：**
   - 安装依赖（如果缺失）
   - 创建 `.env` 配置文件
   - 创建数据目录

3. **修改配置（可选）：**
   - 编辑 `smart-report-server/.env` 文件
   - 修改 `JWT_SECRET` 为安全的随机字符串

4. **访问系统：**
   - 打开浏览器访问 http://localhost:5173
   - 使用默认管理员账号登录：ZHD / Aa123456

---

## 常见问题

### Q: 端口被占用怎么办？

**A:** 启动脚本会检测端口占用并提示。你也可以手动停止：
```batch
# Windows
stop.bat

# 或手动查找并终止进程
netstat -ano | findstr :3001
taskkill /PID <进程ID> /F
```

### Q: 依赖安装失败怎么办？

**A:** 手动安装依赖：
```bash
# 后端依赖
cd smart-report-server
npm install

# 前端依赖
cd smart-report-tool
npm install
```

### Q: 数据目录在哪里？

**A:** 默认在 `smart-report-server/data/` 目录下。可通过修改 `.env` 文件中的 `DATA_DIR` 配置更改。

### Q: 如何迁移项目？

**A:** 直接复制整个项目目录即可，数据文件会随项目一起迁移。确保：
1. 保留 `smart-report-server/data/` 目录
2. 保留 `.env` 配置文件
3. 在新环境重新安装依赖

---

## 目录结构

```
smart-report-tool/              # 前端项目
smart-report-server/            # 后端项目
  ├── src/                      # 源代码
  │   ├── index.ts             # 主入口
  │   ├── config.ts            # 配置管理
  │   ├── middleware/          # 中间件
  │   ├── routes/              # 路由
  │   ├── services/            # 业务逻辑
  │   └── utils/               # 工具函数
  ├── data/                    # 数据目录（自动创建）
  │   ├── db.json             # 数据库
  │   ├── scripts/            # 脚本
  │   ├── templates/          # 模板
  │   ├── reports/            # 报告
  │   └── logs/               # 日志
  ├── .env                     # 环境配置
  └── package.json
start.ps1                      # PowerShell启动脚本
start.bat                      # Windows启动脚本
start.sh                       # Linux/Mac启动脚本
stop.bat                       # Windows停止脚本
stop.ps1                       # PowerShell停止脚本
```

---

## 技术支持

如遇问题，请检查：
1. Node.js 版本 >= 18
2. 端口 3001 和 5173 未被占用
3. `.env` 文件配置正确
4. 依赖已安装（`node_modules` 目录存在）

---

**祝使用愉快！** 🎉
