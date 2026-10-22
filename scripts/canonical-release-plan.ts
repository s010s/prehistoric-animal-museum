import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

export const releaseEvidenceDirectory = '.handoff/expansion-12/release-fix/integration'
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
export async function walkFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes:true})
  const paths = await Promise.all(entries.map(async e => e.isDirectory() ? walkFiles(`${directory}/${e.name}`) : e.isFile() ? [`${directory}/${e.name}`] : []))
  return paths.flat().sort()
}
export async function fingerprintFiles(paths: readonly string[]) {
  return Promise.all(paths.map(async path => ({path,sha256:sha256(await readFile(path))})))
}
export async function releaseInputPaths(): Promise<string[]> {
  return [...new Set([
    ...await walkFiles('src'), ...await walkFiles('scripts'), ...await walkFiles('public'),
    'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json',
    'tsconfig.app.json', 'tsconfig.node.json', 'eslint.config.js', '.gitignore',
    'README.md', 'README.zh-CN.md', 'THIRD_PARTY_NOTICES.md',
    '.handoff/expansion-12/release-readiness/narration-owner-confirmation.json',
  ])].sort()
}
export async function assertPreparedInventory(plan: PreparedCanonicalRelease): Promise<void> {
  for (const [label, current, prepared] of [
    ['source', await releaseInputPaths(), plan.inputs],
    ['candidate artifact', await walkFiles('dist-release-candidate'), plan.artifacts],
  ] as const) {
    const expected = prepared.map(record => record.path).sort()
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      const added = current.filter(path => !expected.includes(path))
      const removed = expected.filter(path => !current.includes(path))
      throw new Error(`Prepared ${label} inventory changed. Added: ${added.join(', ')}; removed: ${removed.join(', ')}`)
    }
    for (const record of prepared) {
      if (sha256(await readFile(record.path)) !== record.sha256) throw new Error(`Prepared ${label} changed: ${record.path}`)
    }
  }
}
export interface PreparedCanonicalRelease {
  readonly schemaVersion: 1
  readonly preparedAt: string
  readonly galleryIds: readonly string[]
  readonly comparisonCount: 32
  readonly newAnimalIds: readonly string[]
  readonly names: readonly {id:string; habitat:string; zhCN:string; en:string}[]
  readonly inputs: readonly {path:string; sha256:string}[]
  readonly artifacts: readonly {path:string; sha256:string}[]
  readonly requiredApprovalDomains: readonly string[]
  readonly productionOwnerApproved: false
}

function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  const name = property.name
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) ? name.text : undefined
}

function variableObject(source: ts.SourceFile, name: string): ts.ObjectLiteralExpression {
  let result: ts.ObjectLiteralExpression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      let expression = node.initializer
      while (ts.isSatisfiesExpression(expression) || ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression)) expression = expression.expression
      if (ts.isObjectLiteralExpression(expression)) result = expression
    }
    ts.forEachChild(node,visit)
  }
  visit(source)
  if (!result) throw new Error(`Expected explicit ${name} object for deterministic promotion.`)
  return result
}

export function promotedPackage(sourceText: string): string {
  const source=ts.createSourceFile('package.ts',sourceText,ts.ScriptTarget.Latest,true)
  const object=variableObject(source,'animalDefinition')
  const edits: {start:number; end:number; text:string}[]=[]
  const properties = (object: ts.ObjectLiteralExpression): ts.ObjectLiteralElementLike[] => object.properties.flatMap(property => {
    if (!ts.isSpreadAssignment(property)) return [property]
    if (!ts.isObjectLiteralExpression(property.expression)) throw new Error('Promotion requires explicit inline object spreads.')
    return properties(property.expression)
  })
  for (const property of properties(object)) {
    const name=propertyName(property)
    if (name==='status' && ts.isPropertyAssignment(property)) {
      if (property.initializer.getText(source)!=="'draft'" && property.initializer.getText(source)!=='"draft"') throw new Error('Only an actual draft can be promoted.')
      edits.push({start:property.initializer.getStart(source),end:property.initializer.end,text:"'published'"})
    }
    if (name==='draftNotes') {
      let end=property.end
      while (/\s/.test(sourceText[end] ?? 'x')) end++
      if (sourceText[end]===',') end++
      edits.push({start:property.getFullStart(),end,text:''})
    }
    if (name==='provenance') edits.push({start:property.getStart(source),end:property.end,text:'provenance: [provenance[0], ...provenance.slice(1)] as const'})
  }
  if (!edits.some(e=>e.text==="'published'")) throw new Error('Draft status property missing.')
  let next=sourceText
  for(const edit of edits.sort((a,b)=>b.start-a.start)) next=next.slice(0,edit.start)+edit.text+next.slice(edit.end)
  return next.replace(/\bDraftAnimalDefinition\b/g,'PublishedAnimalDefinition')
}

