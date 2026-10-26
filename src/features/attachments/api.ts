import { supabase } from '../../lib/supabase';
import { toAppError } from '../../lib/errors';

export interface FeedbackAttachment {
  id: string;
  feedback_id: string;
  object_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

export async function requestFeedbackAttachmentUpload(params: {
  feedbackId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentType: string;
}): Promise<{ upload_url: string; object_path: string; attachment_id: string }> {
  const { data, error } = await supabase.rpc('request_feedback_attachment_upload', {
    p_feedback_id: params.feedbackId,
    p_file_name: params.fileName,
    p_mime_type: params.mimeType,
    p_size_bytes: params.sizeBytes,
    p_content_type: params.contentType,
  });
  if (error) throw toAppError(error);
  return data as unknown as { upload_url: string; object_path: string; attachment_id: string };
}

export async function confirmFeedbackAttachmentUpload(params: {
  attachmentId: string;
  feedbackId: string;
}): Promise<void> {
  const { error } = await supabase.rpc('confirm_feedback_attachment_upload', {
    p_attachment_id: params.attachmentId,
    p_feedback_id: params.feedbackId,
  });
  if (error) throw toAppError(error);
}

export async function getFeedbackAttachmentUrl(params: {
  attachmentId: string;
  feedbackId: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('get_feedback_attachment_url', {
    p_attachment_id: params.attachmentId,
    p_feedback_id: params.feedbackId,
  });
  if (error) throw toAppError(error);
  return data as string;
}

export async function listFeedbackAttachments(feedbackId: string): Promise<FeedbackAttachment[]> {
  const { data, error } = await supabase.rpc('list_feedback_attachments', {
    p_feedback_id: feedbackId,
  });
  if (error) throw toAppError(error);
  return (data as unknown as FeedbackAttachment[]) ?? [];
}

export async function deleteFeedbackAttachment(params: {
  attachmentId: string;
  feedbackId: string;
}): Promise<void> {
  const { error } = await supabase.rpc('delete_feedback_attachment', {
    p_attachment_id: params.attachmentId,
    p_feedback_id: params.feedbackId,
  });
  if (error) throw toAppError(error);
}
