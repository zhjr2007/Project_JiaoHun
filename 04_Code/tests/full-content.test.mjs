import test from 'node:test';
import assert from 'node:assert/strict';
import {fullContent as c} from '../../05_Content/full-content.mjs';
import {createGame,dispatch,getView,validateContent} from '../core/engine.mjs';
import {encodeSave,decodeSave} from '../core/save.mjs';

function game(){let state=createGame(c);return {get state(){return state;},send(a){const r=dispatch(c,state,a);assert.ok(r.ok,r.error);state=r.state;return r;},drain(){for(let n=0;state.dialogue.length;n++){assert.ok(n<200);this.send({type:'NEXT_DIALOGUE'});}},set(s){state=s;}};}
function investigate(g){const stage=c.stages[g.state.stageId];for(const loc of stage.locations){g.send({type:'MOVE',locationId:loc.id});for(const item of loc.interactions){if(!(item.requires||[]).every(f=>g.state.flags.includes(f)))continue;g.send({type:'INTERACT',interactionId:item.id});g.drain();}}assert.ok(getView(c,g.state).canAdvance);g.send({type:'ADVANCE_STAGE'});g.drain();}
function completeHearing(g,reverse=false){const stage=c.stages[g.state.stageId],rules=[...stage.rules];if(reverse&&stage.id!=='final_cut')rules.reverse();for(let n=0;n<rules.length;n++){const rule=rules[n];g.send({type:'SELECT_STATEMENT',statementId:rule.statementId});g.send({type:'PRESENT',...(rule.evidenceIds?{evidenceIds:rule.evidenceIds}:{evidenceId:rule.evidenceId})});if(n<rules.length-1)assert.equal(g.state.pendingStage,null);g.drain();}}
function reachFinal(){const g=game();g.drain();investigate(g);for(let i=0;i<4;i++)completeHearing(g,true);assert.equal(g.state.stageId,'hat_investigation');investigate(g);assert.equal(g.state.stageId,'final_cut');return g;}

test('第一处举证完整播放后转到新陈述，保存恢复不丢已完成点',()=>{
 const g=game();g.drain();investigate(g);
 g.send({type:'SELECT_STATEMENT',statementId:'round1_2'});
 g.send({type:'PRESENT',evidenceId:'ST_01'});
 assert.equal(g.state.statementIndex,1);
 assert.match(g.state.dialogue.at(-1).text,/不能据此断定四把/);
 g.set(decodeSave(c,encodeSave(c,g.state)));g.drain();
 assert.equal(g.state.stageId,'round1');assert.equal(g.state.statementIndex,2);
 assert.equal(getView(c,g.state).hearingProgress.completed,1);
 g.send({type:'NEXT_STATEMENT'});assert.equal(g.state.statementIndex,3);
 g.send({type:'PRESENT',evidenceId:'EV_02'});g.drain();assert.equal(g.state.stageId,'round2');
});
test('已卡在旧陈述的v2存档可定位剩余疑点，不迁移或重置',()=>{
 const g=game();g.drain();investigate(g);g.send({type:'SELECT_STATEMENT',statementId:'round1_2'});g.send({type:'PRESENT',evidenceId:'ST_01'});g.drain();
 g.send({type:'SELECT_STATEMENT',statementId:'round1_2'});g.set(decodeSave(c,encodeSave(c,g.state)));
 const v=getView(c,g.state);assert.equal(v.hearingProgress.currentSolved,true);assert.equal(v.hearingProgress.nextStatementId,'round1_4');
 const will=g.state.ordinaryWill;assert.equal(dispatch(c,g.state,{type:'PRESENT',evidenceId:'ST_01'}).ok,false);assert.equal(g.state.ordinaryWill,will);
 g.send({type:'SELECT_STATEMENT',statementId:v.hearingProgress.nextStatementId});g.send({type:'PRESENT',evidenceId:'EV_02'});g.drain();assert.equal(g.state.stageId,'round2');
});

test('新版14凭据、20段固定追问和第一轮第四段最终修正',()=>{assert.deepEqual(validateContent(c),[]);assert.equal(c.version,2);assert.equal(Object.keys(c.evidence).length,14);assert.equal(c.stages.round1.statements[3].text,'巨成已经承认，这四把剪刀都是他所携带的物品。');for(const s of Object.values(c.stages))for(const st of s.statements||[])assert.equal(st.press.lines.length,2);});
test('分开检查两段编结物，检查人发不会取得纤维事实',()=>{const g=game();g.drain();g.send({type:'MOVE',locationId:'SC_03'});g.send({type:'INTERACT',interactionId:'inspect_EV_07'});assert.ok(g.state.flags.includes('human_braid_examined'));assert.ok(!g.state.flags.includes('fiber_braid_examined'));assert.ok(!g.state.evidence.includes('EV_08'));g.drain();g.send({type:'INTERACT',interactionId:'inspect_EV_08'});assert.ok(g.state.flags.includes('fiber_braid_examined'));assert.ok(g.state.flags.includes('braid_fiber_identified'));assert.match(getView(c,g.state).evidence.find(x=>x.id==='EV_08').description,/并非人发/);});
test('四普通会审完整通关，多点反序均需完成，组合单件不触发招供',()=>{const g=reachFinal();assert.equal(g.state.finalWill,5);g.send({type:'SELECT_STATEMENT',statementId:'final_cut_3'});g.send({type:'PRESENT',evidenceId:'EV_09'});g.drain();assert.equal(g.state.stageId,'final_cut');g.send({type:'SELECT_STATEMENT',statementId:'final_cut_4'});g.send({type:'PRESENT',evidenceId:'EV_08'});assert.equal(g.state.finalWill,4);assert.ok(!g.state.flags.includes('final_point_B'));g.drain();g.set(decodeSave(c,encodeSave(c,g.state)));g.send({type:'PRESENT',evidenceIds:['EV_10','EV_08']});g.drain();assert.equal(g.state.stageId,'ending_success');assert.ok(g.state.flags.includes('final_confession'));assert.match(c.stages.ending_success.intro.map(x=>x.text).join(''),/三千二百钱/);});
test('普通失败从第一轮入口重试，最终失败从最终入口重试',()=>{for(const final of [false,true]){const g=final?reachFinal():game();if(!final){g.drain();investigate(g);}for(let n=0;n<5;n++){g.send({type:'PRESENT',evidenceId:'EV_01'});g.drain();}assert.equal(g.state.stageId,final?'ending_final_failure':'ending_ordinary_failure');g.send({type:'RETRY'});assert.equal(g.state.stageId,final?'final_cut':'round1');assert.equal(g.state[final?'finalWill':'ordinaryWill'],5);}});
