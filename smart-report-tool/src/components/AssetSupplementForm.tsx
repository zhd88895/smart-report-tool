/**
 * 资产补充信息表单组件
 * 
 * 为各资产分类提供可选的信息补充字段
 * 
 * @component AssetSupplementForm
 */

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';

/**
 * 资产类型定义
 */
export type AssetType = 'host' | 'storage' | 'virtualization' | 'network' | 'database';

/**
 * 资产补充信息接口
 */
export interface AssetSupplement {
  id?: string;
  report_id: string;
  asset_type: AssetType;
  category: string;
  supplement_type: 'manual' | 'upload' | 'parsed';
  field_name: string;
  field_value?: string;
  file_path?: string;
  file_name?: string;
  file_size?: number;
  parsed_content?: string;
}

/**
 * 资产分类配置
 */
const ASSET_CATEGORIES: Record<AssetType, { label: string; fields: Array<{ name: string; label: string; type: 'text' | 'textarea' }> }> = {
  host: {
    label: '服务器信息',
    fields: [
      { name: 'manufacturer', label: '服务器厂家', type: 'text' },
      { name: 'model', label: '服务器型号', type: 'text' },
      { name: 'os_version', label: '系统版本', type: 'text' },
      { name: 'system_info', label: '系统信息（命令输出/日志）', type: 'textarea' },
    ]
  },
  storage: {
    label: '存储信息',
    fields: [
      { name: 'manufacturer', label: '存储厂家', type: 'text' },
      { name: 'model', label: '存储型号', type: 'text' },
    ]
  },
  virtualization: {
    label: '虚拟化信息',
    fields: [
      { name: 'platform_manufacturer', label: '虚拟化平台厂家', type: 'text' },
      { name: 'system_version', label: '虚拟化版本信息', type: 'text' },
    ]
  },
  network: {
    label: '网络设备信息',
    fields: [
      { name: 'manufacturer', label: '交换机厂家', type: 'text' },
      { name: 'model', label: '交换机型号', type: 'text' },
      { name: 'switch_type', label: '交换机类型（SAN/网络）', type: 'text' },
    ]
  },
  database: {
    label: '数据库信息',
    fields: [
      { name: 'manufacturer', label: '数据库厂家', type: 'text' },
      { name: 'version', label: '数据库版本', type: 'text' },
    ]
  }
};

/**
 * 资产补充信息表单组件
 */
interface AssetSupplementFormProps {
  reportId: string;
  assetType: AssetType;
  onSupplementsChange: (supplements: AssetSupplement[]) => void;
  initialSupplements?: AssetSupplement[];
}

export function AssetSupplementForm({ 
  reportId, 
  assetType,
  onSupplementsChange, 
  initialSupplements = [] 
}: AssetSupplementFormProps) {
  const [supplements, setSupplements] = useState<AssetSupplement[]>(initialSupplements);

  useEffect(() => {
    onSupplementsChange(supplements);
  }, [supplements, onSupplementsChange]);

  /**
   * 获取当前资产类型的配置
   */
  const config = ASSET_CATEGORIES[assetType];
  if (!config) return null;

  /**
   * 更新字段值
   */
  const updateFieldValue = (fieldName: string, value: string) => {
    // 查找是否已存在
    const existingIndex = supplements.findIndex(
      s => s.asset_type === assetType && s.field_name === fieldName
    );

    if (existingIndex >= 0) {
      // 更新现有字段
      const updated = [...supplements];
      if (value.trim() === '') {
        // 如果值为空，删除该字段
        updated.splice(existingIndex, 1);
      } else {
        updated[existingIndex].field_value = value;
      }
      setSupplements(updated);
    } else if (value.trim() !== '') {
      // 添加新字段
      const newSupplement: AssetSupplement = {
        report_id: reportId,
        asset_type: assetType,
        category: assetType,
        supplement_type: 'manual',
        field_name: fieldName,
        field_value: value,
      };
      setSupplements([...supplements, newSupplement]);
    }
  };

  /**
   * 获取字段值
   */
  const getFieldValue = (fieldName: string): string => {
    const supplement = supplements.find(
      s => s.asset_type === assetType && s.field_name === fieldName
    );
    return supplement?.field_value || '';
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        为{config.label}提供补充信息，这些信息将在AI分析时作为参考。
      </div>

      <ScrollArea className="h-auto max-h-[500px]">
        <div className="space-y-4 px-2 pt-2 pb-4">
          {config.fields.map((field) => (
            <div key={field.name} className="space-y-2">
              <Label htmlFor={field.name} className="text-sm font-medium">
                {field.label}
              </Label>
              {field.type === 'text' ? (
                <Input
                  id={field.name}
                  placeholder={`请输入${field.label}`}
                  value={getFieldValue(field.name)}
                  onChange={(e) => updateFieldValue(field.name, e.target.value)}
                />
              ) : (
                <Textarea
                  id={field.name}
                  placeholder={`请输入${field.label}（支持粘贴命令输出、日志内容等）`}
                  value={getFieldValue(field.name)}
                  onChange={(e) => updateFieldValue(field.name, e.target.value)}
                  className="min-h-[100px]"
                />
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}