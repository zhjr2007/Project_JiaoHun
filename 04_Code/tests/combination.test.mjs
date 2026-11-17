import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoContent} from '../../05_Content/demo-content.mjs';
import {createGame,dispatch,validateContent,validateState} from '../core/engine.mjs';
import {encodeSave,decodeSave} from '../core/save.mjs';

function fixture(){
 const content=structuredClone(demoContent);content.startStage='hearing_scissors';content.initialEvidence=['scissors','luggage','braids'];
 const stage=content.stages.hearing_scissors;
 stage.requires=['point_a','point_b'];stage.next='hearing_braid';
 stage.rules=[
  {id:'point_a',statementId:'scissors_2',evidenceId:'scissors',flags:['point_a','scissors_contradiction'],onceFlag:'point_a',lines:[{speaker:'沈砚',text:'第一处反驳。'}]},
  {id:'point_b',statementId:'scissors_4',evidenceIds:['luggage','braids'],requires:['point_a'],flags:['point_b'],onceFlag:'point_b',lines:[{speaker:'沈砚',text:'先完成组合反驳，再进入下一轮。'}]}
 ];
 return content;
}
const step=(c,s,a)=>{const r=dispatch(c,s,a);assert.equal(r.ok,true,r.error);return r.state;};
const drain=(c,s)=>{while(s.dialogue.length)s=step(c,s,{type:'NEXT_DIALOGUE'});return s;};
test('同轮多举证点累计，双证物无序匹配，完整反驳后才进入下轮，存档兼容',()=>{
 const c=fixture();assert.deepEqual(validateContent(c),[]);let s=drain(c,createGame(c));
 s=step(c,s,{type:'SELECT_STATEMENT',statementId:'scissors_2'});s=step(c,s,{type:'PRESENT',evidenceId:'scissors'});
 assert.equal(s.pendingStage,null);s=drain(c,s);assert.equal(s.stageId,'hearing_scissors');
 assert.equal(s.statementIndex,2);s=step(c,s,{type:'SELECT_STATEMENT',statementId:'scissors_2'});
 const repeated=dispatch(c,s,{type:'PRESENT',evidenceId:'scissors'});assert.equal(repeated.ok,false);assert.equal(repeated.state.ordinaryWill,5);
 s=step(c,s,{type:'SELECT_STATEMENT',statementId:'scissors_4'});s=step(c,s,{type:'PRESENT',evidenceIds:['braids','luggage']});
 assert.equal(s.stageId,'hearing_scissors');assert.equal(s.pendingStage,'hearing_braid');
 s=decodeSave(c,encodeSave(c,s));assert.deepEqual(validateState(c,s),[]);s=drain(c,s);assert.equal(s.stageId,'hearing_braid');
});
test('单件不能替代双证物，错误组合只扣一点，重复与未获得项目不扣分',()=>{
 const c=fixture();let s=drain(c,createGame(c));s=step(c,s,{type:'SELECT_STATEMENT',statementId:'scissors_4'});
 for(const action of [{evidenceIds:['luggage','luggage']},{evidenceIds:['unknown','luggage']},{evidenceId:'luggage',evidenceIds:['luggage','braids']}]){
  const r=dispatch(c,s,{type:'PRESENT',...action});assert.equal(r.ok,false);assert.equal(r.state.ordinaryWill,5);
 }
 s=step(c,s,{type:'PRESENT',evidenceId:'luggage'});assert.equal(s.ordinaryWill,4);assert.equal(s.flags.includes('point_b'),false);
 assert.equal(dispatch(c,s,{type:'PRESENT',evidenceId:'luggage'}).ok,false);assert.equal(s.ordinaryWill,4);
 s=drain(c,s);s=step(c,s,{type:'PRESENT',evidenceIds:['luggage','braids']});assert.equal(s.ordinaryWill,3);assert.equal(s.flags.includes('point_b'),false);
});
test('内容契约拒绝混用、重复组合、未知证物与无效一次性标记',()=>{
 for(const change of [r=>r.evidenceIds=['luggage','luggage'],r=>r.evidenceIds=['luggage','missing'],r=>r.evidenceId='luggage',r=>r.onceFlag='undeclared']){
  const c=fixture();change(c.stages.hearing_scissors.rules[1]);assert.ok(validateContent(c).length);
 }
});
