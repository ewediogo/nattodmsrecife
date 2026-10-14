import fs from 'node:fs';
import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');
assert.match(src,/id="dep-audit-camera"[^>]*capture="environment"/,'deve manter ação explícita para tirar foto com a câmera');
assert.match(src,/id="dep-audit-photos"[^>]*accept="image\/\*"[^>]*multiple/,'deve permitir anexar múltiplas imagens existentes sem capture');
assert.doesNotMatch(src,/id="dep-audit-photos"[^>]*capture=/,'input de anexo não pode forçar abertura da câmera');
assert.match(src,/departureAuditSelectedFiles\(root\)/,'salvamento deve combinar arquivos da câmera e do anexo');
assert.match(src,/keepPhotoIds\.length\+files\.length>5/,'limite total de cinco evidências deve permanecer');
console.log('OK v1.0.143 - auditoria permite câmera ou anexo de imagem e mantém limite total de 5 fotos.');
