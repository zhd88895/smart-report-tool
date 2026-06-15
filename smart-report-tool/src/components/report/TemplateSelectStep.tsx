import { useState, useEffect } from 'react';
import { LogCategory } from '@/types';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface TemplateSelectStepProps {
  selectedTemplateId: string | null;
  logCategory: LogCategory;
  onSelect: (templateId: string) => void;
}

interface TemplateOption {
  id: string;
  name: string;
  category: LogCategory | 'universal';
  description: string;
}

const BUILT_IN_TEMPLATES: TemplateOption[] = [
  {
    id: 'tpl_host',
    name: '主机日志模板',
    category: 'host',
    description: '适用于服务器主机日志分析与报告生成',
  },
  {
    id: 'tpl_storage',
    name: '存储日志模板',
    category: 'storage',
    description: '适用于存储系统日志分析与报告生成',
  },
  {
    id: 'tpl_database',
    name: '数据库日志模板',
    category: 'database',
    description: '适用于数据库日志分析与报告生成',
  },
  {
    id: 'tpl_virtualization',
    name: '虚拟化日志模板',
    category: 'virtualization',
    description: '适用于虚拟化平台日志分析与报告生成',
  },
  {
    id: 'tpl_network',
    name: '网络日志模板',
    category: 'network',
    description: '适用于网络设备日志分析与报告生成',
  },
];

export function TemplateSelectStep({ selectedTemplateId, logCategory, onSelect }: TemplateSelectStepProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (selectedTemplateId) {
      const map: Record<string, string> = {
        tpl_host: '/templates/host-template.html',
        tpl_storage: '/templates/storage-template.html',
        tpl_database: '/templates/database-template.html',
        tpl_virtualization: '/templates/virtualization-template.html',
        tpl_network: '/templates/network-template.html',
      };
      setPreviewUrl(map[selectedTemplateId] || null);
    } else {
      setPreviewUrl(null);
    }
  }, [selectedTemplateId]);

  const filtered = BUILT_IN_TEMPLATES.filter(
    (t) => t.category === logCategory || t.category === 'universal'
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>选择报告模板</Label>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tpl) => (
            <Card
              key={tpl.id}
              className={cn(
                'cursor-pointer transition-all hover:shadow-md',
                selectedTemplateId === tpl.id ? 'border-2 border-primary ring-1 ring-primary' : 'border'
              )}
              onClick={() => onSelect(tpl.id)}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{tpl.name}</CardTitle>
                <CardDescription className="text-xs">{tpl.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex h-24 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                  模板预览
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      {previewUrl && (
        <div className="space-y-2">
          <Label>模板预览</Label>
          <div className="overflow-hidden rounded-lg border">
            <iframe src={previewUrl} title="模板预览" className="h-64 w-full" sandbox="allow-same-origin allow-scripts" />
          </div>
        </div>
      )}
    </div>
  );
}
