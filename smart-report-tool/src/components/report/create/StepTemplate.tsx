import { DocTemplate, Script } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/common/EmptyState';
import { ChevronRight } from 'lucide-react';

interface StepTemplateProps {
  selectedScript?: Script;
  selectedTemplateId: string | null;
  selectedDocTemplate?: DocTemplate;
  docTemplates: DocTemplate[];
  onSelectTemplate: (templateId: string) => void;
  onPrev: () => void;
  onNext: () => void;
}

/** 步骤2：选择报告模板（仅手动选择模板时出现） */
export function StepTemplate({
  selectedScript,
  selectedTemplateId,
  selectedDocTemplate,
  docTemplates,
  onSelectTemplate,
  onPrev,
  onNext,
}: StepTemplateProps) {
  // 脚本已关联模板时，关联模板不再重复显示
  const available = selectedScript && selectedScript.templateIds && selectedScript.templateIds.length > 0
    ? docTemplates.filter((t) => !selectedScript.templateIds.includes(t.id))
    : docTemplates;

  return (
    <Card>
      <CardHeader><CardTitle>步骤2：选择报告模板</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {selectedScript && selectedScript.templateIds.length > 0 ? (
          <div className="rounded-lg border p-4 bg-primary/5 border-primary/30">
            <p className="text-sm font-medium">
              当前脚本「{selectedScript.name}」已关联模板，
              {selectedDocTemplate ? (
                <span>正在使用：<Badge variant="default" className="ml-1">{selectedDocTemplate.name}</Badge></span>
              ) : (
                <span className="text-muted-foreground">已自动选中关联模板</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-1">如需更换，可在下方点击其他模板；关联模板不再重复显示</p>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-3">
          {available.length === 0 ? (
            <EmptyState title="暂无其他可选模板" description="" />
          ) : (
            available.map((t) => (
              <div
                key={t.id}
                onClick={() => onSelectTemplate(t.id)}
                className={`cursor-pointer rounded-lg border p-4 transition-colors ${selectedTemplateId === t.id ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{t.name}</p>
                    {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                  </div>
                  <Badge variant="outline">{t.fileType.toUpperCase()}</Badge>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="flex justify-between">
          <Button variant="outline" onClick={onPrev}>上一步</Button>
          <Button onClick={onNext}>
            下一步 <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
