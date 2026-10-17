const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLauncherList, parseCondaEnvFile, redactHome } = require('../src/collector/software');

test('parses py -0p output, including paths with spaces', () => {
  const text =
    ' -V:3.13 *        C:\\Python313\\python.exe\r\n' +
    ' -V:3.11          C:\\Users\\a b\\AppData\\Local\\Programs\\Python\\Python311\\python.exe\r\n';
  assert.deepEqual(parseLauncherList(text), [
    'C:\\Python313\\python.exe',
    'C:\\Users\\a b\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
  ]);
});

test('parses the conda environments file and skips blank lines', () => {
  const text = 'C:\\Users\\a\\miniconda3\r\n\r\nC:\\Users\\a\\miniconda3\\envs\\ml\r\n';
  assert.deepEqual(parseCondaEnvFile(text), ['C:\\Users\\a\\miniconda3', 'C:\\Users\\a\\miniconda3\\envs\\ml']);
});

test('home folder is replaced with ~ so no username reaches the spec', () => {
  assert.equal(redactHome('C:\\Users\\garna\\venv\\python.exe', 'C:\\Users\\garna'), '~\\venv\\python.exe');
  assert.equal(redactHome('C:\\Python313\\python.exe', 'C:\\Users\\garna'), 'C:\\Python313\\python.exe');
});