import * as assert from 'assert';
import { selectNearestPath } from '../projectScope';

suite('KRL project scope', () => {
  test('ranks Windows paths without regard to component casing', () => {
    const nearby = 'c:\\demo\\krc\\r1\\System\\$config.dat';
    const remote = 'C:\\OtherProject\\KRC\\R1\\System\\$config.dat';

    assert.strictEqual(
      selectNearestPath(
        'C:\\Demo\\KRC\\R1\\Program\\main.src',
        [remote, nearby],
        'win32'
      ),
      nearby
    );
  });
});
