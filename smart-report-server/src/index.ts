import http from 'http';
import fs from 'fs/promises';
import { existsSync, mkdirSync, createReadStream, createWriteStream } from 'fs';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { parse } from 'url';
import os from 'os';
import path from 'path';

const PORT = 3001;
const DATA_DIR = path.join(os.homedir(), '智能报告生成工具');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const SCRIPTS_DIR = path.join(DATA_DIR, 'scripts');
const TEMPLATES_DIR = path.join(DATA_DIR, 'templates');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Python virtual environment path (for script execution)
const VENV_PYTHON = path.join(os.homedir(), 'PycharmProjects', 'Windows巡检总结报告生成脚本', 'venv', 'Scripts', 'python.exe');

// Ensure directories exist
[UPLOADS_DIR, SCRIPTS_DIR, TEMPLATES_DIR, REPORTS_DIR].forEach((dir) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
});

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// JSON database helpers
async function readDB(): Promise<any> {
  try {
    const data = await fs.readFile(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { scripts: [], templates: [], reports: [], users: [] };
  }
}

async function writeDB(db: any): Promise<void> {
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

// 可打印的文本文件扩展名
function isTextExt(filename: string): boolean {
  const exts = ['.txt','.log','.csv','.json','.xml','.html','.htm','.md','.cfg','.conf','.ini','.yaml','.yml','.py','.sh','.bat','.ps1','.css','.js','.ts'];
  const lower = filename.toLowerCase();
  return exts.some((e) => lower.endsWith(e));
}

// 简易 TAR 解包 (Unix tar / ustar 格式)
async function extractTar(filePath: string, destDir: string, log: (s: string) => void): Promise<string[]> {
  const extracted: string[] = [];
  const buf = await fs.readFile(filePath);
  let offset = 0;

  while (offset + 512 <= buf.length) {
    const header = buf.slice(offset, offset + 512);

    // 读取文件名 (0–99 字节)
    const name0 = header.slice(0, 100);
    let nameEnd = name0.indexOf(0);
    if (nameEnd === -1) nameEnd = 100;
    const name = name0.slice(0, nameEnd).toString('utf-8').replace(/^\.\//, '').trim();

    // 空文件名块 => 结束
    if (!name) {
      // 检查是否全是 0（tarball 结束标记）
      const allZero = header.every((b: number) => b === 0);
      if (allZero) break;
      offset += 512;
      continue;
    }

    // 读取大小 (124–135 字节, 八进制字符串)
    const sizeRaw = header.slice(124, 136);
    let sizeEnd = sizeRaw.indexOf(0);
    if (sizeEnd === -1) sizeEnd = 12;
    const sizeStr = sizeRaw.slice(0, sizeEnd).toString('utf-8').trim();
    const fileSize = parseInt(sizeStr, 8);
    if (isNaN(fileSize) || fileSize < 0) {
      offset += 512;
      continue;
    }

    // 检查类型标志 (第 156 字节) — 0或'0'=普通文件, '5'=目录
    const typeflag = header[156];
    const contentTypeStart = offset + 512;
    const contentType = buf.slice(contentTypeStart, contentTypeStart + fileSize);

    if (typeflag === 0x35 || typeflag === 53) {
      // 目录
      const dirPath = path.join(destDir, name);
      if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
    } else if (typeflag === 0 || typeflag === 0x30 || typeflag === 48) {
      // 普通文件
      const outPath = path.join(destDir, name);
      const outDir = path.dirname(outPath);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      await fs.writeFile(outPath, contentType);
      extracted.push(name);
      log(`[解压] tar://${name} (${fileSize} 字节)`);
    }

    // 对齐到 512 字节边界
    offset += 512 + fileSize;
    if (offset % 512 !== 0) offset += 512 - (offset % 512);
  }

  return extracted;
}

// GZ 解压 (简易：只读 .gz 单文件)
async function extractGz(filePath: string, destDir: string, log: (s: string) => void): Promise<string[]> {
  const extracted: string[] = [];
  try {
    const { gunzipSync } = await import('zlib');
    const compressed = await fs.readFile(filePath);
    const decompressed = gunzipSync(compressed);
    const baseName = path.basename(filePath, '.gz');
    const outPath = path.join(destDir, baseName);
    await fs.writeFile(outPath, decompressed);
    extracted.push(baseName);
    log(`[解压] gz:${baseName} (${decompressed.length} 字节)`);
  } catch (e: any) {
    log(`[解压] GZ 解压失败: ${e.message}`);
  }
  return extracted;
}

// Multipart parser (lightweight, robust)
async function parseMultipart(req: http.IncomingMessage, uploadDir: string): Promise<{ fields: Record<string, string>; files: Record<string, { filename: string; path: string; size: number }> }> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const match = contentType.match(/boundary=([^;]+)/i);
    if (!match) return reject(new Error('No boundary in Content-Type: ' + contentType));
    const boundary = match[1].trim().replace(/^"|"$/g, '');
    const boundaryBuffer = Buffer.from(`--${boundary}`);
    const closingBoundaryBuffer = Buffer.from(`--${boundary}--`);

    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', (err) => reject(err));
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const fields: Record<string, string> = {};
        const files: Record<string, { filename: string; path: string; size: number }> = {};

        let start = buffer.indexOf(boundaryBuffer);
        while (start !== -1) {
          start += boundaryBuffer.length;

          if (buffer.slice(start, start + 2).toString() === '--') break;

          if (buffer.slice(start, start + 2).toString() === '\r\n') start += 2;

          let end = buffer.indexOf(boundaryBuffer, start);
          if (end === -1) {
            end = buffer.indexOf(closingBoundaryBuffer, start);
            if (end === -1) break;
          }

          const part = buffer.slice(start, end);
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) { start = end; continue; }

          const header = part.slice(0, headerEnd).toString();
          let body = part.slice(headerEnd + 4);

          if (body.length >= 2 && body.slice(body.length - 2).toString() === '\r\n') {
            body = body.slice(0, body.length - 2);
          }

          const nameMatch = header.match(/name="([^"]+)"/);
          const filenameMatch = header.match(/filename="([^"]+)"/);

          if (filenameMatch && nameMatch) {
            const filename = filenameMatch[1];
            const fileId = randomUUID();
            const ext = path.extname(filename);
            const destPath = path.join(uploadDir, `${fileId}${ext}`);
            await fs.writeFile(destPath, body);
            const stat = await fs.stat(destPath);
            files[nameMatch[1]] = { filename, path: destPath, size: stat.size };
          } else if (nameMatch) {
            fields[nameMatch[1]] = body.toString();
          }

          start = end;
        }
        resolve({ fields, files });
      } catch (e) { reject(e); }
    });
  });
}

