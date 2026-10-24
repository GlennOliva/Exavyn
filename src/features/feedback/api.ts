import { supabase } from '../../lib/supabase';
import { toAppError } from '../../lib/errors';
import type { FeedbackCategory, FeedbackStatus } from '../../lib/database.types';

export interface FeedbackItem {
  id: string;
  student_id?: string;
  submitter_name?: string;
  category: FeedbackCategory;
  subject: string;
  message: string;
  rating: number | null;
  status: FeedbackStatus;
  course_id: string | null;
  course_title: string | null;
  exam_id: string | null;
  exam_title: string | null;
  question_id: string | null;
  staff_notes?: string | null;
  response: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackPageResult {
  rows: FeedbackItem[];
  total: number;
  page: number;
  page_size: number;
}

export async function submitFeedback(input: {
  category: FeedbackCategory;
  subject: string;
  message: string;
  rating: number | null;
  courseId?: string | null;
  examId?: string | null;
  questionId?: string | null;
  requestId: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('submit_feedback', {
    p_category: input.category,
    p_subject: input.subject,
    p_message: input.message,
    p_rating: input.rating,
    p_course_id: input.courseId ?? null,
    p_exam_id: input.examId ?? null,
    p_question_id: input.questionId ?? null,
    p_request_id: input.requestId,
  });
  if (error) throw toAppError(error);
  return data;
}

async function getFeedbackPage(
  rpc: 'get_my_feedback_page' | 'get_staff_feedback_page',
  input: { q: string; status: string; page: number; pageSize: number },
): Promise<FeedbackPageResult> {
  const { data, error } = await supabase.rpc(rpc, {
    p_search: input.q,
    p_status: input.status,
    p_page: input.page,
    p_page_size: input.pageSize,
  });
  if (error) throw toAppError(error);
  return data as unknown as FeedbackPageResult;
}

export const getMyFeedbackPage = (input: { q: string; status: string; page: number; pageSize: number }) =>
  getFeedbackPage('get_my_feedback_page', input);

export const getStaffFeedbackPage = (input: { q: string; status: string; page: number; pageSize: number }) =>
  getFeedbackPage('get_staff_feedback_page', input);

export async function updateFeedback(input: {
  id: string;
  status: FeedbackStatus;
  staffNotes: string;
  response: string;
}): Promise<void> {
  const { error } = await supabase.rpc('update_feedback', {
    p_feedback_id: input.id,
    p_status: input.status,
    p_staff_notes: input.staffNotes,
    p_response: input.response,
  });
  if (error) throw toAppError(error);
}
