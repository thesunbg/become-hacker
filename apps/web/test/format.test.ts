import { describe, expect, it } from 'vitest';
import { formatDuration, levelProgress, rankForLevel, stars } from '../src/lib/format';
import { messageFrom } from '../src/lib/api';

describe('formatDuration', () => {
  it('formats under an hour as mm:ss', () => {
    expect(formatDuration(511)).toBe('08:31');
  });

  it('formats over an hour with hours', () => {
    expect(formatDuration(3_671)).toBe('1:01:11');
  });

  it('shows zero rather than nonsense for a missing value', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(-5)).toBe('00:00');
    expect(formatDuration(Number.NaN)).toBe('00:00');
  });
});

describe('stars', () => {
  it('fills the rating and leaves the rest empty', () => {
    expect(stars(3)).toBe('★★★☆☆');
  });

  it('clamps out-of-range ratings', () => {
    expect(stars(0)).toBe('☆☆☆☆☆');
    expect(stars(9)).toBe('★★★★★');
    expect(stars(-2)).toBe('☆☆☆☆☆');
  });
});

describe('progression re-exports', () => {
  it('uses the shared curve, so the client cannot disagree with the server', () => {
    expect(levelProgress(0).level).toBe(1);
    expect(levelProgress(250).level).toBe(2);
    expect(rankForLevel(5)).toBe('Hacker');
  });
});

describe('messageFrom', () => {
  it('reads a plain message', () => {
    expect(messageFrom({ message: 'Not signed in.' })).toBe('Not signed in.');
  });

  it('joins the array of messages a validation error returns', () => {
    expect(messageFrom({ message: ['Too short.', 'Invalid email.'] })).toBe(
      'Too short. Invalid email.',
    );
  });

  it('returns null when there is nothing useful to show', () => {
    expect(messageFrom(undefined)).toBeNull();
    expect(messageFrom(null)).toBeNull();
    expect(messageFrom({})).toBeNull();
    expect(messageFrom('a string')).toBeNull();
  });
});
