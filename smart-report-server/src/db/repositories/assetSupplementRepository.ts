/**
 * 资产补充信息仓储模块
 * 
 * 提供资产补充信息的数据库操作封装。
 * 
 * @module assetSupplementRepository
 */

import { runAsync, allAsync, getAsync } from '../database';
import { randomUUID } from 'crypto';
import { logger, getLogger } from '../../utils/logger';

const log = getLogger('AssetSupplementRepository', 'other');

/**
 * 资产补充信息接口
 */
export interface AssetSupplement {
  id: string;
  report_id: string;
  asset_type: string; // host/storage/virtualization/network/database
  category: string; // 具体分类
  supplement_type: string; // manual/upload/parsed
  field_name: string;
  field_value?: string;
  file_path?: string;
  file_name?: string;
  file_size?: number;
  file_hash?: string;
  parsed_content?: string;
  metadata?: string;
  created_by?: string;
  created_at: string;
  updated_at?: string;
}

/**
 * 创建资产补充信息
 */
export async function create(data: Omit<AssetSupplement, 'id' | 'created_at'>): Promise<AssetSupplement> {
  const id = `supplement_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const created_at = new Date().toISOString();
  
  const sql = `
    INSERT INTO asset_supplements (
      id, report_id, asset_type, category, supplement_type, 
      field_name, field_value, file_path, file_name, file_size, 
      file_hash, parsed_content, metadata, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  const params = [
    id, data.report_id, data.asset_type, data.category, data.supplement_type,
    data.field_name, data.field_value, data.file_path, data.file_name, data.file_size,
    data.file_hash, data.parsed_content, data.metadata, data.created_by, created_at, null
  ];
  
  await runAsync(sql, params);
  log.info(`创建资产补充信息: ${id}, 报告ID: ${data.report_id}, 类型: ${data.asset_type}`);
  
  return { id, created_at, ...data };
}

/**
 * 根据报告ID获取资产补充信息列表
 */
export async function getByReportId(reportId: string): Promise<AssetSupplement[]> {
  const sql = `
    SELECT * FROM asset_supplements 
    WHERE report_id = ? 
    ORDER BY asset_type, category, field_name
  `;
  return await allAsync(sql, [reportId]) as AssetSupplement[];
}

/**
 * 根据报告ID和资产类型获取补充信息
 */
export async function getByReportIdAndAssetType(reportId: string, assetType: string): Promise<AssetSupplement[]> {
  const sql = `
    SELECT * FROM asset_supplements 
    WHERE report_id = ? AND asset_type = ?
    ORDER BY category, field_name
  `;
  return await allAsync(sql, [reportId, assetType]) as AssetSupplement[];
}

/**
 * 更新资产补充信息
 */
export async function update(id: string, data: Partial<AssetSupplement>): Promise<void> {
  const fields: string[] = [];
  const params: any[] = [];
  
  if (data.field_value !== undefined) {
    fields.push('field_value = ?');
    params.push(data.field_value);
  }
  if (data.file_path !== undefined) {
    fields.push('file_path = ?');
    params.push(data.file_path);
  }
  if (data.file_name !== undefined) {
    fields.push('file_name = ?');
    params.push(data.file_name);
  }
  if (data.file_size !== undefined) {
    fields.push('file_size = ?');
    params.push(data.file_size);
  }
  if (data.file_hash !== undefined) {
    fields.push('file_hash = ?');
    params.push(data.file_hash);
  }
  if (data.parsed_content !== undefined) {
    fields.push('parsed_content = ?');
    params.push(data.parsed_content);
  }
  if (data.metadata !== undefined) {
    fields.push('metadata = ?');
    params.push(data.metadata);
  }
  
  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  
  params.push(id);
  
  const sql = `UPDATE asset_supplements SET ${fields.join(', ')} WHERE id = ?`;
  await runAsync(sql, params);
  log.info(`更新资产补充信息: ${id}`);
}

/**
 * 删除资产补充信息
 */
export async function deleteById(id: string): Promise<void> {
  const sql = 'DELETE FROM asset_supplements WHERE id = ?';
  await runAsync(sql, [id]);
  log.info(`删除资产补充信息: ${id}`);
}

/**
 * 根据报告ID删除所有资产补充信息
 */
export async function deleteByReportId(reportId: string): Promise<void> {
  const sql = 'DELETE FROM asset_supplements WHERE report_id = ?';
  await runAsync(sql, [reportId]);
  log.info(`删除报告的所有资产补充信息: ${reportId}`);
}

/**
 * 根据报告ID获取资产补充信息统计
 */
export async function getStatsByReportId(reportId: string): Promise<Record<string, number>> {
  const sql = `
    SELECT asset_type, COUNT(*) as count
    FROM asset_supplements 
    WHERE report_id = ?
    GROUP BY asset_type
  `;
  const rows = await allAsync(sql, [reportId]) as Array<{ asset_type: string; count: number }>;
  
  const stats: Record<string, number> = {};
  for (const row of rows) {
    stats[row.asset_type] = row.count;
  }
  return stats;
}