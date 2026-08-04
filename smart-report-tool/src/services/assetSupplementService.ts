/**
 * 资产补充信息服务
 * 
 * 提供资产补充信息的API调用封装
 * 
 * @module assetSupplementService
 */

import { AssetSupplement } from '@/components/AssetSupplementForm';

const API_BASE = '/api/asset-supplements';

/**
 * 通用请求函数
 */
async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `API error: ${response.statusText}`);
  }

  return response.json();
}

/**
 * 文件上传请求函数
 */
async function uploadFile<T>(
  endpoint: string,
  formData: FormData
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `API error: ${response.statusText}`);
  }

  return response.json();
}

/**
 * 资产补充信息服务
 */
export const assetSupplementService = {
  /**
   * 创建资产补充信息
   */
  async create(data: Omit<AssetSupplement, 'id'>): Promise<{ data: AssetSupplement }> {
    return request('/' , {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * 上传资产补充文件
   */
  async upload(data: {
    report_id: string;
    asset_type: string;
    category: string;
    supplement_type: string;
    field_name: string;
    file: File;
  }): Promise<{ data: AssetSupplement }> {
    const formData = new FormData();
    formData.append('report_id', data.report_id);
    formData.append('asset_type', data.asset_type);
    formData.append('category', data.category);
    formData.append('supplement_type', data.supplement_type);
    formData.append('field_name', data.field_name);
    formData.append('file', data.file);

    return uploadFile('/upload', formData);
  },

  /**
   * 获取报告的所有资产补充信息
   */
  async getByReportId(reportId: string): Promise<{ data: AssetSupplement[] }> {
    return request(`/report/${reportId}`);
  },

  /**
   * 获取报告的特定类型资产补充信息
   */
  async getByReportIdAndAssetType(reportId: string, assetType: string): Promise<{ data: AssetSupplement[] }> {
    return request(`/report/${reportId}/type/${assetType}`);
  },

  /**
   * 获取报告的资产补充信息统计
   */
  async getStatsByReportId(reportId: string): Promise<{ data: Record<string, number> }> {
    return request(`/report/${reportId}/stats`);
  },

  /**
   * 更新资产补充信息
   */
  async update(id: string, data: Partial<AssetSupplement>): Promise<{ data: null }> {
    return request(`/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /**
   * 删除资产补充信息
   */
  async deleteById(id: string): Promise<{ data: null }> {
    return request(`/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * 删除报告的所有资产补充信息
   */
  async deleteByReportId(reportId: string): Promise<{ data: null }> {
    return request(`/report/${reportId}`, {
      method: 'DELETE',
    });
  },
};