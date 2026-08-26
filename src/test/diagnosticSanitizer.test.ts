import * as assert from 'assert';
import { sanitizeForAnalysis } from '../diagnosticSanitizer';

suite('KRL diagnostic comment filtering', () => {
  test('keeps comment text out of variable diagnostics', () => {
    const source = [
      ';FOLD SYNTHETIC MOTION COMMENT',
      'IF bMissing THEN ; COMMENT ONLY',
      'ENDIF'
    ].join('\r\n');
    const sanitized = sanitizeForAnalysis(source);

    assert.strictEqual(sanitized.length, source.length);
    assert.ok(!sanitized.includes('SYNTHETIC'));
    assert.ok(!sanitized.includes('ONLY'));
    assert.ok(sanitized.includes('bMissing'));
    assert.strictEqual(sanitized.split('\r\n').length, source.split('\r\n').length);
  });

  test('filters KUKA header directives independently of their line count', () => {
    const source = [
      '&ACCESS RVP',
      '&REL 1',
      '&PARAM EDITMASK = *',
      '&COMMENT SYNTHETIC HEADER COMMENT',
      '&PARAM DISKPATH = KRC:\\R1\\Program',
      'IF bMissing THEN',
      'ENDIF'
    ].join('\r\n');
    const sanitized = sanitizeForAnalysis(source);

    assert.strictEqual(sanitized.length, source.length);
    assert.ok(!sanitized.includes('SYNTHETIC'));
    assert.ok(!sanitized.includes('HEADER'));
    assert.ok(!sanitized.includes('EDITMASK'));
    assert.ok(sanitized.includes('bMissing'));
  });

  test('filters alternative block comments without changing offsets', () => {
    const source = 'bValid /* SYNTHETIC */ (* COMMENT *) bMissing';
    const sanitized = sanitizeForAnalysis(source);

    assert.strictEqual(sanitized.length, source.length);
    assert.ok(sanitized.includes('bValid'));
    assert.ok(sanitized.includes('bMissing'));
    assert.ok(!sanitized.includes('SYNTHETIC'));
    assert.ok(!sanitized.includes('COMMENT'));
  });
});