// JSON body parser
async function parseJSON(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString();
        resolve(body ? JSON.parse(body) : {});
      } catch (e) { reject(e); }
    });
  });
}

function sendJSON(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendSSEHeaders(res: http.ServerResponse) {
  res.writeHead(200, {
    ...corsHeaders,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
}

// === ROUTES ===
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = parse(req.url || '', true);
  const method = req.method || '';

  console.log(`[${new Date().toISOString()}] ${method} ${url.pathname}`);

  try {
    if (url.pathname === '/api/health' && method === 'GET') {
      sendJSON(res, 200, { status: 'ok', dataDir: DATA_DIR, venvPython: existsSync(VENV_PYTHON) ? VENV_PYTHON : 'not found' });
      return;
    }

    // === SCRIPTS ===
    if (url.pathname === '/api/scripts' && method === 'GET') {
      const db = await readDB();
      sendJSON(res, 200, { scripts: db.scripts || [] });
      return;
    }

    if (url.pathname === '/api/scripts' && method === 'POST') {
      const { fields, files } = await parseMultipart(req, SCRIPTS_DIR);
      const scriptFile = files['scriptFile'];
      if (!scriptFile) { sendJSON(res, 400, { error: 'No script file' }); return; }

      const id = randomUUID();
      const scriptDir = path.join(SCRIPTS_DIR, id);
      mkdirSync(scriptDir, { recursive: true });
      const destPath = path.join(scriptDir, scriptFile.filename);
      await fs.rename(scriptFile.path, destPath);

      const auxFiles = [];
      let auxIdx = 0;
      while (files[`auxFile${auxIdx}`]) {
        const af = files[`auxFile${auxIdx}`];
        const auxPath = path.join(scriptDir, 'aux', af.filename);
        mkdirSync(path.dirname(auxPath), { recursive: true });
        await fs.rename(af.path, auxPath);
        auxFiles.push({ name: af.filename, size: af.size, path: auxPath });
        auxIdx++;
      }

      const script = {
        id,
        name: fields.name || scriptFile.filename,
        description: fields.description || '',
        scriptType: fields.scriptType || 'python',
        version: fields.version || '1.0',
        category: fields.category || 'host',
        fileName: scriptFile.filename,
        filePath: destPath,
        fileSize: scriptFile.size,
        templateRequired: fields.templateRequired === 'true',
        templateIds: fields.templateIds ? JSON.parse(fields.templateIds) : [],
        auxiliaryFiles: auxFiles,
        requirements: fields.requirements ? JSON.parse(fields.requirements) : [],
        uploadedAt: new Date().toISOString(),
        uploadedBy: fields.uploadedBy || 'unknown',
      };

      const db = await readDB();
      db.scripts = db.scripts || [];
      db.scripts.push(script);
      await writeDB(db);
      sendJSON(res, 201, script);
      return;
    }

    if (url.pathname?.startsWith('/api/scripts/') && method === 'DELETE') {
      const id = url.pathname.split('/')[3];
      const db = await readDB();
      db.scripts = (db.scripts || []).filter((s: any) => s.id !== id);
      await writeDB(db);
      const scriptDir = path.join(SCRIPTS_DIR, id);
      if (existsSync(scriptDir)) {
        await fs.rm(scriptDir, { recursive: true, force: true });
      }
      sendJSON(res, 200, { success: true });
      return;
    }

    // === TEMPLATES ===
    if (url.pathname === '/api/templates' && method === 'GET') {
      const db = await readDB();
      sendJSON(res, 200, { templates: db.templates || [] });
      return;
    }

    if (url.pathname === '/api/templates' && method === 'POST') {
      const { fields, files } = await parseMultipart(req, TEMPLATES_DIR);
      const templateFile = files['templateFile'];
      if (!templateFile) { sendJSON(res, 400, { error: 'No template file' }); return; }

      const id = randomUUID();
      const templateDir = path.join(TEMPLATES_DIR, id);
      mkdirSync(templateDir, { recursive: true });
      const destPath = path.join(templateDir, templateFile.filename);
      await fs.rename(templateFile.path, destPath);

      const template = {
        id,
        name: fields.name || templateFile.filename,
        description: fields.description || '',
        fileType: fields.fileType || 'docx',
        fileName: templateFile.filename,
        filePath: destPath,
        fileSize: templateFile.size,
        compatibleScriptType: fields.compatibleScriptType || 'python',
        uploadedAt: new Date().toISOString(),
      };

      const db = await readDB();
      db.templates = db.templates || [];
      db.templates.push(template);
      await writeDB(db);
      sendJSON(res, 201, template);
      return;
    }

    if (url.pathname?.startsWith('/api/templates/') && method === 'DELETE') {
      const id = url.pathname.split('/')[3];
      const db = await readDB();
      db.templates = (db.templates || []).filter((t: any) => t.id !== id);
      await writeDB(db);
      // Clean up directory
      const templateDir = path.join(TEMPLATES_DIR, id);
      if (existsSync(templateDir)) {
        await fs.rm(templateDir, { recursive: true, force: true });
      }
      sendJSON(res, 200, { success: true });
      return;
    }

    // === REPORTS ===
    if (url.pathname === '/api/reports' && method === 'GET') {
      const db = await readDB();
      sendJSON(res, 200, { reports: db.reports || [] });
      return;
    }

    if (url.pathname === '/api/reports' && method === 'POST') {
      const body = await parseJSON(req);
      const report = {
        id: randomUUID(),
        ...body,
        createdAt: new Date().toISOString(),
      };
      const db = await readDB();
      db.reports = db.reports || [];
      db.reports.push(report);
      await writeDB(db);
      sendJSON(res, 201, report);
      return;
    }

    if (url.pathname?.startsWith('/api/reports/') && method === 'DELETE') {
      const id = url.pathname.split('/')[3];
      const db = await readDB();
      db.reports = (db.reports || []).filter((r: any) => r.id !== id);
      await writeDB(db);
      sendJSON(res, 200, { success: true });
      return;
    }

    // === GENERATE REPORT (with SSE logs) ===
    if (url.pathname === '/api/reports/generate' && method === 'POST') {
      try {
      const { fields, files } = await parseMultipart(req, UPLOADS_DIR);
      const scriptId = fields.scriptId;
      const templateId = fields.templateId || '';
      const outputFormat = fields.outputFormat || 'html';
      const reportInfo = fields.reportInfo ? JSON.parse(fields.reportInfo) : {};

      const db = await readDB();
      let script = (db.scripts || []).find((s: any) => s.id === scriptId);
      let template = (db.templates || []).find((t: any) => t.id === templateId);

      // 如果 db.json 中找不到，尝试从文件系统读取脚本
      if (!script) {
        const scriptDir = path.join(SCRIPTS_DIR, scriptId);
        if (existsSync(scriptDir)) {
          const files = await fs.readdir(scriptDir);
          const pyFile = files.find((f: string) => f.endsWith('.py') || f.endsWith('.sh') || f.endsWith('.bat') || f.endsWith('.ps1'));
          if (pyFile) {
            const stat = await fs.stat(path.join(scriptDir, pyFile));
            // 重建脚本信息
            script = {
              id: scriptId,
              name: pyFile,
              description: '',
              scriptType: pyFile.endsWith('.py') ? 'python' : pyFile.endsWith('.bat') ? 'bat' : pyFile.endsWith('.ps1') ? 'ps1' : 'sh',
              version: '1.0',
              category: 'host',
              fileName: pyFile,
              filePath: path.join(scriptDir, pyFile),
              fileSize: stat.size,
              templateRequired: false,
              templateIds: [],
              auxiliaryFiles: [],
              requirements: [],
              uploadedAt: new Date().toISOString(),
              uploadedBy: 'system',
            };
            // 同时把辅助文件目录也读出来
            const auxDir = path.join(scriptDir, 'aux');
            if (existsSync(auxDir)) {
              const auxEntries = await fs.readdir(auxDir);
              for (const ae of auxEntries) {
                const ap = path.join(auxDir, ae);
                const as = await fs.stat(ap).catch(() => null);
                if (as && as.isFile()) {
                  script.auxiliaryFiles.push({ name: ae, size: as.size, path: ap });
                }
              }
            }
          }
        }
      }

      if (!script) { sendJSON(res, 400, { error: 'Script not found' }); return; }

      // 同样为模板添加文件系统回退
      if (!template && templateId) {
        const templateDir = path.join(TEMPLATES_DIR, templateId);
        if (existsSync(templateDir)) {
          const tplFiles = await fs.readdir(templateDir);
          const tplFile = tplFiles.find((f: string) => f.endsWith('.docx') || f.endsWith('.xlsx') || f.endsWith('.md') || f.endsWith('.pdf'));
          if (tplFile) {
            const stat = await fs.stat(path.join(templateDir, tplFile));
            template = {
              id: templateId,
              name: tplFile,
              description: '',
              fileType: tplFile.endsWith('.docx') ? 'docx' : tplFile.endsWith('.xlsx') ? 'xlsx' : tplFile.endsWith('.md') ? 'md' : 'pdf',
              fileName: tplFile,
              filePath: path.join(templateDir, tplFile),
              fileSize: stat.size,
              compatibleScriptType: 'python',
              uploadedAt: new Date().toISOString(),
            };
          }
        }
      }

      // 验证模板文件确实存在
      if (template && !existsSync(template.filePath)) {
        // 模板记录存在但文件丢失，尝试从同名文件找
        const tplDir = path.join(TEMPLATES_DIR, templateId || '');
        if (existsSync(tplDir)) {
          const tplFiles = await fs.readdir(tplDir);
          const altFile = tplFiles.find((f: string) => f === template.fileName);
          if (altFile) {
            template.filePath = path.join(tplDir, altFile);
          } else if (tplFiles.length > 0) {
            template.filePath = path.join(tplDir, tplFiles[0]);
            template.fileName = tplFiles[0];
          }
        }
      }

      const reportId = randomUUID();
      const workspaceDir = path.join(REPORTS_DIR, reportId);
      mkdirSync(workspaceDir, { recursive: true });

      const allFiles: string[] = [];

      // Copy script
      await fs.copyFile(script.filePath, path.join(workspaceDir, script.fileName));
      allFiles.push(script.fileName);

      // Copy auxiliary files (flat)
      if (script.auxiliaryFiles && script.auxiliaryFiles.length > 0) {
        for (const af of script.auxiliaryFiles) {
          await fs.copyFile(af.path, path.join(workspaceDir, af.name));
          allFiles.push(af.name);
        }
      }

      // Copy template if exists (flat)
      if (template) {
        await fs.copyFile(template.filePath, path.join(workspaceDir, template.fileName));
        allFiles.push(template.fileName);
      }

      // Copy input files from multipart (flat)
      const inputFileNames: string[] = [];
      let idx = 0;
      while (files[`inputFile${idx}`]) {
        const f = files[`inputFile${idx}`];
        await fs.copyFile(f.path, path.join(workspaceDir, f.filename));
        allFiles.push(f.filename);
        inputFileNames.push(f.filename);
        idx++;
      }

      // --- SSE 初始化 + 日志辅助函数 ---
      sendSSEHeaders(res);
      const logLines: string[] = [];
      const logFilePath = path.join(workspaceDir, 'execution.log');
      const sendLog = (msg: string) => {
        logLines.push(msg);
        res.write(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`);
      };

      sendLog('========================================');
      sendLog('开始生成报告...');
      sendLog(`报告名称: ${reportInfo?.name || '未命名'}`);
      sendLog(`处理脚本: ${script.name}`);
      sendLog(`脚本类型: ${script.scriptType}`);
      sendLog(`输出格式: ${outputFormat || 'html'}`);
      sendLog(`模板: ${template ? template.fileName + ' (' + (existsSync(template.filePath) ? '已找到' : '文件缺失!') + ')' : '无'}`);
      sendLog(`Python解释器: ${existsSync(VENV_PYTHON) ? '虚拟环境 (' + VENV_PYTHON + ')' : '系统Python'}`);
      sendLog(`工作目录: ${workspaceDir}`);
      sendLog('工作目录内文件:');
      for (const fn of allFiles) sendLog(`  - ${fn}`);
      sendLog('========================================');

      // === 解压压缩包 ===
      for (const fn of [...inputFileNames]) {
        const filePath = path.join(workspaceDir, fn);
        const ext = fn.split('.').pop()?.toLowerCase() || '';

        if (ext === 'tar') {
          sendLog('');
          sendLog(`[解压] 检测到 tar 压缩包: ${fn}，开始解压...`);
          try {
            const entries = await extractTar(filePath, workspaceDir, sendLog);
            for (const e of entries) {
              allFiles.push(e);
              inputFileNames.push(e);
            }
            sendLog(`[解压] tar 解压完成，共 ${entries.length} 个文件`);
          } catch (e: any) {
            sendLog(`[解压] tar 解压失败: ${e.message}`);
          }
        } else if (ext === 'gz' || ext === 'tgz') {
          sendLog('');
          sendLog(`[解压] 检测到 gz 压缩包: ${fn}，开始解压...`);
          try {
            const entries = await extractGz(filePath, workspaceDir, sendLog);
            for (const e of entries) {
              allFiles.push(e);
              inputFileNames.push(e);
            }
            sendLog(`[解压] gz 解压完成，共 ${entries.length} 个文件`);
          } catch (e: any) {
            sendLog(`[解压] gz 解压失败: ${e.message}`);
          }
        }
      }

      // 设置 UTF-8 编码环境变量，修复中文乱码
      const spawnEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', LANG: 'zh_CN.UTF-8' };

      // 确认 Python 命令 — 使用虚拟环境的 Python
      const pythonCmd = existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python';

      // === 检查并安装 Python 依赖 ===
      // 优先使用前端传入的 requirements，其次使用数据库中脚本的 requirements
      const formRequirements: string[] = fields.requirements ? JSON.parse(fields.requirements) : [];
      const requirements: string[] = formRequirements.length > 0 ? formRequirements : (script.requirements || []);
      if (script.scriptType === 'python' && requirements.length > 0) {
        sendLog('');
        sendLog('========================================');
        sendLog('[环境检查] 开始检查 Python 依赖包...');
        sendLog(`[环境检查] 需要 ${requirements.length} 个包: ${requirements.join(', ')}`);
        sendLog(`[环境检查] 来源: ${formRequirements.length > 0 ? '前端传入' : '脚本数据库记录'}`);

        const pipCmd = path.join(path.dirname(pythonCmd), 'pip3.exe');
        const pipPath = existsSync(pipCmd) ? pipCmd
          : existsSync(pythonCmd.replace('python.exe', 'pip.exe')) ? pythonCmd.replace('python.exe', 'pip.exe')
          : `${pythonCmd} -m pip`;

        try {
          // 1. pip list 获取已安装包
          sendLog('[环境检查] 查询已安装的包...');
          const pipListArgs = pipPath.endsWith('.exe') ? ['list', '--format=json'] : ['-m', 'pip', 'list', '--format=json'];
          const pipExe = pipPath.endsWith('.exe') ? pipPath : pythonCmd;
          const installed = await new Promise<Set<string>>((resolve, reject) => {
            const p = spawn(pipExe, pipListArgs, { env: spawnEnv, stdio: ['pipe', 'pipe', 'pipe'] });
            let out = '';
            p.stdout.on('data', (d) => { out += d.toString('utf-8'); });
            p.stderr.on('data', (d) => { out += d.toString('utf-8'); });
            p.on('close', (c) => {
              try {
                const list = JSON.parse(out);
                resolve(new Set<string>(list.map((pkg: any) => pkg.name.toLowerCase())));
              } catch {
                // fallback: parse text format
                const names = new Set<string>();
                out.split('\n').forEach((line) => {
                  const m = line.match(/^(\S+)\s+/);
                  if (m) names.add(m[1].toLowerCase());
                });
                resolve(names);
              }
            });
            p.on('error', reject);
          });

          // 2. 找出缺失的包
          const missing: string[] = [];
          for (const req of requirements) {
            const pkgName = req.replace(/[<>=!~].*$/, '').trim().toLowerCase();
            if (!installed.has(pkgName)) {
              missing.push(req);
              sendLog(`[环境检查] 缺少: ${req}`);
            } else {
              sendLog(`[环境检查] 已安装: ${req}`);
            }
          }

          // 3. 安装缺失的包
          if (missing.length > 0) {
            sendLog('');
            sendLog(`[环境安装] 开始安装 ${missing.length} 个缺失的包...`);
            const installArgs = pipPath.endsWith('.exe') ? ['install', ...missing] : ['-m', 'pip', 'install', ...missing];
            const installResult = await new Promise<{code: number; out: string}>((resolve, reject) => {
              const p = spawn(pipExe, installArgs, { env: spawnEnv, stdio: ['pipe', 'pipe', 'pipe'] });
              let out = '';
              p.stdout.on('data', (d) => {
                const t = d.toString('utf-8');
                out += t;
                t.split('\n').forEach((l: string) => { if (l.trim()) sendLog(`[环境安装] ${l.trim()}`); });
              });
              p.stderr.on('data', (d) => {
                const t = d.toString('utf-8');
                out += t;
                t.split('\n').forEach((l: string) => { if (l.trim()) sendLog(`[环境安装] ${l.trim()}`); });
              });
              p.on('close', (c) => resolve({ code: c, out }));
              p.on('error', reject);
            });

            if (installResult.code === 0) {
              sendLog('[环境安装] 安装完成！');
            } else {
              sendLog(`[环境安装] 安装过程返回非零退出码: ${installResult.code}，部分包可能安装失败`);
            }
          } else {
            sendLog('[环境检查] 所有依赖包已就绪，无需安装');
          }
        } catch (e: any) {
          sendLog(`[环境检查] 出错: ${e.message}`);
        }
        sendLog('========================================');
        sendLog('');
      } else if (script.scriptType === 'python') {
        sendLog('');
        sendLog('[环境检查] 该脚本未配置依赖包，跳过环境检查');
        sendLog(`[环境检查] 调试: formRequirements=${formRequirements.length} 条, dbRequirements=${(script.requirements || []).length} 条`);
      }

      // 确认命令
      const commandMap: Record<string, string> = {
        python: pythonCmd,
        bat: 'cmd',
        ps1: 'powershell',
        sh: 'bash',
        powershell: 'pwsh',
      };
      const cmd = commandMap[script.scriptType] || pythonCmd;
      const args: string[] = script.scriptType === 'bat' ? ['/c', script.fileName]
        : script.scriptType === 'ps1' ? ['-File', script.fileName]
        : script.scriptType === 'powershell' ? ['-File', script.fileName]
        : [script.fileName];

      sendLog('');
      sendLog(`[执行] ${cmd} ${args.join(' ')}`);
      sendLog(`[工作目录] ${workspaceDir}`);
      sendLog(`[Python路径] ${pythonCmd}`);
      sendLog(`[环境] PYTHONIOENCODING=utf-8`);

      // 记录脚本运行前工作目录中的文件（用于提取脚本生成的报告文件）
      const filesBefore = new Set(await fs.readdir(workspaceDir).catch(() => []));

      const child = spawn(cmd, args, {
        cwd: workspaceDir,
        shell: script.scriptType === 'bat' || script.scriptType === 'ps1',
        env: spawnEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // 自动处理脚本中的 input() 等交互：输出停止 3 秒后自动发送回车
      let inputTimer: ReturnType<typeof setTimeout> | null = null;
      const resetInputTimer = () => {
        if (inputTimer) clearTimeout(inputTimer);
        inputTimer = setTimeout(() => {
          if (child.stdin && !child.stdin.destroyed) {
            sendLog('[系统] 自动发送回车以结束脚本交互等待...');
            child.stdin.write('\n');
          }
        }, 3000);
      };

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const text = Buffer.from(data).toString('utf-8');
        stdout += text;
        text.split('\n').forEach((line: string) => {
          const trimmed = line.trim();
          if (trimmed) sendLog(`[OUT] ${trimmed}`);
        });
        resetInputTimer();
      });

      child.stderr.on('data', (data) => {
        const text = Buffer.from(data).toString('utf-8');
        stderr += text;
        text.split('\n').forEach((line: string) => {
          const trimmed = line.trim();
          if (trimmed) sendLog(`[LOG] ${trimmed}`);
        });
        resetInputTimer();
      });

      child.on('close', async (code) => {
        if (inputTimer) clearTimeout(inputTimer);
        sendLog('');
        sendLog(`[完成] 脚本退出码: ${code}`);

        // diff 工作目录，找出脚本生成的新文件
        const filesAfter = await fs.readdir(workspaceDir).catch(() => []);
        const ext = outputFormat || 'docx';
        let newFiles = filesAfter.filter((f) => !filesBefore.has(f));
        sendLog(`[扫描] 工作目录新增文件: ${newFiles.length > 0 ? newFiles.join(', ') : '(无)'}`);

        // 按输出格式筛选报告文件
        const reportCandidates = newFiles.filter((f) => f.endsWith('.' + ext));
        if (reportCandidates.length === 0) {
          // 尝试在所有文件中按格式查找
          reportCandidates.push(...filesAfter.filter((f) => f.endsWith('.' + ext) && !f.startsWith('.')));
        }

        let reportFilePath = '';
        const reportName = reportInfo?.name || 'report';

        if (reportCandidates.length > 0) {
          reportFilePath = path.join(workspaceDir, reportCandidates[0]);
          sendLog(`[报告] 自动识别报告文件: ${reportCandidates[0]}`);
        } else {
          // 降级：生成一个简单的占位报告
          sendLog(`[报告] 未找到 .${ext} 文件，生成默认报告`);
          reportFilePath = path.join(workspaceDir, `${reportName}.html`);
          const generatedContent = buildHtmlReport(reportInfo, script, template, inputFileNames.map((n) => ({ name: n })), stdout);
          await fs.writeFile(reportFilePath, generatedContent);
        }

        await fs.writeFile(logFilePath, logLines.join('\n'));

        // 状态判定：有报告文件产出即视为成功
        const hasReportFile = reportFilePath && existsSync(reportFilePath);
        const isSuccess = code === 0 || hasReportFile;

        sendLog(`[生成] 报告文件: ${reportFilePath}`);
        sendLog(`[日志] 执行日志已保存: ${logFilePath}`);
        sendLog('');
        sendLog('========================================');
        sendLog(`报告生成${isSuccess ? '完成' : '失败'}！`);
        sendLog('========================================');

        const reportRecord = {
          id: reportId,
          name: reportInfo?.name || '未命名',
          type: reportInfo?.category || 'host',
          date: reportInfo?.date || new Date().toISOString().split('T')[0],
          author: reportInfo?.author || '未知',
          scriptId,
          scriptName: script.name,
          templateId,
          outputFormat: outputFormat || ext,
          status: isSuccess ? 'success' : 'error',
          filePath: reportFilePath,
          workspaceDir,
          logFilePath,
          createdAt: new Date().toISOString(),
        };

        db.reports = db.reports || [];
        db.reports.push(reportRecord);
        await writeDB(db);

        res.write(`data: ${JSON.stringify({ type: 'complete', report: reportRecord })}\n\n`);
        res.end();
      });

      return;
      } catch (genErr: any) {
        // If headers already sent (SSE started), log and end silently
        console.error('Generate endpoint error:', genErr);
        if (!res.headersSent) {
          sendJSON(res, 500, { error: genErr.message || 'Internal error during generation' });
        }
        try { res.end(); } catch {}
        return;
      }
    }

    // === GET REPORT LOGS ===
    if (url.pathname?.startsWith('/api/reports/') && url.pathname.endsWith('/logs') && method === 'GET') {
      const parts = url.pathname.split('/');
      const id = parts[3];
      const db = await readDB();
      const report = (db.reports || []).find((r: any) => r.id === id);
      if (!report) { sendJSON(res, 404, { error: 'Report not found' }); return; }
      if (!existsSync(report.logFilePath)) { sendJSON(res, 404, { error: 'Log file not found' }); return; }
      const content = await fs.readFile(report.logFilePath, 'utf-8');
      sendJSON(res, 200, { reportId: id, logs: content.split('\n') });
      return;
    }

    // === DOWNLOAD REPORT ===
    if (url.pathname?.startsWith('/api/reports/') && url.pathname.endsWith('/download') && method === 'GET') {
      const parts = url.pathname.split('/');
      const id = parts[3];
      const db = await readDB();
      const report = (db.reports || []).find((r: any) => r.id === id);
      if (!report || !existsSync(report.filePath)) {
        sendJSON(res, 404, { error: 'Report not found' });
        return;
      }

      const ext = path.extname(report.filePath);
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.md': 'text/markdown',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.pdf': 'application/pdf',
      };

      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(report.name)}${ext}"`,
      });
      createReadStream(report.filePath).pipe(res);
      return;
    }

    // === USERS ===
    if (url.pathname === '/api/users' && method === 'GET') {
      const db = await readDB();
      sendJSON(res, 200, { users: db.users || [] });
      return;
    }

    sendJSON(res, 404, { error: 'Not found' });

  } catch (err: any) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      sendJSON(res, 500, { error: err.message || 'Internal server error' });
    } else {
      try { res.end(); } catch {}
    }
  }
});

