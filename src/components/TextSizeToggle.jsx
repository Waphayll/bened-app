import { useUiPreferences } from '../lib/UiPreferencesContext';

export default function TextSizeToggle({ className = '' }) {
  const { textSize, setTextSize } = useUiPreferences();

  return (
    <div className={`text-size-toggle ${className}`.trim()} role="group" aria-label="Text size">
      <span className="text-size-toggle-label">Text Size</span>
      <button
        type="button"
        className={`text-size-toggle-btn ${textSize === 'default' ? 'active' : ''}`}
        onClick={() => setTextSize('default')}
        aria-pressed={textSize === 'default'}
      >
        Default
      </button>
      <button
        type="button"
        className={`text-size-toggle-btn ${textSize === 'large' ? 'active' : ''}`}
        onClick={() => setTextSize('large')}
        aria-pressed={textSize === 'large'}
      >
        Large
      </button>
    </div>
  );
}
