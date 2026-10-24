import { useCallback, useEffect, useRef, useState } from 'react';
import { DepartureTracker } from './dedupe';
import type { ViolationSignal } from './types';
import { recordViolation, sendHeartbeat } from '../attempts/api';
import {
  enqueuePending,
  loadPending,
  removePending,
} from './reportQueue';
import type { ViolationResult } from '../attempts/types';
import { FOCUS_LOSS_GRACE_MS, VIOLATION_THRESHOLD } from '../../lib/config';

export interface UseExamMonitorOptions {
  attemptId: string | null;
  controllerToken: string | null;
  initialViolationCount: number;
  threshold?: number;
  enabled: boolean;
  /**
   * Whether recovery requires native fullscreen. Devices using the accessible
   * viewport fallback pass `false`: visibility and focus are still monitored,
   * but the absence of the Fullscreen API never blocks recovery or counts as a
   * departure.
   */
  fullscreenRequired?: boolean;
  onViolation?: (result: ViolationResult) => void;
}

export interface ExamMonitorApi {
  violationCount: number;
  threshold: number;
  warningVisible: boolean;
  interactionLocked: boolean;
  pendingSubmission: boolean;
  isFinalized: boolean;
  /** Another same-browser tab reported holding the controller for this attempt. */
  crossTabBlocked: boolean;
  lastError: string | null;
  acknowledgeWarning: () => void;
  reportNavigationBlocked: () => boolean;
  flushPending: () => Promise<void>;
}

