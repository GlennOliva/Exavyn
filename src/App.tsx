import { Link, createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './features/auth/AuthContext';
import { ThemeProvider } from './features/theme/ThemeContext';
import { AppShell } from './components/layout/AppShell';
import { RequireAuth, RequireRole, RoleHomeRedirect } from './components/guards';
import { EmptyState } from './components/ui';

import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { UpdatePasswordPage } from './pages/auth/UpdatePasswordPage';
import { ProfilePage } from './pages/ProfilePage';
import { FeedbackPage } from './pages/FeedbackPage';

import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminCoursesPage } from './pages/admin/AdminCoursesPage';
import { AdminExamsPage } from './pages/admin/AdminExamsPage';
import { AdminReportsPage } from './pages/admin/AdminReportsPage';
import { AdminAuditPage } from './pages/admin/AdminAuditPage';

import { TeacherDashboard } from './pages/teacher/TeacherDashboard';
import { TeacherCoursesPage } from './pages/teacher/TeacherCoursesPage';
import { TeacherCourseDetailPage } from './pages/teacher/TeacherCourseDetailPage';
import { ExamBuilderPage } from './pages/teacher/ExamBuilderPage';
import { ExamResultsPage } from './pages/teacher/ExamResultsPage';
import { AttemptDetailPage } from './pages/teacher/AttemptDetailPage';

import { StudentDashboard } from './pages/student/StudentDashboard';
import { JoinCoursePage } from './pages/student/JoinCoursePage';
import { StudentCoursePage } from './pages/student/StudentCoursePage';
import { ExamInstructionsPage } from './pages/student/ExamInstructionsPage';
import { ExamPage } from './pages/student/ExamPage';
import { ResultPage } from './pages/student/ResultPage';
import { AttemptReviewPage } from './pages/student/AttemptReviewPage';
import { HistoryPage } from './pages/student/HistoryPage';

function NotFound() {
  return (
    <div className="app-main">
      <EmptyState title="Page not found">
        <p className="muted">The page you requested does not exist.</p>
        <Link className="btn btn-primary" to="/">
          Return home
        </Link>
      </EmptyState>
    </div>
  );
}

// A data router is required so the exam interface can use useBlocker to guard
// in-attempt navigation (SOP req 119 / acceptance 13).
const router = createBrowserRouter([
  // Public
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/update-password', element: <UpdatePasswordPage /> },

  // Fullscreen exam interface — no application chrome
  {
    element: <RequireAuth />,
    children: [
      {
        element: <RequireRole roles={['student']} />,
        children: [{ path: '/student/exams/:examId/take', element: <ExamPage /> }],
      },
    ],
  },

  // Authenticated application shell
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <RoleHomeRedirect /> },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/feedback', element: <FeedbackPage /> },

          {
            element: <RequireRole roles={['admin']} />,
            children: [
              { path: '/admin', element: <AdminDashboard /> },
              { path: '/admin/users', element: <AdminUsersPage /> },
              { path: '/admin/courses', element: <AdminCoursesPage /> },
              { path: '/admin/exams', element: <AdminExamsPage /> },
              { path: '/admin/reports', element: <AdminReportsPage /> },
              { path: '/admin/audit', element: <AdminAuditPage /> },
            ],
          },

          {
            element: <RequireRole roles={['teacher']} />,
            children: [
              { path: '/teacher', element: <TeacherDashboard /> },
              { path: '/teacher/courses', element: <TeacherCoursesPage /> },
              { path: '/teacher/courses/:courseId', element: <TeacherCourseDetailPage /> },
              { path: '/teacher/exams/new', element: <ExamBuilderPage /> },
              { path: '/teacher/exams/:examId/edit', element: <ExamBuilderPage /> },
              { path: '/teacher/exams/:examId/results', element: <ExamResultsPage /> },
              { path: '/teacher/attempts/:attemptId', element: <AttemptDetailPage /> },
            ],
          },

          {
            element: <RequireRole roles={['student']} />,
            children: [
              { path: '/student', element: <StudentDashboard /> },
              { path: '/student/join', element: <JoinCoursePage /> },
              { path: '/student/courses/:courseId', element: <StudentCoursePage /> },
              { path: '/student/exams/:examId', element: <ExamInstructionsPage /> },
              { path: '/student/attempts/:attemptId/result', element: <ResultPage /> },
              { path: '/student/attempts/:attemptId/review', element: <AttemptReviewPage /> },
              { path: '/student/history', element: <HistoryPage /> },
            ],
          },

          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>
  );
}
