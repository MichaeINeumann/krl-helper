import * as assert from 'assert';
import {
  classifyVariable,
  collectDeclarations,
  collectFunctionParameters,
  collectGlobalSourceDeclarations,
  collectProjectDatDeclarations,
  DiagnosticPrefixConfiguration,
  hasLiteralPrefix,
  normalizePrefixList
} from '../diagnosticModel';

const defaults: DiagnosticPrefixConfiguration = {
  localVariablePrefixes: ['b', 'n'],
  globalVariablePrefixes: ['b_', 'n_'],
  inputAliasPrefixes: ['i_'],
  outputAliasPrefixes: ['o_']
};

suite('KRL diagnostic model', () => {
  test('normalizes prefix lists without changing their literal spelling', () => {
    assert.deepStrictEqual(normalizePrefixList([' b ', 'B', '', ' n_', 'N_', 4]), ['b', 'n_']);
    assert.deepStrictEqual(normalizePrefixList([]), []);
  });

  test('evaluates global prefixes before overlapping local prefixes', () => {
    assert.strictEqual(classifyVariable('b_Part', defaults), 'global');
    assert.strictEqual(classifyVariable('bPart', defaults), 'local');
    assert.strictEqual(classifyVariable('B2', defaults), 'local');
    assert.strictEqual(classifyVariable('brake', defaults), undefined);
    assert.strictEqual(hasLiteralPrefix('n.Value', 'n.'), true);
  });

  test('collects module declarations and function parameters case-insensitively', () => {
    const names = collectDeclarations([
      'DECL BOOL bPart',
      'DECL MY_TYPE nCount',
      'DECL GLOBAL INT b_Shared',
      'DECL INT values[nMissing]',
      'REAL nTolAxe'
    ].join('\n'));
    collectFunctionParameters('DEF Run(IN BOOL bReady, INT nIndex)', names);

    assert.deepStrictEqual(
      [...names].sort(),
      ['b_shared', 'bpart', 'bready', 'ncount', 'nindex', 'ntolaxe', 'values']
    );
    assert.ok(!names.has('nmissing'));
  });

  test('$config.dat contributes every declaration globally', () => {
    const names = collectProjectDatDeclarations('/project/KRC/R1/System/$CONFIG.DAT', [
      'DEFDAT $CONFIG',
      'DECL INT n_GlobalIndex',
      'DECL BOOL b_GlobalReady'
    ].join('\n'));

    assert.deepStrictEqual([...names].sort(), ['b_globalready', 'n_globalindex']);
  });

  test('other DAT files require both PUBLIC and DECL GLOBAL', () => {
    const publicDat = [
      'defdat Shared PUBLIC',
      'DECL BOOL b_NotGlobal',
      'decl global int n_Visible'
    ].join('\n');
    const privateDat = 'DEFDAT Shared\nDECL GLOBAL INT n_Hidden';

    assert.deepStrictEqual([...collectProjectDatDeclarations('/project/shared.dat', publicDat)], ['n_visible']);
    assert.deepStrictEqual([...collectProjectDatDeclarations('/project/private.dat', privateDat)], []);
    assert.deepStrictEqual([
      ...collectProjectDatDeclarations('/project/public-only.dat', 'DEFDAT Shared PUBLIC\nDECL INT n_Hidden')
    ], []);
  });

  test('foreign source files contribute only explicit global declarations', () => {
    const names = collectGlobalSourceDeclarations([
      'DECL BOOL b_Local',
      'DECL GLOBAL BOOL b_Visible',
      'GLOBAL DECL INT n_AlsoVisible',
      'GLOBAL DEF b_NotAVariable()'
    ].join('\n'));

    assert.deepStrictEqual([...names].sort(), ['b_visible', 'n_alsovisible']);
  });
});
