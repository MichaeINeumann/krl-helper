import * as assert from 'assert';
import * as path from 'path';
import { projectRootForSource, selectNearestPath } from '../projectScope';

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

  test('prefers the inferred R1 tree when the workspace is nested below it', () => {
    const projectRoot = path.join(path.sep, 'demo', 'KRC', 'R1');
    const workspaceRoot = path.join(projectRoot, 'Program');

    assert.strictEqual(
      projectRootForSource(path.join(workspaceRoot, 'main.src'), workspaceRoot),
      projectRoot
    );
  });
});
