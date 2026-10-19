import test from 'node:test';
import assert from 'node:assert/strict';
import { compare } from './es5-test-helpers.js';
const actions = {
  normal: 'capture("normal");',
  return: 'return 10;',
  throw: 'throw 20;',
  break: 'break outer;',
  continue: 'continue outer;',
};
for (const [a, first] of Object.entries(actions))
  for (const [b, second] of Object.entries(actions))
    for (const [c, third] of Object.entries(actions))
      test(`completion matrix: try=${a}, catch=${b}, finally=${c}`, () => {
        const source = `function run(){outer:for(var i=0;i<2;i++){
          try{try{${first}}catch(e){capture("caught:"+e);${second}}
          finally{capture("finally:"+i);${third}}}
          catch(e){capture("outer:"+e);}capture("tail");
        }return 77;}capture(run());`;
        const result = compare(source);
        assert.equal(result.thrown, false);
        assert.ok(result.values.length > 0);
      });
for (const [name, action] of Object.entries(actions))
  test(`nested finally restores pending ${name}`, () => {
    const result = compare(`function f(){outer:for(var i=0;i<2;i++){
      try{${action}}finally{
        try{throw 2;}catch(e){capture(e);}finally{capture("inner");}
        a:for(var j=0;j<2;j++){continue a;}capture("done");
      }
    }return 77;}try{capture(f());}catch(e){capture(e);}`);
    assert.equal(result.thrown, false);
  });