export function useExamMonitor(options: UseExamMonitorOptions): ExamMonitorApi {
  const {
    attemptId,
    controllerToken,
    initialViolationCount,
    threshold = VIOLATION_THRESHOLD,
    enabled,
    fullscreenRequired = true,
    onViolation,
  } = options;

  const trackerRef = useRef(new DepartureTracker());
  const onViolationRef = useRef(onViolation);

  const [violationCount, setViolationCount] = useState(initialViolationCount);
  const [pendingCount, setPendingCount] = useState(0);
  const [warningAck, setWarningAck] = useState(initialViolationCount > 0);
  const [isFinalized, setIsFinalized] = useState(false);
  const [crossTabBlocked, setCrossTabBlocked] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [syncedInitial, setSyncedInitial] = useState(initialViolationCount);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  // Adjust state when the server-provided baseline changes (React's documented
  // "adjusting state when a prop changes" pattern).
  if (syncedInitial !== initialViolationCount) {
    setSyncedInitial(initialViolationCount);
    setViolationCount(initialViolationCount);
    setWarningAck(initialViolationCount > 0);
  }

  const applyResult = useCallback((result: ViolationResult) => {
    setViolationCount((prev) => Math.max(prev, result.violation_count));
    if (result.finalized && result.attempt_state === 'submitted') {
      setIsFinalized(true);
    }
    onViolationRef.current?.(result);
  }, []);

  const flushPending = useCallback(async () => {
    if (!attemptId || !controllerToken) return;
    let queue = loadPending(attemptId);
    setPendingCount(queue.length);

    while (queue.length > 0) {
      const report = queue[0];
      try {
        const result = await recordViolation({
          attemptId,
          episodeId: report.episodeId,
          signals: report.signals,
          observedAt: report.observedAt,
          controllerToken,
        });
        if (result.error === 'controller') {
          setLastError('This attempt is active in another session.');
          break;
        }
        queue = removePending(attemptId, report.episodeId);
        setPendingCount(queue.length);
        applyResult(result);
        setLastError(null);
        if (result.finalized) break;
      } catch {
        setLastError('Submission pending — reconnect to confirm.');
        break;
      }
    }
    setPendingCount(loadPending(attemptId).length);
  }, [attemptId, controllerToken, applyResult]);

  const emitDeparture = useCallback(
    (signal: ViolationSignal) => {
      if (!attemptId) return;
      const result = trackerRef.current.onDepartureSignal(signal);
      if (!result.isNewEpisode) return;
      enqueuePending(attemptId, {
        episodeId: result.episode.episodeId,
        signals: [...result.episode.signals],
        observedAt: new Date(result.episode.firstSignalAt).toISOString(),
      });
      trackerRef.current.markReported(result.episode.episodeId);
      setPendingCount(loadPending(attemptId).length);
      void flushPending();
    },
    [attemptId, flushPending],
  );

  const observeRecovery = useCallback(() => {
    trackerRef.current.observeRecovery({
      visible: document.visibilityState === 'visible',
      focused: document.hasFocus(),
      // In fallback mode there is no fullscreen requirement, so recovery must
      // succeed when the page is visible and focused again.
      fullscreen: !fullscreenRequired || Boolean(document.fullscreenElement),
    });
  }, [fullscreenRequired]);

  // Browser listeners. Removed the moment the attempt is finalized so cleanup
  // during exit/navigation cannot create another episode.
  useEffect(() => {
    if (!enabled || !attemptId || !controllerToken || isFinalized) return;

    let focusTimer: number | undefined;

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') emitDeparture('visibility_hidden');
      else observeRecovery();
    };
    const onBlur = () => {
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        if (!document.hasFocus()) emitDeparture('focus_lost');
      }, FOCUS_LOSS_GRACE_MS);
    };
    const onFocus = () => {
      window.clearTimeout(focusTimer);
      observeRecovery();
    };
    const onFullscreenChange = () => {
      // A device using the accessible fallback must never be penalised for the
      // absence of the Fullscreen API. Only listen when fullscreen is required.
      if (!fullscreenRequired) return;
      if (!document.fullscreenElement) emitDeparture('fullscreen_exit');
      else observeRecovery();
    };
    const onOnline = () => void flushPending();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('online', onOnline);

    let heartbeatSeq = 0;
    const heartbeatTimer = window.setInterval(() => {
      heartbeatSeq += 1;
      void sendHeartbeat(attemptId, controllerToken, heartbeatSeq).catch(() => undefined);
    }, 15000);

    const flushTimer = window.setInterval(() => void flushPending(), 8000);

    // Best-effort same-browser coordination only (not a security boundary).
    // Tabs announce the controller token they hold and any finalization, so an
    // accidental duplicate tab can lock itself instead of racing the server.
    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(`ace-attempt-${attemptId}`);
      channelRef.current = channel;
      channel.onmessage = (event: MessageEvent) => {
        const msg = event.data as { type?: unknown; token?: unknown } | null;
        if (!msg || typeof msg !== 'object') return;
        if (
          msg.type === 'controller-taken' &&
          typeof msg.token === 'string' &&
          msg.token !== controllerToken
        ) {
          setCrossTabBlocked(true);
        }
        if (msg.type === 'finalized') setIsFinalized(true);
      };
      channel.postMessage({ type: 'controller-taken', token: controllerToken, at: Date.now() });
    }

    return () => {
      window.clearTimeout(focusTimer);
      window.clearInterval(heartbeatTimer);
      window.clearInterval(flushTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('online', onOnline);
      channel?.close();
      channelRef.current = null;
    };
  }, [enabled, attemptId, controllerToken, isFinalized, fullscreenRequired, emitDeparture, observeRecovery, flushPending]);

  // Let any other same-browser tab know the attempt is over.
  useEffect(() => {
    if (!isFinalized) return;
    channelRef.current?.postMessage({ type: 'finalized', at: Date.now() });
  }, [isFinalized]);

  // Reconcile any reports that survived a reload. `flushPending` refreshes the
  // pending count from storage as its first step.
  useEffect(() => {
    if (!enabled || !attemptId || !controllerToken) return;
    void flushPending();
  }, [enabled, attemptId, controllerToken, flushPending]);

  const acknowledgeWarning = useCallback(() => {
    setWarningAck(true);
  }, []);

  const reportNavigationBlocked = useCallback((): boolean => {
    if (!attemptId) return false;
    const result = trackerRef.current.onDepartureSignal('navigation_attempt');
    if (result.isNewEpisode) {
      enqueuePending(attemptId, {
        episodeId: result.episode.episodeId,
        signals: [...result.episode.signals],
        observedAt: new Date(result.episode.firstSignalAt).toISOString(),
      });
      setPendingCount(loadPending(attemptId).length);
      void flushPending();
    }
    observeRecovery();
    return result.isNewEpisode;
  }, [attemptId, flushPending, observeRecovery]);

  const optimisticCount = violationCount + pendingCount;
  const pendingSubmission = pendingCount > 0 && optimisticCount >= threshold;
  const warningVisible = violationCount === 1 && !warningAck && !isFinalized;
  const lockedByCount = violationCount >= threshold;
  const interactionLocked =
    isFinalized ||
    pendingSubmission ||
    lockedByCount ||
    crossTabBlocked ||
    (violationCount >= 1 && !warningAck);

  return {
    violationCount,
    threshold,
    warningVisible,
    interactionLocked,
    pendingSubmission,
    isFinalized,
    crossTabBlocked,
    lastError,
    acknowledgeWarning,
    reportNavigationBlocked,
    flushPending,
  };
}
