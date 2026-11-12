// (2026-11-12) The runtime pins every hosted RGS function URL it calls to the database's region (XRGS I-208).
const { withFunctionRegion, DEFAULT_FUNCTION_REGION } = require('../src/nodes/std-library/data/rgs-region');

const FN = 'https://abc.supabase.co/functions/v1/rgs-fn/lucky-slot/SpinMaths';

describe('withFunctionRegion', () => {
  test('pins a hosted function URL to eu-west-1, the XRGS database region', () => {
    expect(DEFAULT_FUNCTION_REGION).toBe('eu-west-1');
    expect(withFunctionRegion(FN)).toBe(FN + '?forceFunctionRegion=eu-west-1');
  });
  test('after an existing query, before a fragment, and never twice', () => {
    expect(withFunctionRegion(FN + '/__balance?client=x')).toBe(FN + '/__balance?client=x&forceFunctionRegion=eu-west-1');
    expect(withFunctionRegion(FN + '?a=1#f')).toBe(FN + '?a=1&forceFunctionRegion=eu-west-1#f');
    expect(withFunctionRegion(FN + '?forceFunctionRegion=us-east-1')).toBe(FN + '?forceFunctionRegion=us-east-1');
    expect(withFunctionRegion(withFunctionRegion(FN))).toBe(withFunctionRegion(FN));
  });
  test('leaves local stacks and non-function URLs alone', () => {
    expect(withFunctionRegion('http://localhost:54321/functions/v1/aggregator')).toBe('http://localhost:54321/functions/v1/aggregator');
    expect(withFunctionRegion('http://127.0.0.1:54321/functions/v1/rgs-fn/g/f')).toBe('http://127.0.0.1:54321/functions/v1/rgs-fn/g/f');
    expect(withFunctionRegion('https://api.example.com/round')).toBe('https://api.example.com/round');
    expect(withFunctionRegion('https://abc.supabase.co/rest/v1/x')).toBe('https://abc.supabase.co/rest/v1/x');
    expect(withFunctionRegion('')).toBe('');
  });
});

describe('the Aggregator posts its round pinned', () => {
  test('a game published before XRGS pinned its URL is pinned at request time', () => {
    const src = require('fs').readFileSync(require.resolve('../src/nodes/std-library/data/aggregatornode.js'), 'utf8');
    expect(src).toMatch(/const url = withFunctionRegion\(this\._internal\.url \|\| DEFAULT_URL\)/);
    expect(src).toMatch(/fetch\(withFunctionRegion\(match\[1\] \+ '\/__balance/);
  });
});
