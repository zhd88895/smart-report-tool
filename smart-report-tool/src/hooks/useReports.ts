import { useEffect } from 'react';
import { useReportStore } from '@/stores/reportStore';

export function useReports() {
  const { reports, loading, generationState, fetchReports, addReport, removeReport, setGenerationState, resetGenerationState, updateReportStatusState } = useReportStore();

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  return { reports, loading, generationState, addReport, removeReport, setGenerationState, resetGenerationState, updateReportStatusState, refreshReports: fetchReports };
}
