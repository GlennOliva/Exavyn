/**
 * Hand-maintained database types describing the public schema, the RPC
 * functions, and the enums created by the versioned migrations. Kept in sync
 * with `supabase/migrations` by convention.
 *
 * Row shapes are declared as `type` aliases (never `interface`) so they carry
 * an implicit index signature and satisfy the `GenericSchema` constraint that
 * `supabase-js` places on the `Database` generic.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AppRole = 'admin' | 'teacher' | 'student';
export type AccountStatus = 'active' | 'suspended';
export type EnrollmentStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export type ExamState = 'draft' | 'published' | 'archived';
export type AttemptState = 'in_progress' | 'submitted';
export type SubmissionReason = 'manual' | 'violation_limit' | 'time_expired';
export type ResultReleasePolicy = 'immediate' | 'after_close' | 'scheduled';
export type MultiAttemptPolicy = 'latest' | 'highest';
export type AnswerReviewPolicy = 'immediate' | 'after_attempts' | 'after_close' | 'never' | 'scheduled';
export type FeedbackCategory = 'bug' | 'suggestion' | 'exam_concern' | 'other';
export type FeedbackStatus = 'new' | 'in_review' | 'resolved';
export type FeedbackRecipient = 'administration' | 'course_teacher';

export type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string;
  status: AccountStatus;
  created_at: string;
  updated_at: string;
};

export type UserRoleRow = {
  user_id: string;
  role: AppRole;
  granted_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CourseRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  section: string;
  academic_term: string;
  course_code: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type CourseJoinCodeRow = {
  id: string;
  course_id: string;
  code_hash: string;
  code_hint: string;
  code_cipher: string | null;
  active: boolean;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  rotated_at: string | null;
};

export type EnrollmentRow = {
  id: string;
  course_id: string;
  student_id: string;
  status: EnrollmentStatus;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
};

export type ExamRow = {
  id: string;
  course_id: string;
  owner_id: string;
  title: string;
  instructions: string;
  duration_minutes: number;
  opens_at: string;
  closes_at: string;
  question_randomization: boolean;
  option_randomization: boolean;
  result_release: ResultReleasePolicy;
  violation_threshold: number;
  max_attempts: number;
  result_policy: MultiAttemptPolicy;
  answer_review: AnswerReviewPolicy;
  pass_threshold: number | null;
  result_release_at: string | null;
  answer_release_at: string | null;
  timezone: string;
  state: ExamState;
  current_version_id: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type ExamVersionRow = {
  id: string;
  exam_id: string;
  version_no: number;
  title: string;
  instructions: string;
  duration_minutes: number;
  opens_at: string;
  closes_at: string;
  question_randomization: boolean;
  option_randomization: boolean;
  result_release: ResultReleasePolicy;
  violation_threshold: number;
  max_attempts: number;
  result_policy: MultiAttemptPolicy;
  answer_review: AnswerReviewPolicy;
  pass_threshold: number | null;
  item_count: number;
  max_score: number;
  frozen: boolean;
  published_at: string;
  published_by: string;
  created_at: string;
};

export type ExamQuestionRow = {
  id: string;
  exam_id: string;
  version_id: string | null;
  position: number;
  prompt: string;
  points: number;
  explanation: string;
  created_at: string;
};

export type QuestionOptionRow = {
  id: string;
  question_id: string;
  position: number;
  label: string;
  created_at: string;
};

export type AnswerKeyRow = {
  question_id: string;
  correct_option_id: string;
  points: number;
  created_at: string;
};

export type ExamAttemptRow = {
  id: string;
  exam_id: string;
  exam_version_id: string;
  student_id: string;
  state: AttemptState;
  started_at: string;
  deadline_at: string;
  violation_count: number;
  question_order: Json;
  option_order: Json;
  attempt_no: number;
  result_release: ResultReleasePolicy;
  answer_review: AnswerReviewPolicy;
  pass_threshold: number | null;
  result_release_at: string | null;
  answer_release_at: string | null;
  timezone: string | null;
  controller_token: string;
  controller_lease_expires_at: string;
  submitted_at: string | null;
  submission_reason: SubmissionReason | null;
  earned_points: number | null;
  max_points: number | null;
  percentage: number | null;
  answered_count: number | null;
  correct_count: number | null;
  result_released_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AttemptAnswerRow = {
  id: string;
  attempt_id: string;
  question_id: string;
  selected_option_id: string | null;
  revision: number;
  request_id: string;
  answered_at: string;
};

export type ViolationEventRow = {
  id: number;
  attempt_id: string;
  episode_id: string;
  signals: string[];
  observed_at: string | null;
  received_at: string;
  details: Json;
};

export type AttemptHeartbeatRow = {
  attempt_id: string;
  last_seen_at: string;
  client_seq: number;
};

export type AuditLogRow = {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Json;
  created_at: string;
};

export type FeedbackRow = {
  id: string;
  exam_id: string | null;
  course_id: string | null;
  question_id: string | null;
  student_id: string;
  category: FeedbackCategory;
  subject: string;
  message: string;
  rating: number | null;
  comment: string | null;
  status: FeedbackStatus;
  staff_notes: string | null;
  response: string | null;
  recipient_type: FeedbackRecipient;
  recipient_teacher_id: string | null;
  student_read_at: string | null;
  staff_read_at: string | null;
  response_updated_at: string | null;
  request_id: string;
  created_at: string;
  updated_at: string;
};

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      user_roles: Table<UserRoleRow>;
      courses: Table<CourseRow>;
      course_join_codes: Table<CourseJoinCodeRow>;
      enrollments: Table<EnrollmentRow>;
      exams: Table<ExamRow>;
      exam_versions: Table<ExamVersionRow>;
      exam_questions: Table<ExamQuestionRow>;
      question_options: Table<QuestionOptionRow>;
      answer_keys: Table<AnswerKeyRow>;
      exam_attempts: Table<ExamAttemptRow>;
      attempt_answers: Table<AttemptAnswerRow>;
      violation_events: Table<ViolationEventRow>;
      attempt_heartbeats: Table<AttemptHeartbeatRow>;
      attempt_bookmarks: Table<{
        Row: { id: string; attempt_id: string; question_id: string; created_at: string };
        Insert: { id?: string; attempt_id: string; question_id: string; created_at?: string };
        Update: Partial<{ id: string; attempt_id: string; question_id: string; created_at: string }>;
      }>;
      exam_feedback: Table<FeedbackRow>;
      audit_logs: Table<AuditLogRow>;
    };
    Views: Record<string, never>;
    Functions: {
      create_course: {
        Args: {
          p_title: string;
          p_description: string;
          p_section: string;
          p_academic_term: string;
          p_course_code: string;
        };
        Returns: Json;
      };
      rotate_join_code: { Args: { p_course_id: string }; Returns: string };
      request_enrollment: { Args: { p_join_code: string }; Returns: Json };
      decide_enrollment: {
        Args: { p_enrollment_id: string; p_decision: string };
        Returns: Json;
      };
      save_exam_draft: {
        Args: { p_exam_id: string | null; p_payload: Json };
        Returns: string;
      };
      publish_exam: { Args: { p_exam_id: string }; Returns: string };
      archive_exam: { Args: { p_exam_id: string }; Returns: undefined };
      duplicate_exam: { Args: { p_exam_id: string }; Returns: string };
      update_course: {
        Args: {
          p_course_id: string;
          p_title: string;
          p_description: string;
          p_section: string;
          p_academic_term: string;
        };
        Returns: undefined;
      };
      set_course_archived: { Args: { p_course_id: string; p_archived: boolean }; Returns: undefined };
      delete_course: { Args: { p_course_id: string }; Returns: undefined };
      update_exam_settings: {
        Args: {
          p_exam_id: string;
          p_title: string;
          p_instructions: string;
          p_opens_at: string;
          p_closes_at: string;
          p_duration_minutes: number;
          p_result_release: ResultReleasePolicy;
          p_max_attempts: number;
          p_result_policy: MultiAttemptPolicy;
          p_answer_review: AnswerReviewPolicy;
          p_pass_threshold: number | null;
          p_result_release_at?: string | null;
          p_answer_release_at?: string | null;
          p_timezone?: string;
        };
        Returns: undefined;
      };
      restore_exam: { Args: { p_exam_id: string }; Returns: undefined };
      delete_exam: { Args: { p_exam_id: string }; Returns: undefined };
      get_join_code: { Args: { p_course_id: string }; Returns: Json };
      get_my_exam_attempts: { Args: { p_exam_id: string }; Returns: Json };
      get_my_results: { Args: Record<string, never>; Returns: Json };
      get_my_results_page: {
        Args: { p_search?: string; p_page?: number; p_page_size?: number };
        Returns: Json;
      };
      start_attempt: {
        Args: { p_exam_id: string; p_current_token?: string | null };
        Returns: Json;
      };
      acquire_attempt_controller: {
        Args: { p_attempt_id: string; p_current_token: string | null };
        Returns: Json;
      };
      get_attempt_payload: { Args: { p_attempt_id: string }; Returns: Json };
      save_answer: {
        Args: {
          p_attempt_id: string;
          p_question_id: string;
          p_option_id: string | null;
          p_revision: number;
          p_request_id: string;
          p_controller_token: string;
        };
        Returns: Json;
      };
      record_violation: {
        Args: {
          p_attempt_id: string;
          p_episode_id: string;
          p_signals: string[];
          p_observed_at: string;
          p_controller_token: string;
        };
        Returns: Json;
      };
      submit_attempt: {
        Args: { p_attempt_id: string; p_controller_token: string };
        Returns: Json;
      };
      get_result: { Args: { p_attempt_id: string }; Returns: Json };
      get_attempt_release_status: { Args: { p_attempt_id: string }; Returns: Json };
      get_attempt_review: { Args: { p_attempt_id: string }; Returns: Json };
      heartbeat: {
        Args: { p_attempt_id: string; p_controller_token: string; p_seq: number };
        Returns: undefined;
      };
      finalize_expired_attempts: { Args: Record<string, never>; Returns: number };
      admin_set_account_status: {
        Args: { p_user_id: string; p_status: AccountStatus };
        Returns: undefined;
      };
      admin_set_role: {
        Args: { p_user_id: string; p_role: AppRole };
        Returns: undefined;
      };
      admin_dashboard_stats: { Args: Record<string, never>; Returns: Json };
      toggle_bookmark: { Args: { p_attempt_id: string; p_question_id: string; p_controller_token: string }; Returns: Json };
      get_bookmarks: { Args: { p_attempt_id: string; p_controller_token: string }; Returns: Json };
      submit_feedback: {
        Args: {
          p_category: string;
          p_subject: string;
          p_message: string;
          p_rating?: number | null;
          p_course_id?: string | null;
          p_exam_id?: string | null;
          p_question_id?: string | null;
          p_recipient_type?: FeedbackRecipient;
          p_request_id?: string;
        };
        Returns: string;
      };
      get_my_feedback_page: { Args: { p_search?: string; p_status?: string; p_page?: number; p_page_size?: number }; Returns: Json };
      get_staff_feedback_page: {
        Args: {
          p_search?: string;
          p_status?: string;
          p_recipient?: string;
          p_unread_only?: boolean;
          p_page?: number;
          p_page_size?: number;
        };
        Returns: Json;
      };
      update_feedback: { Args: { p_feedback_id: string; p_status: string; p_staff_notes: string; p_response: string }; Returns: undefined };
      mark_my_feedback_read: { Args: { p_feedback_id: string }; Returns: undefined };
      mark_feedback_read: { Args: { p_feedback_id: string }; Returns: undefined };
      get_feedback_unread_counts: { Args: Record<string, never>; Returns: Json };
      get_feedback_summary: { Args: { p_exam_id: string }; Returns: Json };
      recompute_answered_count: { Args: { p_attempt_id: string }; Returns: number };
    };
    Enums: {
      app_role: AppRole;
      account_status: AccountStatus;
      enrollment_status: EnrollmentStatus;
      exam_state: ExamState;
      attempt_state: AttemptState;
      submission_reason: SubmissionReason;
      result_release_policy: ResultReleasePolicy;
      multi_attempt_policy: MultiAttemptPolicy;
      answer_review_policy: AnswerReviewPolicy;
    };
    CompositeTypes: Record<string, never>;
  };
};
