import * as assert from 'assert';
import { findKrlFunctionCall, parseKrlFunctions, selectVisibleKrlFunctions } from '../functionParser';

suite('KRL function parser', () => {
  test('parses local/global DEF and DEFFCT declarations case-insensitively', () => {
    const source = [
      'DEF LocalRun(INT nCount)',
      'global def SharedRun()',
      'DEFFCT BOOL IsReady()',
      'GLOBAL DEFFCT REAL ReadValue(INT nIndex)',
      '; DEF CommentedOut()',
      '(* GLOBAL DEF BlockCommented() *)'
    ].join('\n');
    const definitions = parseKrlFunctions(source);

    assert.deepStrictEqual(definitions.map(definition => definition.name), [
      'LocalRun', 'SharedRun', 'IsReady', 'ReadValue'
    ]);
    assert.deepStrictEqual(definitions.map(definition => definition.global), [false, true, false, true]);
    assert.strictEqual(definitions[3].signature, 'GLOBAL DEFFCT REAL ReadValue(INT nIndex)');
  });

  test('resolves only user-function call sites', () => {
    const source = [
      'DEF Example()',
      '  SharedRun (1)',
      '  BAS(#INITMOV, 0)',
      '  ; HiddenCall()',
      'END'
    ].join('\n');

    assert.strictEqual(findKrlFunctionCall(source, source.indexOf('SharedRun'))?.normalizedName, 'sharedrun');
    assert.strictEqual(findKrlFunctionCall(source, source.indexOf('BAS')), undefined);
    assert.strictEqual(findKrlFunctionCall(source, source.indexOf('HiddenCall')), undefined);
    assert.strictEqual(findKrlFunctionCall(source, source.indexOf('Example')), undefined);
  });

  test('prioritizes the current document and excludes foreign local functions', () => {
    const current = parseKrlFunctions('DEF Shared()\nGLOBAL DEF Shared()')
      .map(definition => ({ ...definition, sourceId: 'current' }));
    const foreign = parseKrlFunctions('DEF Shared()\nGLOBAL DEF Shared()\nGLOBAL DEF Other()')
      .map(definition => ({ ...definition, sourceId: 'foreign' }));

    const visible = selectVisibleKrlFunctions([...foreign, ...current], 'current', 'shared');

    assert.deepStrictEqual(visible.map(definition => definition.sourceId), ['current', 'current', 'foreign']);
    assert.deepStrictEqual(visible.map(definition => definition.global), [false, true, true]);
  });

  test('makes the foreign routine matching its source module name visible', () => {
    const current = parseKrlFunctions('DEF Caller()')
      .map(definition => ({ ...definition, sourceId: 'current', moduleEntry: false }));
    const foreign = parseKrlFunctions('DEF r_mvHome()\nDEF LocalHelper()')
      .map(definition => ({
        ...definition,
        sourceId: 'r_mvhome.src',
        moduleEntry: definition.normalizedName === 'r_mvhome'
      }));

    assert.strictEqual(
      selectVisibleKrlFunctions([...current, ...foreign], 'current', 'r_mvhome').length,
      1
    );
    assert.strictEqual(
      selectVisibleKrlFunctions([...current, ...foreign], 'current', 'localhelper').length,
      0
    );
  });
});
