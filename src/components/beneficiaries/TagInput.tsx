import { useMemo, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

type TagOption = {
  name: string;
  normalizedName?: string;
};

const normalizeTagName = (name: string) => name.trim().toLowerCase();

interface TagInputProps {
  availableTags: TagOption[];
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  allowCreate?: boolean;
  disabled?: boolean;
}

export function TagInput({
  availableTags,
  value,
  onChange,
  placeholder = 'Add tags...',
  allowCreate = true,
  disabled = false,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const selectedNormalized = useMemo(
    () => new Set(value.map((tag) => normalizeTagName(tag))),
    [value]
  );

  const normalizedInput = normalizeTagName(inputValue);

  const suggestions = useMemo(() => {
    if (!availableTags.length) return [];
    const filtered = availableTags.filter((tag) => {
      const normalized = normalizeTagName(tag.name);
      if (selectedNormalized.has(normalized)) return false;
      if (!normalizedInput) return true;
      return normalized.includes(normalizedInput);
    });
    return filtered.slice(0, 8);
  }, [availableTags, normalizedInput, selectedNormalized]);

  const exactMatch = useMemo(() => {
    if (!normalizedInput) return null;
    return (
      availableTags.find(
        (tag) => normalizeTagName(tag.name) === normalizedInput
      ) ?? null
    );
  }, [availableTags, normalizedInput]);

  const canCreate =
    allowCreate && !!inputValue.trim() && exactMatch == null;

  const addTag = (tagName: string) => {
    const normalized = normalizeTagName(tagName);
    if (!normalized || selectedNormalized.has(normalized)) return;
    onChange([...value, tagName]);
    setInputValue('');
    setIsOpen(false);
  };

  const removeTag = (tagName: string) => {
    const normalized = normalizeTagName(tagName);
    onChange(value.filter((tag) => normalizeTagName(tag) !== normalized));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (exactMatch) {
        addTag(exactMatch.name);
        return;
      }
      if (canCreate) {
        addTag(inputValue.trim());
      }
    }

    if (event.key === 'Backspace' && !inputValue && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  return (
    <div className="relative">
      <div
        className={cn(
          'flex min-h-[44px] flex-wrap items-center gap-2 rounded-lg border bg-navy-800 px-3 py-2 text-sm text-white',
          disabled ? 'opacity-60' : '',
          'border-white/10 focus-within:border-accent-500 focus-within:ring-1 focus-within:ring-accent-500'
        )}
        onClick={() => {
          if (!disabled) setIsOpen(true);
        }}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-navy-700 px-2.5 py-1 text-xs text-slate-200"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  removeTag(tag);
                }}
                className="text-slate-400 hover:text-white"
                aria-label={`Remove ${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        <input
          type="text"
          value={inputValue}
          onChange={(event) => {
            setInputValue(event.target.value);
            setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 100)}
          placeholder={value.length === 0 ? placeholder : ''}
          disabled={disabled}
          className="flex-1 bg-transparent py-1 text-sm text-white placeholder-slate-500 focus:outline-none"
        />
      </div>

      {isOpen && !disabled && (suggestions.length > 0 || canCreate) && (
        <div className="absolute z-20 mt-2 w-full rounded-lg border border-white/10 bg-navy-900 shadow-lg">
          {suggestions.map((tag) => (
            <button
              key={tag.name}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => addTag(tag.name)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-200 hover:bg-navy-800"
            >
              <span>{tag.name}</span>
              <span className="text-xs text-slate-500">Select</span>
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => addTag(inputValue.trim())}
              className="flex w-full items-center gap-2 border-t border-white/5 px-3 py-2 text-left text-sm text-accent-300 hover:bg-navy-800"
            >
              <Plus className="h-4 w-4" />
              Create "{inputValue.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}
