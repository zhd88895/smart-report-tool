import { DocTemplate } from '@/types';
import { getAllDocTemplates, putDocTemplate, removeDocTemplate } from './db';

export async function getAllDocTemplatesService(): Promise<DocTemplate[]> {
  return getAllDocTemplates();
}

export async function addDocTemplate(template: DocTemplate): Promise<string> {
  return putDocTemplate(template);
}

export async function deleteDocTemplateService(id: string): Promise<void> {
  return removeDocTemplate(id);
}
