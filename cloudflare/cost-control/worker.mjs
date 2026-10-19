import { DurableObject } from 'cloudflare:workers';
import { runGuard } from './guard.mjs';
export class BudgetController extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.running=false;}
 async check(){
  if(this.running)return {status:'already_running'};
  this.running=true;
  try{const result=await runGuard(this.env,{load:()=>this.ctx.storage.get('control'),save:state=>this.ctx.storage.put('control',state)});
   const state=await this.ctx.storage.get('control');
   await this.env.STATUS.put('status',JSON.stringify(await this.status()));
   if(state?.status==='suspended')await this.env.STATUS.put('rollback',JSON.stringify(state));
   return result;
  }catch(error){
   const state=await this.ctx.storage.get('control')||{};state.checkedAt=new Date().toISOString();state.controlError=String(error.message).slice(0,300);state.status=state.status==='suspended'?'suspended':'control_error';
   await this.ctx.storage.put('control',state);await this.env.STATUS.put('status',JSON.stringify(await this.status()));throw error;
  }
  finally{this.running=false;}
 }
 async status(){const state=await this.ctx.storage.get('control');return state?{status:state.status,checkedAt:state.checkedAt,reasons:state.reasons||[],observationFailures:state.observationFailures||0,observationError:state.observationError,shutdownError:state.shutdownError,reconciliationError:state.reconciliationError,lastReconciledAt:state.lastReconciledAt,controlError:state.controlError,complete:!!state.shutdown?.complete,usage:state.usage}: {status:'not_started'};}
}
export default {
 async scheduled(_event,env){await env.CONTROLLER.getByName(env.CONTROLLER_NAME || 'account-budget').check();},
 async fetch(){return new Response('Not found',{status:404});}
};
