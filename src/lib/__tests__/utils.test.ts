import { describe, it, expect } from 'vitest';
import { cn } from '../utils';

describe('cn utility', () => {
  it('merges class names', () => {
    const result = cn('foo', 'bar');
    expect(result).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    const include = true;
    const exclude = false;
    const result = cn('base', include && 'included', exclude && 'excluded');
    expect(result).toBe('base included');
  });

  it('handles undefined values', () => {
    const result = cn('base', undefined, 'other');
    expect(result).toBe('base other');
  });

  it('handles null values', () => {
    const result = cn('base', null, 'other');
    expect(result).toBe('base other');
  });

  it('handles array of classes', () => {
    const result = cn(['foo', 'bar']);
    expect(result).toBe('foo bar');
  });

  it('handles object syntax', () => {
    const result = cn({ foo: true, bar: false, baz: true });
    expect(result).toBe('foo baz');
  });

  it('merges Tailwind conflicting classes', () => {
    // twMerge should resolve conflicts, keeping the last one
    const result = cn('p-4', 'p-8');
    expect(result).toBe('p-8');
  });

  it('merges multiple Tailwind class conflicts', () => {
    const result = cn('bg-red-500', 'bg-blue-500');
    expect(result).toBe('bg-blue-500');
  });

  it('preserves non-conflicting Tailwind classes', () => {
    const result = cn('p-4', 'm-4', 'text-white');
    expect(result).toBe('p-4 m-4 text-white');
  });

  it('handles mixed input types', () => {
    const result = cn(
      'base',
      ['array', 'classes'],
      { conditional: true, excluded: false },
      undefined,
      'final'
    );
    expect(result).toBe('base array classes conditional final');
  });

  it('handles empty inputs', () => {
    const result = cn();
    expect(result).toBe('');
  });

  it('handles all falsy inputs', () => {
    const result = cn(false, null, undefined, 0, '');
    expect(result).toBe('');
  });
});