function buildHtmlReport(info: any, script: any, template: any, inputFiles: any[], stdout: string): string {
  const inputList = (inputFiles || []).map((f: any) => `<li>${f.name}</li>`).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${info?.name || '报告'}</title>
<style>body{font-family:-apple-system,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#333}
h1{border-bottom:2px solid #3b82f6;padding-bottom:8px}
.section{margin:24px 0}pre{background:#f3f4f6;padding:12px;border-radius:6px;overflow:auto}
ul{margin:8px 0;padding-left:20px}</style></head><body>
<h1>${info?.name || '报告'}</h1>
<div class="section"><strong>作者：</strong>${info?.author || '-'} | <strong>日期：</strong>${info?.date || '-'}</div>
<div class="section"><strong>处理脚本：</strong>${script?.name || '-'}</div>
<div class="section"><h2>巡检文件</h2><ul>${inputList}</ul></div>
<div class="section"><h2>脚本输出</h2><pre>${stdout || '(无输出)'}</pre></div>
</body></html>`;
}

function buildMdReport(info: any, script: any, template: any, inputFiles: any[], stdout: string): string {
  const inputList = (inputFiles || []).map((f: any) => `- ${f.name}`).join('\n');
  return `# ${info?.name || '报告'}

**作者：** ${info?.author || '-'} | **日期：** ${info?.date || '-'}

**处理脚本：** ${script?.name || '-'}

## 巡检文件

${inputList}

## 脚本输出

\`\`\`
${stdout || '(无输出)'}
\`\`\`
`;
}

server.listen(PORT, () => {
  console.log('========================================');
  console.log('智能报告生成工具后端服务已启动');
  console.log(`地址: http://localhost:${PORT}`);
  console.log(`数据目录: ${DATA_DIR}`);
  console.log(`Python路径: ${existsSync(VENV_PYTHON) ? VENV_PYTHON : '系统Python（虚拟环境未找到）'}`);
  console.log('========================================');
});
