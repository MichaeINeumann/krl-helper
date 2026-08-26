import * as assert from 'assert';
import { sanitizeForAnalysis } from '../diagnosticSanitizer';

suite('KRL diagnostic comment filtering', () => {
  test('keeps comment text out of variable diagnostics', () => {
    const source = [
      ';FOLD BEWEGUNG NUR IM KOMMENTAR',
      'IF b_missing THEN ; NUR KOMMENTAR',
      'ENDIF'
    ].join('\r\n');
    const sanitized = sanitizeForAnalysis(source);

    assert.strictEqual(sanitized.length, source.length);
    assert.ok(!sanitized.includes('BEWEGUNG'));
    assert.ok(!sanitized.includes('NUR'));
    assert.ok(sanitized.includes('b_missing'));
    assert.strictEqual(sanitized.split('\r\n').length, source.split('\r\n').length);
  });

  test('filters KUKA header directives independently of their line count', () => {
    const source = [
      '&ACCESS RVP',
      '&REL 1',
      '&PARAM EDITMASK = *',
      '&COMMENT BEWEGUNG NUR IM PROGRAMMKOPF',
      '&PARAM DISKPATH = KRC:\\R1\\Program',
      'IF b_missing THEN',
      'ENDIF'
    ].join('\r\n');
    const sanitized = sanitizeForAnalysis(source);

    assert.strictEqual(sanitized.length, source.length);
    assert.ok(!sanitized.includes('BEWEGUNG'));
    assert.ok(!sanitized.includes('PROGRAMMKOPF'));
    assert.ok(!sanitized.includes('EDITMASK'));
    assert.ok(sanitized.includes('b_missing'));
  });

  test('filters alternative block comments without changing offsets', () => {
    const source = 'b_valid /* BEWEGUNG */ (* NUR *) b_missing';
    const sanitized = sanitizeForAnalysis(source);

    assert.strictEqual(sanitized.length, source.length);
    assert.ok(sanitized.includes('b_valid'));
    assert.ok(sanitized.includes('b_missing'));
    assert.ok(!sanitized.includes('BEWEGUNG'));
    assert.ok(!sanitized.includes('NUR'));
  });
});
