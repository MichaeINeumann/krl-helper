import * as assert from 'assert';
import { findKrlVariableReference, parseKrlVariableDeclarations } from '../variableParser';

suite('KRL variable parser', () => {
  test('parses declarations, signals, and both KRL parameter styles', () => {
    const source = [
      'DEF Run(bnHalt :IN, T[,] :OUT, IN BOOL bReady, INT nIndex)',
      '  DECL BOOL bLocal, bSecond',
      '  DECL GLOBAL CONST INT n_Global',
      '  REAL nTolAxe',
      '  E6AXIS pHere, pTarget',
      '  SIGNAL InputWord $IN[1] TO $IN[16]',
      'END'
    ].join('\n');
    const declarations = parseKrlVariableDeclarations(source);

    assert.deepStrictEqual(
      declarations.map(declaration => declaration.normalizedName).sort(),
      [
        'blocal', 'bnhalt', 'bready', 'bsecond', 'inputword', 'n_global', 'nindex',
        'ntolaxe', 'phere', 'ptarget', 't'
      ]
    );
    assert.strictEqual(declarations.find(item => item.normalizedName === 'n_global')?.global, true);
    assert.strictEqual(declarations.find(item => item.normalizedName === 'bnhalt')?.kind, 'parameter');
    assert.strictEqual(declarations.find(item => item.normalizedName === 'inputword')?.kind, 'signal');
    assert.strictEqual(declarations.find(item => item.normalizedName === 'ntolaxe')?.line, 3);
  });

  test('marks GLOBAL declarations with and without DECL as global', () => {
    const declarations = parseKrlVariableDeclarations([
      'DECL GLOBAL BOOL b_First',
      'GLOBAL DECL INT n_Second',
      'GLOBAL BOOL bThird'
    ].join('\n'));

    assert.deepStrictEqual(
      declarations.map(declaration => [declaration.normalizedName, declaration.global]),
      [['b_first', true], ['n_second', true], ['bthird', true]]
    );
  });

  test('does not parse GLOBAL type definitions as variables', () => {
    const declarations = parseKrlVariableDeclarations([
      'GLOBAL STRUC b_Status BOOL bReady',
      'GLOBAL ENUM n_Mode #IDLE, #ACTIVE',
      'GLOBAL BOOL bActualVariable'
    ].join('\n'));

    assert.deepStrictEqual(
      declarations.map(declaration => declaration.normalizedName),
      ['bactualvariable']
    );
  });

  test('finds variable references but excludes calls, members, system variables, and comments', () => {
    const source = [
      'bLocal = structValue.member',
      '$IN[i_Input] = TRUE',
      'bState = #NOTIFY',
      'Run()',
      '; bCommented'
    ].join('\n');

    assert.strictEqual(findKrlVariableReference(source, source.indexOf('bLocal'))?.normalizedName, 'blocal');
    assert.strictEqual(findKrlVariableReference(source, source.indexOf('structValue'))?.normalizedName, 'structvalue');
    assert.strictEqual(findKrlVariableReference(source, source.indexOf('member')), undefined);
    assert.strictEqual(findKrlVariableReference(source, source.indexOf('$IN') + 1), undefined);
    assert.strictEqual(findKrlVariableReference(source, source.indexOf('i_Input'))?.normalizedName, 'i_input');
    assert.strictEqual(findKrlVariableReference(source, source.indexOf('NOTIFY')), undefined);
    assert.strictEqual(findKrlVariableReference(source, source.indexOf('Run')), undefined);
    assert.strictEqual(findKrlVariableReference(source, source.indexOf('bCommented')), undefined);
  });
});
