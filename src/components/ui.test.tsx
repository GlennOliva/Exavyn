import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert, Button, StatusBadge } from './ui';

describe('StatusBadge', () => {
  it('renders a human-readable label for a status value', () => {
    render(<StatusBadge status="in_progress" />);
    expect(screen.getByText('in progress')).toBeInTheDocument();
  });

  it('renders submitted attempts', () => {
    render(<StatusBadge status="submitted" />);
    expect(screen.getByText('submitted')).toBeInTheDocument();
  });
});

describe('Button', () => {
  it('applies variant and size classes', () => {
    render(<Button variant="primary" size="sm" />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('btn', 'btn-primary', 'btn-sm');
  });

  it('passes through the disabled attribute', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('Alert', () => {
  it('exposes an alert role when requested', () => {
    render(<Alert tone="danger" role="alert">Something failed</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Something failed');
  });

  it('defaults to the status role', () => {
    render(<Alert>Saved</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
});
