import { describe, expect, it } from 'vitest';
import { isValidVideoId, parseYouTubeInput } from '../src/youtube';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeInput', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=42s`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=abc`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube-nocookie.com/embed/${ID}`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`youtube.com/watch?v=${ID}`],
    [`youtu.be/${ID}`],
    [`  https://youtu.be/${ID}  `],
    [ID],
  ])('accepts %s', (input) => {
    expect(parseYouTubeInput(input)).toBe(ID);
  });

  it.each([
    ['https://evil.com/watch?v=' + ID],
    ['https://youtube.com.evil.com/watch?v=' + ID],
    ['https://evil.com/youtu.be/' + ID],
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['ftp://youtube.com/watch?v=' + ID],
    ['https://user:pass@youtube.com/watch?v=' + ID],
    ['https://www.youtube.com/watch?v=short'],
    ['https://www.youtube.com/watch?v=' + ID + 'extra'],
    ['https://www.youtube.com/watch'],
    ['https://www.youtube.com/playlist?list=PL123'],
    ['https://www.youtube.com/embed/'],
    ['<iframe src="https://www.youtube.com/embed/' + ID + '"></iframe>'],
    [''],
    ['   '],
    ['not a url'],
    ['a'.repeat(3000)],
  ])('rejects %s', (input) => {
    expect(parseYouTubeInput(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(parseYouTubeInput(undefined)).toBeNull();
    expect(parseYouTubeInput(null)).toBeNull();
    expect(parseYouTubeInput(42)).toBeNull();
    expect(parseYouTubeInput({})).toBeNull();
  });
});

describe('isValidVideoId', () => {
  it('requires exactly 11 URL-safe characters', () => {
    expect(isValidVideoId(ID)).toBe(true);
    expect(isValidVideoId('abc_DEF-123')).toBe(true);
    expect(isValidVideoId('abc')).toBe(false);
    expect(isValidVideoId('abc def 123')).toBe(false);
    expect(isValidVideoId('abc/def/123')).toBe(false);
  });
});
