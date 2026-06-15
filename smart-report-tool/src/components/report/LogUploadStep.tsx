import { useState } from 'react';
import { LogCategory } from '@/types';
import { LOG_CATEGORIES } from '@/constants/categories';
import { FileUploader } from '@/components/common/FileUploader';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface LogUploadStepProps {
  category: LogCategory;
  onCategoryChange: (category: LogCategory) => void;
  onFilesSelected: (files: File[]) => void;
  enableAIAnalysis: boolean;
  onAIAnalysisChange: (enabled: boolean) => void;
}

export function LogUploadStep({
  category,
  onCategoryChange,
  onFilesSelected,
  enableAIAnalysis,
  onAIAnalysisChange,
}: LogUploadStepProps) {
  const [localFiles, setLocalFiles] = useState<File[]>([]);

  const handleFilesSelected = (files: File[]) => {
    setLocalFiles((prev) => [...prev, ...files]);
    onFilesSelected(files);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>日志类型</Label>
        <Select value={category} onValueChange={(v) => onCategoryChange(v as LogCategory)}>
          <SelectTrigger>
            <SelectValue placeholder="选择日志类型" />
          </SelectTrigger>
          <SelectContent>
            {LOG_CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {cat.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>上传日志文件</Label>
        <FileUploader onFilesSelected={handleFilesSelected} acceptedTypes=".log,.txt,.csv,.json" maxSizeMB={20} />
        {localFiles.length > 0 && (
          <p className="text-sm text-muted-foreground">已选择 {localFiles.length} 个文件</p>
        )}
      </div>
      {category === 'database' && (
        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="ai-analysis"
            checked={enableAIAnalysis}
            onChange={(e) => onAIAnalysisChange(e.target.checked)}
          />
          <Label htmlFor="ai-analysis">调用 AI Agent 分析数据库日志性能</Label>
        </div>
      )}
    </div>
  );
}
