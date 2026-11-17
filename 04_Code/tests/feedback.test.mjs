import test from 'node:test';
import assert from 'node:assert/strict';
import { demoContent as content } from '../../05_Content/demo-content.mjs';
import { createGame,dispatch,getView } from '../core/engine.mjs';
import { encodeSave,decodeSave } from '../core/save.mjs';

test('错误举证先反驳、制止，再显示扣点；反馈中重载不会撤销惩罚',()=>{
  let state=createGame(content);
  function send(action){const result=dispatch(content,state,action);assert.equal(result.ok,true,result.error);state=result.state;}
  function drain(){for(let limit=0;state.dialogue.length;limit++){assert.ok(limit<100);send({type:'NEXT_DIALOGUE'});}}
  drain();
  for(const location of content.stages.investigation.locations){
    send({type:'MOVE',locationId:location.id});
    for(const interaction of location.interactions){send({type:'INTERACT',interactionId:interaction.id});drain();}
  }
  send({type:'ADVANCE_STAGE'});drain();
  send({type:'PRESENT',evidenceId:'scissors'});
  assert.equal(state.ordinaryWill,4);
  assert.equal(getView(content,state).displayWill,5);
  assert.equal(getView(content,state).dialogue.speaker,'蔡瑞');
  state=decodeSave(content,encodeSave(content,state));
  assert.equal(state.ordinaryWill,4);assert.equal(getView(content,state).displayWill,5);
  send({type:'NEXT_DIALOGUE'});assert.equal(getView(content,state).displayWill,5);
  send({type:'NEXT_DIALOGUE'});assert.equal(getView(content,state).displayWill,5);
  send({type:'NEXT_DIALOGUE'});assert.equal(getView(content,state).displayWill,4);
  assert.equal(getView(content,state).dialogue.cue,'will_penalty');
  drain();assert.equal(getView(content,state).displayWill,4);assert.equal(state.statementIndex,0);
});
