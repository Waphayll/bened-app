import { useEffect, useId, useMemo, useRef, useState } from 'react';

function normalizeLookup(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function getNextEnabledIndex(options, startIndex, direction) {
  if (!Array.isArray(options) || options.length === 0) return -1;

  let index = startIndex;
  for (let attempt = 0; attempt < options.length; attempt += 1) {
    index += direction;

    if (index < 0) index = options.length - 1;
    if (index >= options.length) index = 0;

    if (!options[index]?.disabled) {
      return index;
    }
  }

  return -1;
}

export default function TypeaheadSelect({
  className = '',
  disabled = false,
  emptyMessage = 'No matches found.',
  onQueryChange,
  onSelect,
  options = [],
  placeholder = 'Search items',
  query,
  title,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const rootRef = useRef(null);
  const listboxId = useId();

  const filteredOptions = useMemo(() => {
    const needle = normalizeLookup(query);
    const resolved = !needle
      ? options
      : options.filter((option) => normalizeLookup(option.searchText || option.label || option.value).includes(needle));

    return resolved.slice(0, 12);
  }, [options, query]);

  useEffect(() => {
    if (!isOpen) {
      setHighlightedIndex(-1);
      return;
    }

    const firstEnabledIndex = filteredOptions.findIndex((option) => !option.disabled);
    setHighlightedIndex(firstEnabledIndex);
  }, [filteredOptions, isOpen]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const commitSelection = (option) => {
    if (!option || option.disabled) return;
    onSelect(option.value);
    setIsOpen(false);
  };

  return (
    <div className={`typeahead-shell ${className}`.trim()} ref={rootRef}>
      <input
        type="text"
        className="typeahead-input"
        value={query}
        onChange={(event) => {
          onQueryChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          if (!disabled) setIsOpen(true);
        }}
        onKeyDown={(event) => {
          if (disabled) return;

          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsOpen(true);
            setHighlightedIndex((current) => getNextEnabledIndex(filteredOptions, current, 1));
            return;
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIsOpen(true);
            setHighlightedIndex((current) => (
              current < 0
                ? getNextEnabledIndex(filteredOptions, filteredOptions.length, -1)
                : getNextEnabledIndex(filteredOptions, current, -1)
            ));
            return;
          }

          if (event.key === 'Enter' && isOpen && highlightedIndex >= 0) {
            event.preventDefault();
            commitSelection(filteredOptions[highlightedIndex]);
            return;
          }

          if (event.key === 'Escape') {
            setIsOpen(false);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        title={title}
        autoComplete="off"
        spellCheck="false"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-haspopup="listbox"
      />

      {isOpen && !disabled && (
        <div className="typeahead-menu" id={listboxId} role="listbox">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => (
              <button
                type="button"
                key={option.value}
                role="option"
                aria-selected={highlightedIndex === index}
                className={[
                  'typeahead-option',
                  highlightedIndex === index ? 'is-highlighted' : '',
                  option.disabled ? 'is-disabled' : '',
                ].filter(Boolean).join(' ')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commitSelection(option)}
                onMouseEnter={() => {
                  if (!option.disabled) setHighlightedIndex(index);
                }}
                disabled={option.disabled}
              >
                <span className="typeahead-option-label">{option.label}</span>
                {option.meta && <span className="typeahead-option-meta">{option.meta}</span>}
              </button>
            ))
          ) : (
            <div className="typeahead-empty">{emptyMessage}</div>
          )}
        </div>
      )}
    </div>
  );
}