export function promotedCollection(sourceText:string, ids:readonly string[]):string {
  const source=ts.createSourceFile('main.ts',sourceText,ts.ScriptTarget.Latest,true)
  const property=variableObject(source,'mainCollection').properties.find(p=>propertyName(p)==='animalIds')
  if(!property || !ts.isPropertyAssignment(property)) throw new Error('Main collection has no explicit animalIds.')
  return (sourceText.slice(0,property.initializer.getStart(source))+JSON.stringify(ids,null,2)+sourceText.slice(property.initializer.end))
    .replace(/^import \{ releaseCandidateAnimalIds, releaseCandidateEnabled \} from '\.\.\/release-candidate'\n/m,'')
}

export async function plannedCanonicalChanges(plan:PreparedCanonicalRelease):Promise<Map<string,string>> {
  const changes=new Map<string,string>()
  const animalTemplate=await readFile('src/content/animals/stegosaurus/animal.ts','utf8')
  for(const id of plan.newAnimalIds){
    const root=`src/content/animals/${id}`
    changes.set(`${root}/package.ts`,promotedPackage(await readFile(`${root}/package.ts`,'utf8')))
    changes.set(`${root}/animal.ts`,animalTemplate)
  }
  changes.set('src/content/collections/main.ts',promotedCollection(await readFile('src/content/collections/main.ts','utf8'),plan.galleryIds))
  for(const locale of ['en','zh-CN']){
    const path=locale==='en'?'README.md':'README.zh-CN.md'
    let text=await readFile(path,'utf8')
    const groups=locale==='en'?[['land','Land'],['air','Sky'],['water','Sea']]:[['land','陆地'],['air','天空'],['water','海洋']]
    const lines=groups.map(([habitat,label])=>locale==='en'
      ? `- **${label}:** ${plan.names.filter(n=>n.habitat===habitat).map(n=>n.en).join(', ')}.`
      : `- **${label}**：${plan.names.filter(n=>n.habitat===habitat).map(n=>n.zhCN).join('、')}。`)
    const summary=locale==='en'?'See the full collection':'查看完整馆藏'
    const start=text.indexOf('</summary>',text.indexOf(summary))+10,end=text.indexOf('</details>',start)
    if(start<10||end<start)throw new Error('README collection markers missing.')
    text=text.slice(0,start)+'\n\n'+lines.join('\n')+'\n\n'+text.slice(end)
    const status=locale==='en'
      ? 'This checkout contains 36 approved exhibits and 32 comparison scenes. Deployment is a separate action; this local preparation does not change the live website.'
      : '当前检出包含36种已批准动物和32个比一比场景。部署是独立操作，本地准备不会改变官网。'
    text=text.replace(/<!-- local-release-status:start -->[\s\S]*?<!-- local-release-status:end -->/,`<!-- local-release-status:start -->\n${status}\n<!-- local-release-status:end -->`)
    changes.set(path,text)
  }
  const rights='src/scale-encounter/audio/additions/RIGHTS.md'
  changes.set(rights,(await readFile(rights,'utf8')).replace('Current package state: local release candidate; no external publication is performed by this preparation.','Current package state: production-approved local package; external publication remains a separate authorized action.'))
  const manifestPath='src/scale-encounter/audio/additions-manifest.json'
  const manifest=JSON.parse(await readFile(manifestPath,'utf8')) as {status:string; productionPublicationAuthorized:boolean; [key:string]:unknown}
  manifest.status='production-approved';manifest.productionPublicationAuthorized=true
  changes.set(manifestPath,JSON.stringify(manifest,null,2)+'\n')
  return changes
}

export function typecheckPromotionOverlay(changes:ReadonlyMap<string,string>):void {
  const configPath=resolve('tsconfig.app.json'),raw=ts.readConfigFile(configPath,path=>ts.sys.readFile(path))
  if(raw.error)throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText,'\n'))
  const parsed=ts.parseJsonConfigFileContent(raw.config,ts.sys,process.cwd())
  const options={...parsed.options,incremental:false,composite:false,noEmit:true}
  const host=ts.createCompilerHost(options),original=host.getSourceFile.bind(host)
  const overlay=new Map([...changes].map(([p,text])=>[resolve(p),text]))
  host.getSourceFile=(path,languageVersion,onError,shouldCreateNewSourceFile)=>{
    const replacement=overlay.get(resolve(path))
    return replacement===undefined ? original(path,languageVersion,onError,shouldCreateNewSourceFile) : ts.createSourceFile(path,replacement,languageVersion,true)
  }
  const program=ts.createProgram(parsed.fileNames,options,host)
  const errors=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error)
  if(errors.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:p=>p,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}))
}
