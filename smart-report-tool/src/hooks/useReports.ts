import { useEffect } from 'react';
import { useReportStore } from '@/stores/reportStore';

export function useReports() {
  const { reports, loading, generationState, fetchReports, removeReport, setGenerationState, resetGenerationState } = useReportStore();

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  return { reports, loading, generationState, removeReport, setGenerationState, resetGenerationState, refreshReports: fetchReports };
}
