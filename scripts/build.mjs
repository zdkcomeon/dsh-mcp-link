import { rm, mkdir, readFile, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const packageName = packageJson.name

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? 'signal'}`)))
  })
}

await rm(join(root, 'lib'), { recursive: true, force: true })
await mkdir(join(root, 'lib'), { recursive: true })
await run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.host.json'])
await run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.client.json'])

const result = await build({
  entryPoints: [join(root, 'src/client/index.tsx')],
  outfile: join(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'react',
  sourcemap: true,
  sourcesContent: true,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives',
  ],
  banner: {
    js: `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(packageName)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;`,
  },
  footer: {
    js: `\t\treturn module.exports;\n\t}\n});`,
  },
})

if (result.errors.length > 0) process.exitCode = 1

const clientFile = join(root, 'lib/client.js')
const clientStat = await stat(clientFile)
if (clientStat.size === 0) throw new Error('lib/client.js is empty')
console.log(`built ${packageName}: lib/index.js + lib/client.js`)
