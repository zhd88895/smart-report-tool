import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_KEY_PREFIX = 'smart_report_logs_';
const MAX_LOGS_PER_SESSION = 2000; // 最多保存2000条日志
const SAVE_DEBOUNCE_MS = 300; // 日志保存防抖间隔
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 日志会话保留7天

export interface LogSession {
  id: string;
  logs: string[];
  startTime: string;
  lastUpdateTime: string;
  status: 'generating' | 'success' | 'failed' | 'idle';
  reportId?: string;
}

/**
 * 日志持久化 Hook
 * 支持页面切换后恢复日志，继续显示实时输出
 *
 * 实现要点：
 * - React state 保持日志实时更新
 * - localStorage 只做持久化兜底，通过防抖批量写入，避免频繁阻塞主线程
 * - 提供批量 addLogs 接口，配合 SSE 流式日志高频输入
 */
export function useLogPersistence(sessionId: string) {
  const [logs, setLogs] = useState<string[]>([]);
  const [isRestored, setIsRestored] = useState(false);
  const sessionIdRef = useRef(sessionId);
  const pendingLogsRef = useRef<string[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);

  // 当外部 sessionId 变化时，同步更新 ref，避免闭包旧值
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // 从 localStorage 恢复日志
  useEffect(() => {
    if (!sessionId) {
      setLogs([]);
      setIsRestored(false);
      return;
    }

    const storageKey = `${STORAGE_KEY_PREFIX}${sessionId}`;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const session: LogSession = JSON.parse(stored);
        if (session.logs && Array.isArray(session.logs)) {
          setLogs(session.logs.slice(-MAX_LOGS_PER_SESSION));
          setIsRestored(true);
          console.log(`[日志持久化] 恢复了 ${session.logs.length} 条日志，会话ID: ${sessionId}`);
        }
      } else {
        setLogs([]);
        setIsRestored(false);
      }
    } catch (error) {
      console.error('[日志持久化] 恢复日志失败:', error);
      setLogs([]);
      setIsRestored(false);
    }
  }, [sessionId]);

  // 真正写入 localStorage 的函数
  const doSave = useCallback((currentLogs: string[], status?: string) => {
    if (!sessionIdRef.current) return;

    const storageKey = `${STORAGE_KEY_PREFIX}${sessionIdRef.current}`;
    const session: LogSession = {
      id: sessionIdRef.current,
      logs: currentLogs.slice(-MAX_LOGS_PER_SESSION),
      startTime: new Date().toISOString(),
      lastUpdateTime: new Date().toISOString(),
      status: (status as LogSession['status']) || 'generating',
    };

    try {
      localStorage.setItem(storageKey, JSON.stringify(session));
      isDirtyRef.current = false;
    } catch (error) {
      console.error('[日志持久化] 保存日志失败:', error);
      // 如果存储空间不足，尝试清理旧日志后重试
      try {
        clearOldLogs();
        localStorage.setItem(storageKey, JSON.stringify(session));
        isDirtyRef.current = false;
      } catch {
        // 放弃保存
      }
    }
  }, []);

  // 防抖保存：避免高频日志触发频繁 localStorage 写入阻塞主线程
  const scheduleSave = useCallback((currentLogs: string[], status?: string) => {
    isDirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      doSave(currentLogs, status);
    }, SAVE_DEBOUNCE_MS);
  }, [doSave]);

  // 组件卸载时立即保存未持久化的日志
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (isDirtyRef.current && pendingLogsRef.current.length > 0) {
        doSave(pendingLogsRef.current);
      }
    };
  }, [doSave]);

  // 同步 state 到 pendingLogsRef 并安排保存
  const persistLogs = useCallback((newLogs: string[], status?: string) => {
    pendingLogsRef.current = newLogs.slice(-MAX_LOGS_PER_SESSION);
    scheduleSave(pendingLogsRef.current, status);
  }, [scheduleSave]);

  // 添加单条日志
  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString('zh-CN');
    const line = `[${timestamp}] ${message}`;
    setLogs((prev) => {
      const newLogs = [...prev, line].slice(-MAX_LOGS_PER_SESSION);
      persistLogs(newLogs);
      return newLogs;
    });
  }, [persistLogs]);

  // 批量添加日志（推荐用于 SSE 流式输入）
  const addLogs = useCallback((messages: string[]) => {
    if (!messages.length) return;
    const timestamp = new Date().toLocaleTimeString('zh-CN');
    const lines = messages.map((msg) => `[${timestamp}] ${msg}`);
    setLogs((prev) => {
      const newLogs = [...prev, ...lines].slice(-MAX_LOGS_PER_SESSION);
      persistLogs(newLogs);
      return newLogs;
    });
  }, [persistLogs]);

  // 设置日志（用于恢复外部来源的批量日志）
  const setLogLines = useCallback((newLogs: string[]) => {
    const trimmed = newLogs.slice(-MAX_LOGS_PER_SESSION);
    setLogs(trimmed);
    persistLogs(trimmed);
  }, [persistLogs]);

  // 清空日志
  const clearLogs = useCallback(() => {
    setLogs([]);
    pendingLogsRef.current = [];
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (sessionIdRef.current) {
      const storageKey = `${STORAGE_KEY_PREFIX}${sessionIdRef.current}`;
      localStorage.removeItem(storageKey);
    }
    isDirtyRef.current = false;
  }, []);

  // 更新状态
  const updateStatus = useCallback((status: string) => {
    if (!sessionIdRef.current) return;
    const storageKey = `${STORAGE_KEY_PREFIX}${sessionIdRef.current}`;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const session: LogSession = JSON.parse(stored);
        session.status = status as LogSession['status'];
        session.lastUpdateTime = new Date().toISOString();
        localStorage.setItem(storageKey, JSON.stringify(session));
      }
    } catch {
      // 忽略错误
    }
  }, []);

  // 设置新的会话ID
  const setSessionId = useCallback((newSessionId: string) => {
    sessionIdRef.current = newSessionId;
  }, []);

  return {
    logs,
    isRestored,
    addLog,
    addLogs,
    setLogLines,
    clearLogs,
    updateStatus,
    setSessionId,
  };
}

/**
 * 清理旧的日志会话（保留最近7天）
 */
function clearOldLogs() {
  const sevenDaysAgo = Date.now() - SESSION_TTL_MS;
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const session: LogSession = JSON.parse(stored);
          const lastUpdate = safeParseTime(session.lastUpdateTime);
          if (lastUpdate < sevenDaysAgo) {
            keysToRemove.push(key);
          }
        }
      } catch {
        // 解析失败的也删除
        keysToRemove.push(key);
      }
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));
  console.log(`[日志持久化] 清理了 ${keysToRemove.length} 个过期的日志会话`);
}

/**
 * 获取所有活跃的日志会话
 */
export function getActiveLogSessions(): LogSession[] {
  const sessions: LogSession[] = [];
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const session: LogSession = JSON.parse(stored);
          const lastUpdate = safeParseTime(session.lastUpdateTime);
          if (lastUpdate > oneHourAgo && session.status === 'generating') {
            sessions.push(session);
          }
        }
      } catch {
        // 忽略解析错误
      }
    }
  }

  return sessions.sort((a, b) => safeParseTime(b.lastUpdateTime) - safeParseTime(a.lastUpdateTime));
}

function safeParseTime(value: string | undefined): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}
