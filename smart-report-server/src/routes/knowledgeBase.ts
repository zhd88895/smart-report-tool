/**
 * 知识库路由模块
 *
 * 提供：
 *  1. 分类 CRUD
 *  2. 文件上传与解析（MD/HTML/Word/PDF/TXT）
 *  3. 文件列表、搜索、删除
 *  4. 批量获取文件内容（供 AI 分析使用）
 *
 * @module routes/knowledgeBase
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { knowledgeBaseRepository, KBCategory, KBFile } from '../db/repositories/knowledgeBaseRepository';
import { ApiResponse } from '../types';
import { getLogger, generateTraceId } from '../utils/logger';
import { getConfig } from '../config';
import { settingsService } from '../services/settingsService';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';

const log = getLogger('KnowledgeBaseRoutes', 'other');
const router = Router();

/**
 * 修复 multer/busboy 对 multipart 文件名的 latin1 误解码问题
 * 浏览器按 UTF-8 发送中文文件名，busboy 默认按 latin1 解码会产生乱码（如 H3Cæœ...）
 * 检测：转回 latin1 字节再按 UTF-8 解码，若无替换字符且含中文则说明原本是乱码，返回修复值
 */
function decodeOriginalName(name: string): string {
  if (!name) return name;
  // 已含正常中文或不含高位字符，直接返回
  if (/[一-鿿]/.test(name) || !/[-ÿ]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

// ═══════════════════════════════════════════════════════
//  文件上传配置
// ═══════════════════════════════════════════════════════

const DATA_DIR = getConfig().DATA_DIR;
const KB_UPLOAD_DIR = path.join(DATA_DIR, 'knowledge-base');

if (!existsSync(KB_UPLOAD_DIR)) {
  mkdirSync(KB_UPLOAD_DIR, { recursive: true });
}

const ALLOWED_EXTS = new Set(['.md', '.markdown', '.html', '.htm', '.docx', '.doc', '.pdf', '.txt', '.text']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, KB_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}_${randomUUID().substring(0, 8)}${ext}`;
    cb(null, safeName);
  },
});

// multer 的 fileSize 只能静态设置，这里缓存实例并在设置变化时重建，
// 使 storage.uploadLimit 系统设置（MB）调整后可即时生效
let cachedLimitMB = -1;
let cachedUpload: multer.Multer | null = null;

function getUpload(): multer.Multer {
  const limitMB = settingsService.getNumber('storage.uploadLimit', 50);
  if (!cachedUpload || cachedLimitMB !== limitMB) {
    cachedUpload = multer({
      storage,
      limits: { fileSize: limitMB * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_EXTS.has(ext)) {
          cb(null, true);
        } else {
          cb(new Error(`不支持的文件格式: ${ext}。支持: MD, HTML, Word, PDF, TXT`));
        }
      },
    });
    cachedLimitMB = limitMB;
  }
  return cachedUpload;
}

// ═══════════════════════════════════════════════════════
//  文件解析
// ═══════════════════════════════════════════════════════

async function parseFile(filePath: string, ext: string, originalName: string): Promise<{ content: string; error?: string }> {
  try {
    switch (ext) {
      case '.txt':
      case '.text':
      case '.md':
      case '.markdown': {
        const content = await fs.readFile(filePath, 'utf-8');
        return { content };
      }
      case '.html':
      case '.htm': {
        const raw = await fs.readFile(filePath, 'utf-8');
        // 简易 HTML → 文本：去标签
        const text = raw
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ')
          .trim();
        return { content: text };
      }
      case '.pdf': {
        // pdf-parse v2 API：PDFParse 类 + getText()
        try {
          const mod: any = await import('pdf-parse' as any);
          const PDFParse = mod.PDFParse ?? mod.default?.PDFParse ?? mod.default;
          const dataBuffer = await fs.readFile(filePath);
          const parser = new PDFParse({ data: dataBuffer });
          try {
            const result = await parser.getText();
            return { content: result.text || '' };
          } finally {
            await parser.destroy().catch(() => {});
          }
        } catch (err: any) {
          return { content: '', error: `PDF 解析失败: ${err.message}` };
        }
      }
      case '.docx': {
        // DOCX 需要外部库，尝试动态加载 mammoth
        try {
          const mod: any = await import('mammoth' as any);
          const mammoth = mod.default ?? mod;
          const result = await mammoth.extractRawText({ path: filePath });
          return { content: result.value || '' };
        } catch (err: any) {
          return { content: '', error: `DOCX 解析失败: ${err.message}` };
        }
      }
      case '.doc': {
        // 旧版 .doc 格式无法在 Node 端可靠解析
        return { content: '', error: '旧版 .doc 格式暂不支持自动解析，请转换为 .docx 或 .txt 后重新上传。' };
      }
      default:
        return { content: '', error: `不支持的文件格式: ${ext}` };
    }
  } catch (err: any) {
    return { content: '', error: `文件解析失败: ${err.message}` };
  }
}

// ═══════════════════════════════════════════════════════
//  分类路由
// ═══════════════════════════════════════════════════════

// 获取所有分类
router.get('/categories', authenticate, async (_req: Request, res: Response) => {
  try {
    const categories = await knowledgeBaseRepository.findAllCategories();
    // 附加文件计数
    const result = await Promise.all(
      categories.map(async (cat) => ({
        ...cat,
        file_count: await knowledgeBaseRepository.countFilesByCategory(cat.id),
      }))
    );
    res.json({ code: 200, data: result, message: '获取成功' } as ApiResponse<any>);
  } catch (err: any) {
    res.status(500).json({ code: 500, data: null, message: '获取分类失败', error: err.message } as ApiResponse<null>);
  }
});

// 创建分类
router.post('/categories', authenticate, async (req: Request, res: Response) => {
  const { name, description, color, sort_order } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ code: 400, data: null, message: '分类名称不能为空' } as ApiResponse<null>);
    return;
  }
  try {
    const cat = await knowledgeBaseRepository.createCategory({
      name: name.trim(),
      description: description || '',
      color: color || 'blue',
      sort_order: sort_order || 0,
    });
    res.json({ code: 200, data: cat, message: '分类创建成功' } as ApiResponse<any>);
  } catch (err: any) {
    res.status(500).json({ code: 500, data: null, message: '创建分类失败', error: err.message } as ApiResponse<null>);
  }
});

// 更新分类
router.put('/categories/:id', authenticate, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { name, description, color, sort_order } = req.body;
  try {
    await knowledgeBaseRepository.updateCategory(id, { name, description, color, sort_order });
    res.json({ code: 200, data: null, message: '分类更新成功' } as ApiResponse<null>);
  } catch (err: any) {
    res.status(500).json({ code: 500, data: null, message: '更新分类失败', error: err.message } as ApiResponse<null>);
  }
});

// 删除分类
router.delete('/categories/:id', authenticate, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    await knowledgeBaseRepository.deleteCategory(id);
    res.json({ code: 200, data: null, message: '分类删除成功' } as ApiResponse<null>);
  } catch (err: any) {
    res.status(500).json({ code: 500, data: null, message: '删除分类失败', error: err.message } as ApiResponse<null>);
  }
});

// ═══════════════════════════════════════════════════════
//  文件路由
// ═══════════════════════════════════════════════════════

// 获取文件列表
router.get('/files', authenticate, async (req: Request, res: Response) => {
  const categoryId = req.query.categoryId as string | undefined;
  try {
    const files = await knowledgeBaseRepository.findAllFiles(categoryId);
    // 不返回 content 字段（避免大响应）
    const result = files.map((f: KBFile) => ({
      id: f.id,
      category_id: f.category_id,
      title: f.title,
      file_name: f.file_name,
      file_size: f.file_size,
      file_type: f.file_type,
      file_ext: f.file_ext,
      content_length: f.content_length,
      status: f.status,
      error_message: f.error_message,
      uploaded_by: f.uploaded_by,
      created_at: f.created_at,
      updated_at: f.updated_at,
    }));
    res.json({ code: 200, data: result, message: '获取成功' } as ApiResponse<any>);
  } catch (err: any) {
    res.status(500).json({ code: 500, data: null, message: '获取文件列表失败', error: err.message } as ApiResponse<null>);
  }
});

// 搜索文件
router.get('/files/search', authenticate, async (req: Request, res: Response) => {
  const query = req.query.q as string;
  if (!query?.trim()) {
    res.json({ code: 200, data: [], message: '搜索关键词为空' } as ApiResponse<any>);
    return;
  }
  try {
    const files = await knowledgeBaseRepository.searchFiles(query.trim());
    const result = files.map((f: KBFile) => ({
      id: f.id,
      category_id: f.category_id,
      title: f.title,
      file_name: f.file_name,
      file_size: f.file_size,
      file_ext: f.file_ext,
      content_length: f.content_length,
      status: f.status,
      created_at: f.created_at,
    }));
    res.json({ code: 200, data: result, message: `找到 ${result.length} 个结果` } as ApiResponse<any>);
  } catch (err: any) {
    res.status(500).json({ code: 500, data: null, message: '搜索失败', error: err.message } as ApiResponse<null>);
  }
});

// 上传文件
router.post('/files/upload', authenticate, (req: Request, res: Response, next: NextFunction) => getUpload().single('file')(req, res, next), async (req: Request, res: Response) => {
  const traceId = generateTraceId();
  const file = req.file;
  const { categoryId, title } = req.body;

  if (!file) {
    res.status(400).json({ code: 400, data: null, message: '请选择要上传的文件' } as ApiResponse<null>);
    return;
  }

  const originalName = decodeOriginalName(file.originalname);
  const ext = path.extname(originalName).toLowerCase();
  const fileType = ext.replace('.', '');
  const fileTitle = title?.trim() || path.parse(originalName).name;

  log.info(`上传知识库文件: ${originalName} (${ext})`, traceId);

  try {
    // 解析文件内容
    const { content, error } = await parseFile(file.path, ext, originalName);
    const status = error ? 'error' : 'ready';

    const kbFile = await knowledgeBaseRepository.createFile({
      category_id: categoryId || null,
      title: fileTitle,
      file_name: originalName,
      file_path: file.path,
      file_size: file.size,
      file_type: fileType,
      file_ext: ext,
      content,
      content_length: content.length,
      status,
      error_message: error || undefined,
      uploaded_by: (req as any).user?.username,
    });

    const msg = error
      ? `文件已保存，但解析出现问题: ${error}`
      : '文件上传并解析成功';

    res.json({ code: 200, data: { id: kbFile.id, title: kbFile.title, status, error_message: error }, message: msg } as ApiResponse<any>);
  } catch (err: any) {
    log.error(`文件上传失败: ${err.message}`, traceId);
    res.status(500).json({ code: 500, data: null, message: '文件上传失败', error: err.message } as ApiResponse<null>);
  }
});

// 重新解析文件（用于修复解析失败的文件，例如补装解析库后重试）
router.post('/files/:id/reparse', authenticate, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const traceId = generateTraceId();
  try {
    const file = await knowledgeBaseRepository.findFileById(id);
    if (!file) {
      res.status(404).json({ code: 404, data: null, message: '文件不存在' } as ApiResponse<null>);
      return;
    }
    if (!existsSync(file.file_path)) {
      res.status(410).json({ code: 410, data: null, message: '原始文件已被清理，无法重新解析，请重新上传' } as ApiResponse<null>);
      return;
    }

    log.info(`重新解析知识库文件: ${file.file_name} (${file.file_ext})`, traceId);
    const { content, error } = await parseFile(file.file_path, file.file_ext, file.file_name);
    const status = error ? 'error' : 'ready';
    await knowledgeBaseRepository.updateFile(id, {
      content,
      content_length: content.length,
      status,
      error_message: error || null,
    } as Partial<KBFile>);

    const msg = error
      ? `重新解析仍失败: ${error}`
      : `重新解析成功，提取 ${content.length} 字符`;
    res.json({ code: 200, data: { id, status, content_length: content.length, error_message: error || null }, message: msg } as ApiResponse<any>);
  } catch (err: any) {
    log.error(`重新解析失败: ${err.message}`, traceId);
    res.status(500).json({ code: 500, data: null, message: '重新解析失败', error: err.message } as ApiResponse<null>);
  }
});

// 获取单个文件内容
router.get('/files/:id', authenticate, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const file = await knowledgeBaseRepository.findFileById(id);
    if (!file) {
      res.status(404).json({ code: 404, data: null, message: '文件不存在' } as ApiResponse<null>);
      return;
    }
    res.json({ code: 200, data: file, message: '获取成功' } as ApiResponse<any>);
  } catch (err: any) {
    res.status(500).json({ code: 500, data: null, message: '获取文件失败', error: err.message } as ApiResponse<null>);
  }
});

// 批量获取文件内容（供 AI 分析使用）
router.post('/files/batch', authenticate, async (req: Request, res: Response) => {
  const { ids } = req.body as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.json({ code: 200, data: [], message: '无文件ID' } as ApiResponse<any>);
    return;
  }
  try {
    const files = await knowledgeBaseRepository.findFilesByIds(ids);
    const result = files.map((f: KBFile) => ({
      id: f.id,
      title: f.title,
      file_name: f.file_name,
      content: f.content || '',
      content_length: f.content_length,
    }));
    res.json({ code: 200, data: result, message: `获取 ${result.length} 个文件` } as ApiResponse<any>);
  } catch (err: any) {
    res.status(500).json({ code: 500, data: null, message: '批量获取文件失败', error: err.message } as ApiResponse<null>);
  }
});

// 下载文件（返回原始文件，保留原文件名）
router.get('/files/:id/download', authenticate, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const file = await knowledgeBaseRepository.findFileById(id);
    if (!file) {
      res.status(404).json({ code: 404, data: null, message: '文件不存在' } as ApiResponse<null>);
      return;
    }
    if (!file.file_path || !existsSync(file.file_path)) {
      res.status(410).json({ code: 410, data: null, message: '原始文件已被清理，无法下载' } as ApiResponse<null>);
      return;
    }
    const downloadName = file.file_name || `${file.title}${file.file_ext || ''}`;
    const asciiFallback = downloadName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
    );
    const stat = await fs.stat(file.file_path);
    res.setHeader('Content-Length', stat.size);
    const { createReadStream } = await import('fs');
    createReadStream(file.file_path).pipe(res);
  } catch (err: any) {
    res.status(500).json({ code: 500, data: null, message: '下载文件失败', error: err.message } as ApiResponse<null>);
  }
});

// 删除文件
router.delete('/files/:id', authenticate, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const file = await knowledgeBaseRepository.findFileById(id);
    if (!file) {
      res.status(404).json({ code: 404, data: null, message: '文件不存在' } as ApiResponse<null>);
      return;
    }
    // 删除物理文件
    if (file.file_path && existsSync(file.file_path)) {
      await fs.unlink(file.file_path).catch(() => {});
    }
    await knowledgeBaseRepository.deleteFile(id);
    res.json({ code: 200, data: null, message: '文件删除成功' } as ApiResponse<null>);
  } catch (err: any) {
    res.status(500).json({ code: 500, data: null, message: '删除文件失败', error: err.message } as ApiResponse<null>);
  }
});

// 更新文件信息（标题、分类）
router.put('/files/:id', authenticate, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { title, categoryId } = req.body;
  try {
    await knowledgeBaseRepository.updateFile(id, { title, category_id: categoryId });
    res.json({ code: 200, data: null, message: '文件信息更新成功' } as ApiResponse<null>);
  } catch (err: any) {
    res.status(500).json({ code: 500, data: null, message: '更新文件信息失败', error: err.message } as ApiResponse<null>);
  }
});

export const knowledgeBaseRoutes = router;
