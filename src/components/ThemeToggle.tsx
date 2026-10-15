import { useTheme } from '../features/theme/ThemeContext';
import { THEME_MODES, type ThemeMode } from '../lib/theme';

const LABELS: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

/**
 * Accessible theme control. A plain in-page button group (no native popup, no
 * navigation), so it is safe to use inside the fullscreen exam without exiting
 * fullscreen or triggering a departure.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { mode, setMode } = useTheme();

  return (
    <div className={`theme-toggle ${className}`.trim()} role="group" aria-label="Color theme">
      {THEME_MODES.map((option) => (
        <button
          key={option}
          type="button"
          className="theme-option"
          aria-pressed={mode === option}
          title={`${LABELS[option]} theme`}
          onClick={() => setMode(option)}
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  );
}
