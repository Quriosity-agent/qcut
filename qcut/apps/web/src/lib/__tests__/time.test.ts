import { describe, it, expect } from 'vitest';
import { formatTimeCode, parseTimeCode } from '@/lib/time';

describe('Time Utilities', () => {
  describe('formatTimeCode', () => {
    it('formats zero seconds correctly', () => {
      expect(formatTimeCode(0, 'HH:MM:SS')).toBe('00:00:00');
      expect(formatTimeCode(0, 'MM:SS')).toBe('00:00');
      expect(formatTimeCode(0, 'HH:MM:SS:CS')).toBe('00:00:00:00');
    });
    
    it('formats time with hours, minutes, seconds', () => {
      expect(formatTimeCode(3661, 'HH:MM:SS')).toBe('01:01:01');
      expect(formatTimeCode(125.5, 'HH:MM:SS:CS')).toBe('00:02:05:50');
    });
    
    it('formats time with frames at 30fps', () => {
      expect(formatTimeCode(1.5, 'HH:MM:SS:FF', 30)).toBe('00:00:01:15');
    });
    
    it('formats MM:SS correctly', () => {
      expect(formatTimeCode(65, 'MM:SS')).toBe('01:05');
      expect(formatTimeCode(3665, 'MM:SS')).toBe('01:05'); // Only shows minutes within the hour
    });
  });
  
  describe('parseTimeCode', () => {
    it('parses MM:SS format', () => {
      expect(parseTimeCode('02:30', 'MM:SS')).toBe(150);
      expect(parseTimeCode('00:00', 'MM:SS')).toBe(0);
    });
    
    it('parses HH:MM:SS format', () => {
      expect(parseTimeCode('01:30:45', 'HH:MM:SS')).toBe(5445);
      expect(parseTimeCode('00:00:00', 'HH:MM:SS')).toBe(0);
    });
    
    it('returns null for invalid timecodes', () => {
      expect(parseTimeCode('invalid', 'MM:SS')).toBe(null);
      expect(parseTimeCode('99:99', 'MM:SS')).toBe(null);
      expect(parseTimeCode('', 'HH:MM:SS')).toBe(null);
    });
  });
});