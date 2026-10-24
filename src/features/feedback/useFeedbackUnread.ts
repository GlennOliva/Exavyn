import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { FEEDBACK_UNREAD_EVENT } from './api';

interface UnreadCounts {
  student_unread?: number;
  staff_unread?: number;
}

/**
 * Unread feedback for the signed-in recipient. Refreshes on navigation, focus,
 * and after any read/submit/update action dispatches `FEEDBACK_UNREAD_EVENT`.
 * Failures stay silent: a missing counter must never break the shell.
 */
export function useFeedbackUnread(refreshKey?: string): number {
  const { user } = useAuth();
  const [counts, setCounts] = useState<UnreadCounts>({});

  const load = useCallback(() => {
    if (!user) return;
    void supabase
      .rpc('get_feedback_unread_counts')
      .then(({ data, error }) => {
        if (error) return;
        setCounts((data as unknown as UnreadCounts) ?? {});
      });
  }, [user]);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    window.addEventListener(FEEDBACK_UNREAD_EVENT, onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(FEEDBACK_UNREAD_EVENT, onFocus);
    };
  }, [load, refreshKey]);

  if (!user) return 0;
  return user.role === 'student' ? (counts.student_unread ?? 0) : (counts.staff_unread ?? 0);
}
