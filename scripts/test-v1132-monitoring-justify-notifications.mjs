import fs from 'node:fs';
import assert from 'node:assert/strict';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const route=fs.readFileSync(new URL('../public/assets/route.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/assets/app.css',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

assert.equal(pkg.version,'1.0.158');
assert(route.includes("pendingOccurrencePayload=await api('/api/operational-pending'"),'Monitoramento deve carregar ocorrências pendentes');
assert(route.includes('monitoringOccurrenceListFor'),'Monitoramento deve vincular ocorrências à viagem ativa');
assert(route.includes('data-route-monitor-justify'),'card deve possuir ação direta de justificativa');
assert(route.includes('openMonitoringOccurrenceJustification'),'deve existir modal de justificativa no Monitoramento');
assert(route.includes("await api('/api/operational-pending',{method:'POST'"),'justificativa do card deve usar o endpoint auditado existente');
assert(route.includes('O registro entra no mesmo histórico de auditoria'),'modal deve deixar explícita a auditoria compartilhada');
assert(css.includes('.btn-warning'),'ação de justificativa deve ter destaque visual');
assert(css.includes('.monitor-occurrence-summary'),'modal deve ter resumo das ocorrências');

assert(app.includes("navigator.serviceWorker.register(OPERATIONAL_NOTIFICATION_SW"),'alertas devem registrar Service Worker');
assert(app.includes('registration.showNotification(title,notificationOptions)'),'Service Worker deve ser o canal prioritário de notificação');
assert(app.includes('new Notification(title,notificationOptions)'),'deve existir fallback para Notification API direta');
assert(app.includes('window.testOperationalNotifications=testOperationalNotifications'),'teste de alerta deve estar disponível ao módulo Rota');
assert(app.includes('dateDaysAgo(3)'),'polling deve cobrir ocorrências que atravessem a virada do dia');
assert(app.includes("setInterval(()=>pollOperationalNotifications(),30000)"),'polling deve permanecer em 30 segundos');
assert(app.includes('pending-notification-test'),'Pendências deve permitir testar o alerta');
assert(route.includes('route-monitor-notification-test'),'Monitoramento deve permitir testar o alerta');

assert(sw.includes("self.addEventListener('notificationclick'"),'Service Worker deve tratar clique da notificação');
assert(sw.includes("postMessage({type:'DMS_OPEN_ROUTE'"),'clique deve direcionar o DMS aberto para Pendências');
assert(index.includes('dms-rota-v1141-login-sessao-20260924'),'assets precisam quebrar o cache da v1.0.131');

console.log('OK v1.0.135 - justificativa direta no card e notificações via Service Worker/teste validadas.');
