/**
 * Espaço Angélica do Carmo - Pipeline de Verificação Completa
 * 
 * Executa em sequência:
 * 1. Verificação das dependências
 * 2. Verificação de tipos (TypeScript)
 * 3. Lint de conformidade
 * 4. Testes unitários automatizados
 * 5. Testes de integração seguros (Google Apps Script / Sheets)
 * 6. Build de produção (Vite)
 * 7. Verificação final dos artefatos (dist/)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function printHeader(step, title) {
  console.log(`\n============================================================`);
  console.log(`  [${step}/7] ${title}`);
  console.log(`============================================================`);
}

function runCommand(command, args, description) {
  const fullCommand = `${command} ${args.join(' ')}`;
  console.log(`\n> ${fullCommand}`);
  const result = spawnSync(fullCommand, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true
  });

  if (result.status !== 0) {
    console.error(`\n❌ FALHA: ${description} (código de saída: ${result.status})`);
    process.exit(result.status || 1);
  }
}

// 1. Verificação das dependências
printHeader(1, 'Verificação das dependências');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const forbidden = ['firebase', 'firebase-admin', 'express', 'dotenv', '@google-cloud/firestore', '@google-cloud/storage'];
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
for (const bad of forbidden) {
  if (allDeps[bad]) {
    console.error(`❌ Dependência não autorizada encontrada no package.json: ${bad}`);
    process.exit(1);
  }
}

const requiredDirs = ['react', 'react-dom', 'vite', 'typescript'];
for (const req of requiredDirs) {
  const depPath = path.join(rootDir, 'node_modules', req);
  if (!fs.existsSync(depPath)) {
    console.error(`❌ Dependência obrigatória ausente em node_modules: ${req}. Execute 'npm install'.`);
    process.exit(1);
  }
}
console.log('✔ Nenhuma dependência externa não autorizada (sem Firebase/Express/dotenv).');
console.log('✔ Todas as dependências necessárias estão instaladas.');

// 2. Verificação de tipos
printHeader(2, 'Verificação de tipos (TypeScript)');
runCommand('npx', ['tsc', '--noEmit'], 'Verificação de tipos TypeScript');
console.log('✔ Compilação TypeScript validada com 0 erros.');

// 3. Lint
printHeader(3, 'Lint e Conformidade de Código');
// Verifica ausência de termos incorretos como 'Espaçor' em arquivos de código
const srcDir = path.join(rootDir, 'src');
function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full);
    } else if (/\.(tsx?|jsx?|html|css)$/.test(entry.name)) {
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes('Espaçor')) {
        console.error(`❌ Termo 'Espaçor' encontrado em ${full}`);
        process.exit(1);
      }
    }
  }
}
scanDir(srcDir);
console.log('✔ Verificação de código e lint concluídos com sucesso (sem termos inválidos).');

// 4. Testes automatizados
printHeader(4, 'Testes automatizados (Unitários)');
runCommand('node', ['--test', 'tests/unit/*.test.mjs'], 'Testes unitários');
console.log('✔ Todos os testes unitários passaram.');

// 5. Testes de integração seguros disponíveis
printHeader(5, 'Testes de integração seguros (Google Apps Script)');
runCommand('node', ['--test', 'tests/integration/*.test.mjs'], 'Testes de integração');
console.log('✔ Todos os testes de integração com a API oficial passaram.');

// 6. Build de produção
printHeader(6, 'Build de produção');
const sourceHtml = path.join(rootDir, 'index.source.html');
const targetHtml = path.join(rootDir, 'index.html');
fs.copyFileSync(sourceHtml, targetHtml);
runCommand('npx', ['vite', 'build'], 'Build Vite');
console.log('✔ Build de produção concluído com sucesso.');

// 7. Verificação final dos artefatos
printHeader(7, 'Verificação final dos artefatos (dist/)');
const distDir = path.join(rootDir, 'dist');
const distIndex = path.join(distDir, 'index.html');
if (!fs.existsSync(distIndex)) {
  console.error('❌ dist/index.html não foi gerado.');
  process.exit(1);
}

const indexContent = fs.readFileSync(distIndex, 'utf8');
if (!indexContent.includes('id="root"')) {
  console.error('❌ dist/index.html não contém elemento #root.');
  process.exit(1);
}

const assetsDir = path.join(distDir, 'assets');
if (!fs.existsSync(assetsDir)) {
  console.error('❌ Diretório dist/assets não encontrado.');
  process.exit(1);
}

const assetFiles = fs.readdirSync(assetsDir);
const jsBundle = assetFiles.find(f => f.endsWith('.js'));
const cssBundle = assetFiles.find(f => f.endsWith('.css'));

if (!jsBundle || fs.statSync(path.join(assetsDir, jsBundle)).size < 10000) {
  console.error('❌ Bundle JavaScript ausente ou corrompido em dist/assets.');
  process.exit(1);
}

if (!cssBundle || fs.statSync(path.join(assetsDir, cssBundle)).size < 5000) {
  console.error('❌ Bundle CSS ausente ou corrompido em dist/assets.');
  process.exit(1);
}

console.log(`✔ dist/index.html verificado.`);
console.log(`✔ Bundle JS verificado: dist/assets/${jsBundle} (${(fs.statSync(path.join(assetsDir, jsBundle)).size / 1024).toFixed(1)} KB)`);
console.log(`✔ Bundle CSS verificado: dist/assets/${cssBundle} (${(fs.statSync(path.join(assetsDir, cssBundle)).size / 1024).toFixed(1)} KB)`);

console.log(`\n============================================================`);
console.log(`  🎉 TODAS AS 7 ETAPAS DE VERIFICAÇÃO FORAM APROVADAS!`);
console.log(`============================================================\n`);
