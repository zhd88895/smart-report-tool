import { Download, Pencil, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/utils/formatters';

export const SCRIPT_COLORS: Record<string, { bg: string; text: string }> = {
  python: { bg: '#e8f0fe', text: '#1967d2' },
  bat: { bg: '#f3e8fd', text: '#7b1fa2' },
  ps1: { bg: '#e8f5e9', text: '#2e7d32' },
  powershell: { bg: '#e8f5e9', text: '#2e7d32' },
  sh: { bg: '#fff3e0', text: '#e65100' },
};

function getScriptAbbr(type: string): string {
  const map: Record<string, string> = { python: 'Py', bat: 'BAT', ps1: 'PS', sh: 'SH', powershell: 'PS7' };
  return map[type] || type.toUpperCase();
}

export interface ScriptFileCardProps {
  fileName: string;
  fileSize?: number;
  scriptType: string;
  scriptId?: string;
  onDownload?: () => void;
  onEdit?: () => void;
  onReupload: () => void;
  showActions?: boolean;
  bordered?: boolean;
}

export function ScriptFileCard({ fileName, fileSize, scriptType, onDownload, onEdit, onReupload, showActions, bordered = false }: ScriptFileCardProps) {
  const colors = SCRIPT_COLORS[scriptType] || { bg: '#f5f5f5', text: '#333' };
  const containerClasses = bordered
    ? 'flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-10 transition-colors'
    : 'flex flex-col items-center justify-center rounded-xl border border-border bg-card shadow-md p-10 transition-all';
  return (
    <div className={containerClasses}>
      <div className="flex-shrink-0 w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold mb-4 shadow-sm" style={{ backgroundColor: colors.bg, color: colors.text }}>
        {getScriptAbbr(scriptType)}
      </div>
      <p className="text-base font-semibold truncate max-w-full">{fileName}</p>
      {fileSize !== undefined && <p className="text-sm text-muted-foreground mt-1">{formatFileSize(fileSize)}</p>}
      <div className="flex items-center gap-3 mt-5">
        {showActions && onDownload && (
          <Button variant="default" size="default" onClick={onDownload} title="下载脚本"><Download className="h-4 w-4 mr-1.5" />下载</Button>
        )}
        {showActions && onEdit && (
          <Button variant="default" size="default" onClick={onEdit} title="编辑脚本"><Pencil className="h-4 w-4 mr-1.5" />编辑</Button>
        )}
        <Button variant="outline" size="default" onClick={onReupload} title="重新选择"><Upload className="h-4 w-4 mr-1.5" />{showActions ? '替换' : '重新选择'}</Button>
      </div>
    </div>
  );
}
