import { runScheduledProtectSatSync } from '../../../public/server/functions/api/protectsat.js';
import { autoTransferUndepartedAt15 } from '../../../public/server/functions/_lib/departure.js';

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async()=>{
      try {
        const result = await runScheduledProtectSatSync(env);
        console.log('ProtectSat cron sync concluído', {
          scheduledTime: controller.scheduledTime,
          total: Number(result?.total || 0),
          mode: result?.mode || '',
          autoDepartures: Array.isArray(result?.autoDepartures) ? result.autoDepartures.length : 0,
          autoReturns: Array.isArray(result?.autoReturns) ? result.autoReturns.length : 0,
        });
      } catch (error) {
        console.error('ProtectSat cron sync falhou', error?.stack || error?.message || String(error));
        // Prosseguir com a rotina das 15h mesmo se o GPS falhar.
      }
      // Independente da disponibilidade do GPS: roda na mesma frequência do cron.
      try {
        const result=await autoTransferUndepartedAt15(env.DB,{id:null,name:'Sistema (15h)',role:'ADMIN'});
        if(result.executed)console.log('Reprogramação 15h',result);
      }catch(error){console.error('Reprogramação automática 15h falhou',error);}
    })());
  },
};
