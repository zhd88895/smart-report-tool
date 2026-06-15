import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { User, Script, Report, Conversation, ReportTemplate, ExecutionLog, DocTemplate } from '@/types';

const DB_NAME = 'smart_report_db';
const DB_VERSION = 3;

interface SmartReportDB extends DBSchema {
  users: { key: string; value: User };
  scripts: { key: string; value: Script };
  reports: { key: string; value: Report };
  conversations: { key: string; value: Conversation };
  templates: { key: string; value: ReportTemplate };
  docTemplates: { key: string; value: DocTemplate };
  executionLogs: { key: string; value: ExecutionLog };
}

let dbInstance: IDBPDatabase<SmartReportDB> | null = null;

export async function initDatabase(): Promise<IDBPDatabase<SmartReportDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<SmartReportDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('scripts')) {
        db.createObjectStore('scripts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('reports')) {
        db.createObjectStore('reports', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('conversations')) {
        db.createObjectStore('conversations', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('templates')) {
        db.createObjectStore('templates', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('executionLogs')) {
        db.createObjectStore('executionLogs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('docTemplates')) {
        db.createObjectStore('docTemplates', { keyPath: 'id' });
      }
    },
  });

  return dbInstance;
}

export function getDB(): IDBPDatabase<SmartReportDB> {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

// ── Generic helpers ──

export async function getAllUsers(): Promise<User[]> { return getDB().getAll('users'); }
export async function getUserById(id: string): Promise<User | undefined> { return getDB().get('users', id); }
export async function putUser(value: User): Promise<string> { return getDB().put('users', value); }
export async function removeUser(id: string): Promise<void> { return getDB().delete('users', id); }

export async function getAllScripts(): Promise<Script[]> { return getDB().getAll('scripts'); }
export async function getScriptById(id: string): Promise<Script | undefined> { return getDB().get('scripts', id); }
export async function putScript(value: Script): Promise<string> { return getDB().put('scripts', value); }
export async function removeScript(id: string): Promise<void> { return getDB().delete('scripts', id); }

export async function getAllReports(): Promise<Report[]> { return getDB().getAll('reports'); }
export async function getReportById(id: string): Promise<Report | undefined> { return getDB().get('reports', id); }
export async function putReport(value: Report): Promise<string> { return getDB().put('reports', value); }
export async function removeReport(id: string): Promise<void> { return getDB().delete('reports', id); }

export async function getAllConversations(): Promise<Conversation[]> { return getDB().getAll('conversations'); }
export async function getConversationById(id: string): Promise<Conversation | undefined> { return getDB().get('conversations', id); }
export async function putConversation(value: Conversation): Promise<string> { return getDB().put('conversations', value); }
export async function removeConversation(id: string): Promise<void> { return getDB().delete('conversations', id); }

export async function getAllTemplates(): Promise<ReportTemplate[]> { return getDB().getAll('templates'); }
export async function putTemplate(value: ReportTemplate): Promise<string> { return getDB().put('templates', value); }
export async function removeTemplate(id: string): Promise<void> { return getDB().delete('templates', id); }

export async function getAllExecutionLogs(): Promise<ExecutionLog[]> { return getDB().getAll('executionLogs'); }
export async function getExecutionLogById(id: string): Promise<ExecutionLog | undefined> { return getDB().get('executionLogs', id); }
export async function putExecutionLog(value: ExecutionLog): Promise<string> { return getDB().put('executionLogs', value); }
export async function removeExecutionLog(id: string): Promise<void> { return getDB().delete('executionLogs', id); }

export async function getAllDocTemplates(): Promise<DocTemplate[]> { return getDB().getAll('docTemplates'); }
export async function getDocTemplateById(id: string): Promise<DocTemplate | undefined> { return getDB().get('docTemplates', id); }
export async function putDocTemplate(value: DocTemplate): Promise<string> { return getDB().put('docTemplates', value); }
export async function removeDocTemplate(id: string): Promise<void> { return getDB().delete('docTemplates', id); }
