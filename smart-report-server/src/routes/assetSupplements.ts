/**
 * 资产补充信息路由模块
 * 
 * 提供资产补充信息的 RESTful API 接口：
 * - POST /api/asset-supplements - 创建补充信息
 * - GET /api/asset-supplements/report/:reportId - 获取报告的所有补充信息
 * - GET /api/asset-supplements/report/:reportId/type/:assetType - 获取特定类型的补充信息
 * - PUT /api/asset-supplements/:id - 更新补充信息
 * - DELETE /api/asset-supplements/:id - 删除补充信息
 * - DELETE /api/asset-supplements/report/:reportId - 删除报告的所有补充信息
 * - GET /api/asset-supplements/report/:reportId/stats - 获取补充信息统计
 * 
 * @module routes/assetSupplements
 */

import { Router, Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types';
import { getLogger, generateTraceId } from '../utils/logger';
import { 
  create, 
  getByReportId, 
  getByReportIdAndAssetType, 
  update, 
  deleteById, 
  deleteByReportId,
  getStatsByReportId
} from '../db/repositories/assetSupplementRepository';
import { authenticate as authMiddleware } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { getConfig } from '../config';

const log = getLogger('AssetSupplementsRoute', 'other');

/**
 * 文件上传配置
 */
const UPLOADS_DIR = path.join(getConfig().DATA_DIR, 'uploads', 'asset-supplements');

// 确保上传目录存在
if (!existsSync(UPLOADS_DIR)) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB限制
  fileFilter: (req, file, cb) => {
    // 允许的文件类型
    const allowedTypes = [
      'text/plain', 'text/csv', 'text/xml', 'text/html',
      'application/json', 'application/xml', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/pdf'
    ];
    
    if (allowedTypes.includes(file.mimetype) || 
        file.originalname.endsWith('.log') || 
        file.originalname.endsWith('.txt') ||
        file.originalname.endsWith('.csv') ||
        file.originalname.endsWith('.xml') ||
        file.originalname.endsWith('.html') ||
        file.originalname.endsWith('.json') ||
        file.originalname.endsWith('.xlsx') ||
        file.originalname.endsWith('.xls') ||
        file.originalname.endsWith('.docx') ||
        file.originalname.endsWith('.doc') ||
        file.originalname.endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型'));
    }
  }
});

export const assetSupplementRoutes = Router();

/**
 * 创建资产补充信息
 * POST /api/asset-supplements
 */
assetSupplementRoutes.post('/', authMiddleware, async (req: Request, res: Response) => {
  const traceId = generateTraceId();
  log.info('创建资产补充信息', traceId);
  
  try {
    const {
      report_id,
      asset_type,
      category,
      supplement_type,
      field_name,
      field_value,
      metadata
    } = req.body;
    
    if (!report_id || !asset_type || !category || !supplement_type || !field_name) {
      return res.status(400).json({
        code: 400,
        data: null,
        message: '缺少必要参数'
      });
    }
    
    const supplement = await create({
      report_id,
      asset_type,
      category,
      supplement_type,
      field_name,
      field_value,
      metadata,
      created_by: (req as any).user?.id
    });
    
    res.json({
      code: 200,
      data: supplement,
      message: '创建成功'
    });
  } catch (error: any) {
    log.error(`创建资产补充信息失败: ${error.message}`, traceId);
    res.status(500).json({
      code: 500,
      data: null,
      message: '创建失败',
      error: error.message
    });
  }
});

/**
 * 上传资产补充文件
 * POST /api/asset-supplements/upload
 */
assetSupplementRoutes.post('/upload', authMiddleware, upload.single('file'), async (req: Request, res: Response) => {
  const traceId = generateTraceId();
  log.info('上传资产补充文件', traceId);
  
  try {
    if (!req.file) {
      return res.status(400).json({
        code: 400,
        data: null,
        message: '未找到上传文件'
      });
    }
    
    const {
      report_id,
      asset_type,
      category,
      supplement_type,
      field_name,
      metadata
    } = req.body;
    
    if (!report_id || !asset_type || !category || !supplement_type || !field_name) {
      return res.status(400).json({
        code: 400,
        data: null,
        message: '缺少必要参数'
      });
    }
    
    // 计算文件哈希
    const fileBuffer = await fs.readFile(req.file.path);
    const { createHash } = await import('crypto');
    const fileHash = createHash('sha256').update(fileBuffer).digest('hex');
    
    // 读取文件内容
    let fileContent = '';
    try {
      fileContent = await fs.readFile(req.file.path, 'utf-8');
    } catch (error) {
      // 可能是二进制文件，跳过内容读取
      log.warn(`无法读取文件内容: ${req.file.originalname}`);
    }
    
    const supplement = await create({
      report_id,
      asset_type,
      category,
      supplement_type,
      field_name,
      file_path: req.file.path,
      file_name: req.file.originalname,
      file_size: req.file.size,
      file_hash: fileHash,
      parsed_content: fileContent,
      metadata,
      created_by: (req as any).user?.id
    });
    
    res.json({
      code: 200,
      data: supplement,
      message: '上传成功'
    });
  } catch (error: any) {
    log.error(`上传资产补充文件失败: ${error.message}`, traceId);
    res.status(500).json({
      code: 500,
      data: null,
      message: '上传失败',
      error: error.message
    });
  }
});

/**
 * 获取报告的所有资产补充信息
 * GET /api/asset-supplements/report/:reportId
 */
assetSupplementRoutes.get('/report/:reportId', authMiddleware, async (req: Request, res: Response) => {
  const traceId = generateTraceId();
  const reportId = req.params.reportId as string;
  log.info(`获取报告的资产补充信息: ${reportId}`, traceId);
  
  try {
    const supplements = await getByReportId(reportId);
    
    res.json({
      code: 200,
      data: supplements,
      message: '获取成功'
    });
  } catch (error: any) {
    log.error(`获取资产补充信息失败: ${error.message}`, traceId);
    res.status(500).json({
      code: 500,
      data: null,
      message: '获取失败',
      error: error.message
    });
  }
});

/**
 * 获取报告的特定类型资产补充信息
 * GET /api/asset-supplements/report/:reportId/type/:assetType
 */
assetSupplementRoutes.get('/report/:reportId/type/:assetType', authMiddleware, async (req: Request, res: Response) => {
  const traceId = generateTraceId();
  const reportId = req.params.reportId as string;
  const assetType = req.params.assetType as string;
  log.info(`获取报告的${assetType}类资产补充信息: ${reportId}`, traceId);
  
  try {
    const supplements = await getByReportIdAndAssetType(
      reportId, 
      assetType
    );
    
    res.json({
      code: 200,
      data: supplements,
      message: '获取成功'
    });
  } catch (error: any) {
    log.error(`获取资产补充信息失败: ${error.message}`, traceId);
    res.status(500).json({
      code: 500,
      data: null,
      message: '获取失败',
      error: error.message
    });
  }
});

/**
 * 获取报告的资产补充信息统计
 * GET /api/asset-supplements/report/:reportId/stats
 */
assetSupplementRoutes.get('/report/:reportId/stats', authMiddleware, async (req: Request, res: Response) => {
  const traceId = generateTraceId();
  const reportId = req.params.reportId as string;
  log.info(`获取报告的资产补充信息统计: ${reportId}`, traceId);
  
  try {
    const stats = await getStatsByReportId(reportId);
    
    res.json({
      code: 200,
      data: stats,
      message: '获取成功'
    });
  } catch (error: any) {
    log.error(`获取资产补充信息统计失败: ${error.message}`, traceId);
    res.status(500).json({
      code: 500,
      data: null,
      message: '获取失败',
      error: error.message
    });
  }
});

/**
 * 更新资产补充信息
 * PUT /api/asset-supplements/:id
 */
assetSupplementRoutes.put('/:id', authMiddleware, async (req: Request, res: Response) => {
  const traceId = generateTraceId();
  const id = req.params.id as string;
  log.info(`更新资产补充信息: ${id}`, traceId);
  
  try {
    const { field_value, metadata } = req.body;
    
    await update(id, {
      field_value,
      metadata
    });
    
    res.json({
      code: 200,
      data: null,
      message: '更新成功'
    });
  } catch (error: any) {
    log.error(`更新资产补充信息失败: ${error.message}`, traceId);
    res.status(500).json({
      code: 500,
      data: null,
      message: '更新失败',
      error: error.message
    });
  }
});

/**
 * 删除资产补充信息
 * DELETE /api/asset-supplements/:id
 */
assetSupplementRoutes.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  const traceId = generateTraceId();
  const id = req.params.id as string;
  log.info(`删除资产补充信息: ${id}`, traceId);
  
  try {
    await deleteById(id);
    
    res.json({
      code: 200,
      data: null,
      message: '删除成功'
    });
  } catch (error: any) {
    log.error(`删除资产补充信息失败: ${error.message}`, traceId);
    res.status(500).json({
      code: 500,
      data: null,
      message: '删除失败',
      error: error.message
    });
  }
});

/**
 * 删除报告的所有资产补充信息
 * DELETE /api/asset-supplements/report/:reportId
 */
assetSupplementRoutes.delete('/report/:reportId', authMiddleware, async (req: Request, res: Response) => {
  const traceId = generateTraceId();
  const reportId = req.params.reportId as string;
  log.info(`删除报告的所有资产补充信息: ${reportId}`, traceId);
  
  try {
    await deleteByReportId(reportId);
    
    res.json({
      code: 200,
      data: null,
      message: '删除成功'
    });
  } catch (error: any) {
    log.error(`删除资产补充信息失败: ${error.message}`, traceId);
    res.status(500).json({
      code: 500,
      data: null,
      message: '删除失败',
      error: error.message
    });
  }
});