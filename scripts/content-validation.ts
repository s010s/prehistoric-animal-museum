import { createHash } from 'node:crypto'
import { access, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isPublicationAuthorizedNarrationPlan, verifyNarrationPublicationAuthorization, validateNarrationPublicationAuthorization } from './narration-publication-authorization'

import { mainCollection } from '../src/content/collections/main'
import {
  ANIMAL_PACKAGE_HARD_CEILING_BYTES,
  ANIMAL_PACKAGE_TARGET_BYTES,
  MODEL_GLB_HARD_CEILING_BYTES,
  MODEL_GLB_TARGET_BYTES,
} from '../src/model-policy'
import {
  animalIdPattern,
  isoDatePattern,
  sha256Pattern,
  type AnimalCollection,
  type AnimalPackageDefinition,
  type AssetProvenance,
} from '../src/content/types'
import { repositoryRoot, type LoadedAnimalDefinition } from './content-data'

const MEBIBYTE = 1024 * 1024
const KIBIBYTE = 1024

export type ValidationSeverity = 'error' | 'warning' | 'manual-gate'

export interface ValidationIssue {
  readonly severity: ValidationSeverity
  readonly code: string
  readonly message: string
  readonly animalId?: string
  readonly path?: string
}

export interface GlbInspection {
  readonly version: number
  readonly declaredBytes: number
  readonly animationNames: readonly string[]
  readonly cubicSplineRotationTracks: number
  readonly externalUris: readonly string[]
  readonly meshoptCompressed: boolean
  readonly triangles: number
  readonly drawCalls: number
  readonly materials: number
  readonly bones: number
}

export interface ImageDimensions {
  readonly width: number
  readonly height: number
}

const canonicalVisualAssetPaths = [
  'model/model.glb',
  'images/poster.webp',
  'images/poster-portrait.webp',
  'images/thumbnail.webp',
  'backgrounds/landscape.webp',
  'backgrounds/portrait.webp',
] as const

const canonicalSourcePaths = [
  'animal.ts',
  'content.zh-CN.ts',
  'content.en.ts',
  'package.ts',
  'provenance.ts',
  ...canonicalVisualAssetPaths,
] as const

const assetLimits = {
  'model/model.glb': {
    target: MODEL_GLB_TARGET_BYTES,
    ceiling: MODEL_GLB_HARD_CEILING_BYTES,
  },
  'images/poster.webp': {
    target: 250 * KIBIBYTE,
    ceiling: 500 * KIBIBYTE,
  },
  'images/poster-portrait.webp': {
    target: 250 * KIBIBYTE,
    ceiling: 500 * KIBIBYTE,
  },
  'images/thumbnail.webp': {
    target: 60 * KIBIBYTE,
    ceiling: 120 * KIBIBYTE,
  },
  'audio/narration.zh-CN.mp3': {
    target: 200 * KIBIBYTE,
    ceiling: 300 * KIBIBYTE,
  },
  'audio/narration.en.mp3': {
    target: 200 * KIBIBYTE,
    ceiling: 300 * KIBIBYTE,
  },
} as const

const publicationLicenseAllowlist = new Set([
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-NC-SA-4.0',
  'LicenseRef-Public-Domain',
  'LicenseRef-OpenAI-Output',
  'MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
])

function issue(
  severity: ValidationSeverity,
  code: string,
  message: string,
  context: Pick<ValidationIssue, 'animalId' | 'path'> = {},
): ValidationIssue {
  return { severity, code, message, ...context }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function records(value: unknown): ReadonlyArray<Record<string, unknown>> {
  return readArray(value).filter(isRecord)
}

interface LocaleCompletenessCandidate {
  readonly id: string
  readonly status: 'draft' | 'published'
  readonly content: unknown
  readonly narration: unknown
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isHttpsUrl(value: unknown): boolean {
  if (!isNonEmptyString(value)) {
    return false
  }
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function incompletePublicContentPaths(value: Record<string, unknown>): string[] {
  const paths: string[] = []
  for (const field of [
    'name',
    'classificationLabel',
    'visibleFeature',
    'parentClassificationNote',
  ] as const) {
    if (!isNonEmptyString(value[field])) {
      paths.push(field)
    }
  }

  const narration = isRecord(value.narration) ? value.narration : {}
  const sentences = readArray(narration.sentences)
  if (
    sentences.length !== 2 ||
    !sentences.every(isNonEmptyString)
  ) {
    paths.push('narration.sentences')
  }
  const pronunciation = readArray(narration.pronunciation)
  if (
    pronunciation.length === 0 ||
    !pronunciation.every(
      (entry) =>
        isRecord(entry) &&
        isNonEmptyString(entry.text) &&
        isNonEmptyString(entry.reading) &&
        (entry.note === undefined || isNonEmptyString(entry.note)),
    )
  ) {
    paths.push('narration.pronunciation')
  }

  const facts = isRecord(value.facts) ? value.facts : {}
  if (!isNonEmptyString(facts.period)) {
    paths.push('facts.period')
  }
  const discoveryRegions = readArray(facts.discoveryRegions)
  if (
    discoveryRegions.length === 0 ||
    !discoveryRegions.every(isNonEmptyString)
  ) {
    paths.push('facts.discoveryRegions')
  }
  if (
    !['herbivore', 'carnivore', 'omnivore', 'unknown'].includes(
      readString(facts.diet) ?? '',
    )
  ) {
    paths.push('facts.diet')
  }
  const size = isRecord(facts.size) ? facts.size : {}
  const sizeKind = readString(size.kind)
  const validUnknownSize = sizeKind === 'unknown' && isNonEmptyString(size.note)
  const validMeasuredSize = ['body-length', 'shoulder-height', 'standing-height', 'wingspan', 'group-range'].includes(sizeKind ?? '') &&
    isPositiveFiniteNumber(size.minMeters) && isPositiveFiniteNumber(size.maxMeters) &&
    size.maxMeters >= size.minMeters && (sizeKind !== 'group-range' || isNonEmptyString(size.note))
  if (!validUnknownSize && !validMeasuredSize) paths.push('facts.size')


  const sources = readArray(value.sources)
  if (
    sources.length < 1 ||
    sources.length > 3 ||
    !sources.every(
      (source) =>
        isRecord(source) &&
        isNonEmptyString(source.title) &&
        isHttpsUrl(source.url) &&
        isNonEmptyString(source.accessedOn) &&
        isoDatePattern.test(source.accessedOn),
    )
  ) {
    paths.push('sources')
  }

  const editorial = isRecord(value.editorial) ? value.editorial : {}
  if (!isNonEmptyString(editorial.editedBy)) {
    paths.push('editorial.editedBy')
  }
  if (!isNonEmptyString(editorial.reviewedBy)) {
    paths.push('editorial.reviewedBy')
  }
  if (
    !isNonEmptyString(editorial.reviewedOn) ||
    !isoDatePattern.test(editorial.reviewedOn)
  ) {
    paths.push('editorial.reviewedOn')
  }
  if (
    !Array.isArray(editorial.uncertaintyNotes) ||
    !editorial.uncertaintyNotes.every(isNonEmptyString)
  ) {
    paths.push('editorial.uncertaintyNotes')
  }

  return paths
}

interface PublicTextEntry {
  readonly path: string
  readonly value: string
}

function publicTextEntries(value: Record<string, unknown>): PublicTextEntry[] {
  const entries: PublicTextEntry[] = []
  const add = (path: string, candidate: unknown) => {
    if (isNonEmptyString(candidate)) {
      entries.push({ path, value: candidate.trim() })
    }
  }
  for (const field of [
    'name',
    'classificationLabel',
    'visibleFeature',
    'parentClassificationNote',
  ] as const) {
    add(field, value[field])
  }

  const narration = isRecord(value.narration) ? value.narration : {}
  readArray(narration.sentences).forEach((sentence, index) =>
    add(`narration.sentences.${index}`, sentence),
  )
  records(narration.pronunciation).forEach((entry, index) => {
    add(`narration.pronunciation.${index}.text`, entry.text)
    add(`narration.pronunciation.${index}.reading`, entry.reading)
    add(`narration.pronunciation.${index}.note`, entry.note)
  })

  const facts = isRecord(value.facts) ? value.facts : {}
  add('facts.period', facts.period)
  readArray(facts.discoveryRegions).forEach((region, index) =>
    add(`facts.discoveryRegions.${index}`, region),
  )
  const size = isRecord(facts.size) ? facts.size : {}
  add('facts.size.note', size.note)

  const editorial = isRecord(value.editorial) ? value.editorial : {}
  readArray(editorial.uncertaintyNotes).forEach((note, index) =>
    add(`editorial.uncertaintyNotes.${index}`, note),
  )
  return entries
}

const hanCharacterPattern = /\p{Script=Han}/u
const americanSpellingPattern =
  /\b(?:behaviors?|catalogs?|cataloged|cataloging|centers?|centered|centering|colors?|colored|coloring|colorful|favorites?|gray|grays|recognized?|recognizes|recognizing|organized?|organizes|organizing|theaters?|traveled|traveling)\b/iu

function publicTextFingerprint(value: Record<string, unknown>): string {
  return publicTextEntries(value)
    .map(({ value: text }) => text.normalize('NFKC').replace(/\s+/g, ' ').trim())
    .join('\u241e')
}

export function validateLocaleCompleteness(
  definition: LocaleCompletenessCandidate,
): ValidationIssue[] {
  if (definition.status === 'draft') {
    return []
  }

  const issues: ValidationIssue[] = []
  const content = isRecord(definition.content) ? definition.content : {}
  const narration = isRecord(definition.narration)
    ? definition.narration
    : {}

  for (const locale of ['zh-CN', 'en'] as const) {
    const localeContent = content[locale]
    if (!isRecord(localeContent)) {
      issues.push(
        issue(
          'error',
          'PUBLISHED_LOCALE_CONTENT_MISSING',
          `已发布动物必须提供完整的 ${locale} 公开内容。`,
          { animalId: definition.id, path: `content.${locale}` },
        ),
      )
    } else {
      for (const incompletePath of incompletePublicContentPaths(localeContent)) {
        issues.push(
          issue(
            'error',
            'PUBLISHED_LOCALE_CONTENT_INCOMPLETE',
            `已发布动物的 ${locale} 公开内容字段不完整：${incompletePath}。`,
            {
              animalId: definition.id,
              path: `content.${locale}.${incompletePath}`,
            },
          ),
        )
      }
      const publicText = publicTextEntries(localeContent)
      if (
        locale === 'zh-CN' &&
        !publicText.some(({ value: text }) => hanCharacterPattern.test(text))
      ) {
        issues.push(
          issue(
            'error',
            'PUBLISHED_LOCALE_LANGUAGE_INVALID',
            'zh-CN 公开内容必须是简体中文，不能复制英文内容充数。',
            { animalId: definition.id, path: 'content.zh-CN' },
          ),
        )
      }
      if (locale === 'en') {
        for (const entry of publicText) {
          if (hanCharacterPattern.test(entry.value)) {
            issues.push(
              issue(
                'error',
                'PUBLISHED_LOCALE_LANGUAGE_INVALID',
                `英文公开内容包含汉字：${entry.path}。`,
                {
                  animalId: definition.id,
                  path: `content.en.${entry.path}`,
                },
              ),
            )
          }
          if (americanSpellingPattern.test(entry.value)) {
            issues.push(
              issue(
                'error',
                'PUBLISHED_ENGLISH_STYLE_INVALID',
                `英文公开内容必须使用英式拼写：${entry.path}。`,
                {
                  animalId: definition.id,
                  path: `content.en.${entry.path}`,
                },
              ),
            )
          }
        }
      }
    }

    const localeNarration = narration[locale]
    if (!isRecord(localeNarration) || localeNarration.status !== 'ready') {
      issues.push(
        issue(
          'error',
          'PUBLISHED_LOCALE_NARRATION_NOT_READY',
          `已发布动物必须提供通过听审的 ${locale} 旁白。`,
          { animalId: definition.id, path: `audio/narration.${locale}.mp3` },
        ),
      )
    } else {
      const expectedSourcePath = `audio/narration.${locale}.mp3`
      if (localeNarration.sourcePath !== expectedSourcePath) {
        issues.push(
          issue(
            'error',
            'PUBLISHED_LOCALE_NARRATION_INVALID',
            `${locale} 旁白必须使用规范路径 ${expectedSourcePath}。`,
            { animalId: definition.id, path: `narration.${locale}.sourcePath` },
          ),
        )
      }
      if (localeNarration.mimeType !== 'audio/mpeg') {
        issues.push(
          issue(
            'error',
            'PUBLISHED_LOCALE_NARRATION_INVALID',
            `${locale} 旁白必须声明 audio/mpeg。`,
            { animalId: definition.id, path: `narration.${locale}.mimeType` },
          ),
        )
      }
      const expectedLanguage = locale === 'zh-CN' ? 'Chinese' : 'English'
      if (
        localeNarration.speaker !== 'Serena' ||
        localeNarration.language !== expectedLanguage
      ) {
        issues.push(
          issue(
            'error',
            'PUBLISHED_LOCALE_NARRATION_VOICE_INVALID',
            `${locale} 旁白必须使用 Serena，并声明 ${expectedLanguage}。`,
            { animalId: definition.id, path: `narration.${locale}` },
          ),
        )
      }
      if (localeNarration.humanReviewStatus !== 'approved' && !isPublicationAuthorizedNarrationPlan(localeNarration)) {
        issues.push(
          issue(
            'error',
            'PUBLISHED_LOCALE_NARRATION_REVIEW_MISSING',
            `已发布动物的 ${locale} 旁白必须有完整听审通过记录或明确的公开发布授权。`,
            {
              animalId: definition.id,
              path: `narration.${locale}.humanReviewStatus`,
            },
          ),
        )
      }
    }
  }

  const zhCNContent = content['zh-CN']
  const englishContent = content.en
  if (
    isRecord(zhCNContent) &&
    isRecord(englishContent) &&
    publicTextFingerprint(zhCNContent) === publicTextFingerprint(englishContent)
  ) {
    issues.push(
      issue(
        'error',
        'PUBLISHED_LOCALE_CONTENT_DUPLICATED',
        '中英文公开内容不能是同一份文本。',
        { animalId: definition.id, path: 'content.en' },
      ),
    )
  }

  return issues
}

function byteAt(buffer: Buffer, offset: number): number {
  const value: number | undefined = buffer[offset]
  if (value === undefined) {
    throw new Error(`文件在字节 ${offset} 处意外结束。`)
  }
  return value
}

export function sha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export function inspectGlb(buffer: Buffer): GlbInspection {
  if (buffer.byteLength < 20 || buffer.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('文件不是有效的 GLB 容器。')
  }

  const version = buffer.readUInt32LE(4)
  const declaredBytes = buffer.readUInt32LE(8)
  const jsonChunkBytes = buffer.readUInt32LE(12)
  const jsonChunkType = buffer.readUInt32LE(16)

  if (version !== 2) {
    throw new Error(`仅支持 glTF 2，检测到版本 ${version}。`)
  }
  if (declaredBytes !== buffer.byteLength) {
    throw new Error(
      `GLB 声明长度 ${declaredBytes} 与文件长度 ${buffer.byteLength} 不一致。`,
    )
  }
  if (jsonChunkType !== 0x4e4f534a || 20 + jsonChunkBytes > buffer.byteLength) {
    throw new Error('GLB 缺少有效的 JSON 首块。')
  }

  const jsonText = buffer
    .toString('utf8', 20, 20 + jsonChunkBytes)
    .replaceAll(String.fromCharCode(0), '')
    .trimEnd()
  const parsed = JSON.parse(jsonText) as unknown
  if (!isRecord(parsed)) {
    throw new Error('GLB JSON 根节点必须是对象。')
  }

  const animationNames = records(parsed.animations)
    .map((animation) => readString(animation.name))
    .filter((name): name is string => name !== undefined)
  let cubicSplineRotationTracks = 0
  for (const animation of records(parsed.animations)) {
    const samplers = records(animation.samplers)
    for (const channel of records(animation.channels)) {
      const target = isRecord(channel.target) ? channel.target : {}
      const samplerIndex = readNumber(channel.sampler)
      const sampler =
        samplerIndex === undefined ? undefined : samplers[samplerIndex]
      if (
        readString(target.path) === 'rotation' &&
        sampler &&
        readString(sampler.interpolation) === 'CUBICSPLINE'
      ) {
        cubicSplineRotationTracks += 1
      }
    }
  }

  const externalUris = [
    ...records(parsed.buffers),
    ...records(parsed.images),
  ]
    .map((entry) => readString(entry.uri))
    .filter(
      (uri): uri is string =>
        uri !== undefined && !uri.startsWith('data:'),
    )

  const accessors = records(parsed.accessors)
  let triangles = 0
  let drawCalls = 0
  const materialIndices = new Set<number>()

  for (const mesh of records(parsed.meshes)) {
    for (const primitive of records(mesh.primitives)) {
      drawCalls += 1
      const materialIndex = readNumber(primitive.material)
      if (materialIndex !== undefined) {
        materialIndices.add(materialIndex)
      }

      const indexAccessor = readNumber(primitive.indices)
      const attributes = isRecord(primitive.attributes)
        ? primitive.attributes
        : {}
      const positionAccessor = readNumber(attributes.POSITION)
      const accessorIndex = indexAccessor ?? positionAccessor
      const accessor =
        accessorIndex === undefined ? undefined : accessors[accessorIndex]
      const elementCount =
        accessor === undefined ? undefined : readNumber(accessor.count)
      const mode = readNumber(primitive.mode) ?? 4
      if (elementCount === undefined) {
        continue
      }
      if (mode === 4) {
        triangles += Math.floor(elementCount / 3)
      } else if (mode === 5 || mode === 6) {
        triangles += Math.max(0, elementCount - 2)
      }
    }
  }

  const bones = records(parsed.skins).reduce(
    (maximum, skin) =>
      Math.max(maximum, readArray(skin.joints).length),
    0,
  )

  return {
    version,
    declaredBytes,
    animationNames,
    cubicSplineRotationTracks,
    externalUris,
    meshoptCompressed: readArray(parsed.extensionsUsed).includes(
      'EXT_meshopt_compression',
    ),
    triangles,
    drawCalls,
    materials: materialIndices.size,
    bones,
  }
}

export function inspectWebp(buffer: Buffer): ImageDimensions {
  if (
    buffer.byteLength < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new Error('文件不是有效的 WebP。')
  }

  const chunkType = buffer.toString('ascii', 12, 16)
  const dataOffset = 20

  if (chunkType === 'VP8X') {
    return {
      width:
        1 +
        byteAt(buffer, dataOffset + 4) +
        byteAt(buffer, dataOffset + 5) * 256 +
        byteAt(buffer, dataOffset + 6) * 65_536,
      height:
        1 +
        byteAt(buffer, dataOffset + 7) +
        byteAt(buffer, dataOffset + 8) * 256 +
        byteAt(buffer, dataOffset + 9) * 65_536,
    }
  }

  if (chunkType === 'VP8 ') {
    if (
      buffer[dataOffset + 3] !== 0x9d ||
      buffer[dataOffset + 4] !== 0x01 ||
      buffer[dataOffset + 5] !== 0x2a
    ) {
      throw new Error('WebP VP8 帧头无效。')
    }
    return {
      width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
      height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
    }
  }

  if (chunkType === 'VP8L') {
    if (buffer[dataOffset] !== 0x2f) {
      throw new Error('WebP VP8L 帧头无效。')
    }
    const byte1 = byteAt(buffer, dataOffset + 1)
    const byte2 = byteAt(buffer, dataOffset + 2)
    const byte3 = byteAt(buffer, dataOffset + 3)
    const byte4 = byteAt(buffer, dataOffset + 4)
    return {
      width: 1 + byte1 + ((byte2 & 0x3f) << 8),
      height: 1 + (byte2 >> 6) + (byte3 << 2) + ((byte4 & 0x0f) << 10),
    }
  }

  throw new Error(`不支持的 WebP 块类型 “${chunkType}”。`)
}

export function validateRecordedAsset(
  record: AssetProvenance,
  actualBytes: number,
  actualSha256: string,
  animalId = 'unknown',
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const context = { animalId, path: record.assetPath }

  if (!sha256Pattern.test(record.runtime.sha256)) {
    issues.push(
      issue('error', 'INVALID_RECORDED_HASH', '记录的 SHA-256 格式无效。', context),
    )
  } else if (record.runtime.sha256 !== actualSha256) {
    issues.push(
      issue(
        'error',
        'ASSET_HASH_MISMATCH',
        `SHA-256 不匹配：记录为 ${record.runtime.sha256}，实际为 ${actualSha256}。`,
        context,
      ),
    )
  }

  if (record.runtime.bytes !== actualBytes) {
    issues.push(
      issue(
        'error',
        'ASSET_SIZE_MISMATCH',
        `字节数不匹配：记录为 ${record.runtime.bytes}，实际为 ${actualBytes}。`,
        context,
      ),
    )
  }

  if (!publicationLicenseAllowlist.has(record.license.spdx)) {
    issues.push(
      issue(
        'error',
        'LICENSE_NOT_ALLOWED',
        `发布许可 “${record.license.spdx}” 不在允许列表中。`,
        context,
      ),
    )
  }

  if (!record.redistributionAllowed) {
    issues.push(
      issue(
        'error',
        'REDISTRIBUTION_NOT_ALLOWED',
        '来源记录未确认衍生运行时资产可再分发。',
        context,
      ),
    )
  }

  const limit = assetLimits[record.assetPath as keyof typeof assetLimits]
  if (limit !== undefined && actualBytes > limit.ceiling) {
    issues.push(
      issue(
        'error',
        'ASSET_HARD_CEILING',
        `文件 ${actualBytes} B 超过发布上限 ${limit.ceiling} B。`,
        context,
      ),
    )
  } else if (limit !== undefined && actualBytes > limit.target) {
    issues.push(
      issue(
        'warning',
        'ASSET_TARGET_EXCEEDED',
        `文件 ${actualBytes} B 超过优化目标 ${limit.target} B。`,
        context,
      ),
    )
  }

  return issues
}

export function validateCollection(
  collection: AnimalCollection,
  definitions: readonly AnimalPackageDefinition[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const seenIds = new Set<string>()
  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  )

  for (const animalId of collection.animalIds) {
    if (seenIds.has(animalId)) {
      issues.push(
        issue(
          'error',
          'COLLECTION_DUPLICATE',
          `集合 “${collection.id}” 重复包含 “${animalId}”。`,
          { animalId },
        ),
      )
      continue
    }
    seenIds.add(animalId)

    const definition = definitionsById.get(animalId)
    if (definition === undefined) {
      issues.push(
        issue(
          'error',
          'COLLECTION_UNKNOWN_ID',
          `集合 “${collection.id}” 引用了未知动物 “${animalId}”。`,
          { animalId },
        ),
      )
    } else if (definition.status !== 'published') {
      issues.push(
        issue(
          'error',
          'COLLECTION_DRAFT_ID',
          `集合 “${collection.id}” 不能包含草稿动物 “${animalId}”。`,
          { animalId },
        ),
      )
    }
  }

  if (!seenIds.has(collection.defaultAnimalId)) {
    issues.push(
      issue(
        'error',
        'COLLECTION_DEFAULT_MISSING',
        `默认动物 “${collection.defaultAnimalId}” 不在集合中。`,
        { animalId: collection.defaultAnimalId },
      ),
    )
  }

  for (const definition of definitions) {
    if (definition.status === 'published' && !seenIds.has(definition.id)) {
      issues.push(
        issue(
          'error',
          'PUBLISHED_ANIMAL_NOT_COLLECTED',
          `已发布动物 “${definition.id}” 未进入主集合。`,
          { animalId: definition.id },
        ),
      )
    }
  }

  if (!collection.loop) {
    issues.push(
      issue(
        'error',
        'MAIN_COLLECTION_NOT_LOOPING',
        '主集合必须显式设置 loop: true。',
      ),
    )
  }

  return issues
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function validateContentFields(
  definition: AnimalPackageDefinition,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [...validateLocaleCompleteness(definition)]
  const context = { animalId: definition.id }
  const content = definition.content['zh-CN']

  if (!animalIdPattern.test(definition.id)) {
    issues.push(
      issue(
        'error',
        'INVALID_ANIMAL_ID',
        `动物 ID “${definition.id}” 必须是小写 ASCII kebab-case。`,
        context,
      ),
    )
  }
  const atmosphereHabitat = {
    air: 'air',
    forest: 'land',
    ice: 'land',
    plains: 'land',
    underwater: 'water',
  } as const
  if (atmosphereHabitat[definition.atmosphere] !== definition.habitat) {
    issues.push(
      issue(
        'error',
        'ATMOSPHERE_HABITAT_MISMATCH',
        `氛围 “${definition.atmosphere}” 与栖息地 “${definition.habitat}” 不匹配。`,
        context,
      ),
    )
  }
  const toneMappingExposure =
    definition.presentation.toneMappingExposure
  if (
    toneMappingExposure !== undefined &&
    (toneMappingExposure < 0.75 || toneMappingExposure > 2)
  ) {
    issues.push(
      issue(
        'error',
        'INVALID_TONE_MAPPING_EXPOSURE',
        '模型曝光必须在 0.75–2 之间。',
        context,
      ),
    )
  }
  const cameraLightScale = definition.presentation.cameraLightScale
  if (
    cameraLightScale !== undefined &&
    (cameraLightScale < 0.75 || cameraLightScale > 2.5)
  ) {
    issues.push(
      issue(
        'error',
        'INVALID_CAMERA_LIGHT_SCALE',
        '相机跟随补光倍率必须在 0.75–2.5 之间。',
        context,
      ),
    )
  }
  if (!content) {
    issues.push(
      issue(
        definition.status === 'published' ? 'error' : 'warning',
        'ZH_CONTENT_MISSING',
        '动物包缺少简体中文内容。',
        context,
      ),
    )
    return issues
  }
  const size = content.facts.size
  if (size.kind === 'unknown'
    ? !isNonEmptyString(size.note)
    : !isPositiveFiniteNumber(size.minMeters) || !isPositiveFiniteNumber(size.maxMeters) || size.maxMeters < size.minMeters
  ) {
    issues.push(
      issue('error', 'INVALID_SIZE_RANGE', '体型数值范围无效。', context),
    )
  }
  if (
    content.facts.size.kind === 'group-range' &&
    content.facts.size.note.trim().length === 0
  ) {
    issues.push(
      issue(
        'error',
        'GROUP_SIZE_NOTE_MISSING',
        '类群级体型范围必须说明它不等同于当前模型个体的尺寸。',
        context,
      ),
    )
  }
  for (const locale of ['zh-CN', 'en'] as const) {
    const localeContent = definition.content[locale]
    if (!localeContent) {
      continue
    }
    if (localeContent.sources.length < 1 || localeContent.sources.length > 3) {
      issues.push(
        issue(
          'error',
          'INVALID_SOURCE_COUNT',
          `${locale} 内容必须包含 1–3 个入门参考来源。`,
          context,
        ),
      )
    }
    for (const source of localeContent.sources) {
      if (!isoDatePattern.test(source.accessedOn)) {
        issues.push(
          issue(
            'error',
            'INVALID_SOURCE_DATE',
            `${locale} 来源 “${source.title}” 的访问日期无效。`,
            context,
          ),
        )
      }
    }
    if (!isoDatePattern.test(localeContent.editorial.reviewedOn)) {
      issues.push(
        issue(
          'error',
          'INVALID_REVIEW_DATE',
          `${locale} 内容复核日期无效。`,
          context,
        ),
      )
    }
  }

  return issues
}

async function validatePublishedPackage(
  loaded: LoadedAnimalDefinition,
): Promise<ValidationIssue[]> {
  const { definition, directoryName, directoryPath } = loaded
  const issues: ValidationIssue[] = []
  const context = { animalId: definition.id }

  if (directoryName !== definition.id) {
    issues.push(
      issue(
        'error',
        'DIRECTORY_ID_MISMATCH',
        `目录 “${directoryName}” 与包 ID “${definition.id}” 不一致。`,
        context,
      ),
    )
  }

  issues.push(...validateContentFields(definition))

  if (definition.status !== 'published') {
    issues.push(
      issue(
        'warning',
        'DRAFT_PACKAGE_SKIPPED',
        `草稿包 “${definition.id}” 不进入生产校验或目录。`,
        context,
      ),
    )
    return issues
  }

  for (const relativePath of canonicalSourcePaths) {
    if (!(await pathExists(join(directoryPath, relativePath)))) {
      issues.push(
        issue(
          'error',
          'CANONICAL_PATH_MISSING',
          `缺少规范路径 ${relativePath}。`,
          { ...context, path: relativePath },
        ),
      )
    }
  }

  const expectedRuntimePaths = new Set<string>(canonicalVisualAssetPaths)
  for (const locale of ['zh-CN', 'en'] as const) {
    const narration = definition.narration[locale]
    if (!narration || narration.status !== 'ready') {
      issues.push(
        issue(
          'error',
          'PUBLISHED_LOCALE_NARRATION_NOT_READY',
          `已发布动物必须提供通过听审的 ${locale} 旁白。`,
          { ...context, path: `audio/narration.${locale}.mp3` },
        ),
      )
      continue
    }
    expectedRuntimePaths.add(narration.sourcePath)
    if (!(await pathExists(join(directoryPath, narration.sourcePath)))) {
      issues.push(
        issue(
          'error',
          'NARRATION_FILE_MISSING',
          `已声明完成的介绍音频不存在：${narration.sourcePath}。`,
          { ...context, path: narration.sourcePath },
        ),
      )
    }
  }

  const provenanceByPath = new Map<string, AssetProvenance>()
  for (const record of definition.provenance) {
    if (provenanceByPath.has(record.assetPath)) {
      issues.push(
        issue(
          'error',
          'DUPLICATE_PROVENANCE',
          `资产 ${record.assetPath} 有重复来源记录。`,
          { ...context, path: record.assetPath },
        ),
      )
    }
    provenanceByPath.set(record.assetPath, record)
  }

  const narrationRecords = (['zh-CN', 'en'] as const).map((locale) => ({
    locale,
    record: provenanceByPath.get(`audio/narration.${locale}.mp3`),
  }))
  const [zhCNNarrationRecord, englishNarrationRecord] = narrationRecords.map(
    ({ record }) => record,
  )
  if (
    zhCNNarrationRecord &&
    englishNarrationRecord &&
    zhCNNarrationRecord.runtime.sha256 === englishNarrationRecord.runtime.sha256
  ) {
    issues.push(
      issue(
        'error',
        'NARRATION_LOCALES_IDENTICAL',
        '中英文旁白不能使用同一份音频。',
        { ...context, path: 'audio/narration.en.mp3' },
      ),
    )
  }

  for (const { locale, record } of narrationRecords) {
    if (!record) {
      continue
    }
    const expectedScript = definition.content[locale]?.narration.sentences.join(
      locale === 'zh-CN' ? '' : ' ',
    )
    const generatedSource =
      record.source.type === 'generated' ? record.source : undefined
    if (
      record.kind !== 'narration' ||
      !generatedSource ||
      !generatedSource.tool.includes('Qwen3-TTS') ||
      !generatedSource.revision?.includes('Serena')
    ) {
      issues.push(
        issue(
          'error',
          'NARRATION_GENERATION_EVIDENCE_INVALID',
          `${locale} 旁白必须记录 Qwen3-TTS Serena 的离线生成证据。`,
          { ...context, path: record.assetPath },
        ),
      )
    } else if (
      expectedScript &&
      generatedSource.prompt.normalize('NFKC').replace(/\s+/g, ' ').trim() !==
        expectedScript.normalize('NFKC').replace(/\s+/g, ' ').trim()
    ) {
      issues.push(
        issue(
          'error',
          'NARRATION_SCRIPT_MISMATCH',
          `${locale} 旁白来源记录没有绑定当前两句公开脚本。`,
          { ...context, path: record.assetPath },
        ),
      )
    }

    const availableEvidence = await Promise.all(
      record.evidencePaths.map(async (evidencePath) => {
        const absoluteEvidencePath = join(directoryPath, evidencePath)
        return (await pathExists(absoluteEvidencePath))
          ? readFile(absoluteEvidencePath, 'utf8')
          : ''
      }),
    )
    const evidenceText = availableEvidence.join('\n')
    const listeningApproved =
      /human listening review:\s*approved/iu.test(evidenceText) ||
      /listened to and approved by the project owner/iu.test(evidenceText)
    const publicationPlan = isPublicationAuthorizedNarrationPlan(definition.narration[locale])
    const publicationAcceptance = publicationPlan
      ? await verifyNarrationPublicationAuthorization(definition.narration[locale], {
        animalId: definition.id, locale, phase: 'gallery', sha256: record.runtime.sha256,
      }, resolve(directoryPath, '../../../..'))
      : false
    const languageEvidence = `${generatedSource?.title ?? ''}\n${evidenceText}`
    const languageRecorded =
      locale === 'zh-CN'
        ? /language:\s*Chinese|Mandarin narration/iu.test(languageEvidence)
        : /language:\s*English|English narration/iu.test(languageEvidence)
    if (
      !/Serena/iu.test(evidenceText) ||
      !(publicationPlan ? publicationAcceptance : listeningApproved) ||
      !/project owner/iu.test(evidenceText) ||
      !languageRecorded
    ) {
      issues.push(
        issue(
          'error',
          publicationPlan ? 'NARRATION_PUBLICATION_AUTHORIZATION_INVALID' : 'NARRATION_LISTENING_EVIDENCE_INVALID',
          publicationPlan
            ? `${locale} 旁白缺少当前音频与所有者公开发布授权的精确绑定。`
            : `${locale} 旁白缺少 Serena 与项目所有者完整听审通过证据。`,
          { ...context, path: record.assetPath },
        ),
      )
    }
  }

  for (const relativePath of expectedRuntimePaths) {
    const record = provenanceByPath.get(relativePath)
    if (record === undefined) {
      issues.push(
        issue(
          'error',
          'PROVENANCE_MISSING',
          `资产 ${relativePath} 缺少来源记录。`,
          { ...context, path: relativePath },
        ),
      )
      continue
    }

    const absolutePath = join(directoryPath, relativePath)
    if (!(await pathExists(absolutePath))) {
      continue
    }
    const file = await readFile(absolutePath)
    issues.push(
      ...validateRecordedAsset(
        record,
        file.byteLength,
        sha256(file),
        definition.id,
      ),
    )

    for (const evidencePath of record.evidencePaths) {
      if (!(await pathExists(join(directoryPath, evidencePath)))) {
        issues.push(
          issue(
            'error',
            'EVIDENCE_MISSING',
            `来源证据不存在：${evidencePath}。`,
            { ...context, path: evidencePath },
          ),
        )
      }
    }
  }

  for (const record of definition.provenance) {
    if (!expectedRuntimePaths.has(record.assetPath)) {
      issues.push(
        issue(
          'error',
          'UNEXPECTED_PROVENANCE',
          `来源记录 ${record.assetPath} 没有对应的发布资产声明。`,
          { ...context, path: record.assetPath },
        ),
      )
    }
  }

  const modelPath = join(directoryPath, 'model/model.glb')
  if (await pathExists(modelPath)) {
    try {
      const inspection = inspectGlb(await readFile(modelPath))
      if (
        definition.animation !== undefined &&
        !inspection.animationNames.includes(definition.animation.clip)
      ) {
        issues.push(
          issue(
            'error',
            'ANIMATION_CLIP_MISSING',
            `GLB 不包含声明的动画 “${definition.animation.clip}”。`,
            { ...context, path: 'model/model.glb' },
          ),
        )
      }
      if (
        inspection.meshoptCompressed &&
        inspection.cubicSplineRotationTracks > 0
      ) {
        issues.push(
          issue(
            'error',
            'MESHOPT_CUBIC_ROTATION',
            `GLB 含 ${inspection.cubicSplineRotationTracks} 条经 Meshopt 压缩的 CUBICSPLINE 旋转轨道；必须先重采样为 LINEAR，避免四元数切线被压缩滤镜误处理。`,
            { ...context, path: 'model/model.glb' },
          ),
        )
      }
      if (inspection.externalUris.length > 0) {
        issues.push(
          issue(
            'error',
            'GLB_EXTERNAL_URI',
            `GLB 含外部资源：${inspection.externalUris.join(', ')}。`,
            { ...context, path: 'model/model.glb' },
          ),
        )
      }
      const complexityChecks = [
        ['三角形', inspection.triangles, 100_000, 250_000],
        ['绘制批次', inspection.drawCalls, 12, 24],
        ['骨骼', inspection.bones, 120, 200],
      ] as const
      for (const [label, measured, target, ceiling] of complexityChecks) {
        if (measured > ceiling) {
          issues.push(
            issue(
              'error',
              'GLB_COMPLEXITY_CEILING',
              `${label} ${measured} 超过发布上限 ${ceiling}。`,
              { ...context, path: 'model/model.glb' },
            ),
          )
        } else if (measured > target) {
          issues.push(
            issue(
              'warning',
              'GLB_COMPLEXITY_TARGET',
              `${label} ${measured} 超过优化目标 ${target}。`,
              { ...context, path: 'model/model.glb' },
            ),
          )
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '未知 GLB 解析错误。'
      issues.push(
        issue('error', 'GLB_INVALID', message, {
          ...context,
          path: 'model/model.glb',
        }),
      )
    }
  }

  const imageExpectations = [
    ['backgrounds/landscape.webp', 16 / 9],
    ['backgrounds/portrait.webp', 9 / 16],
    ['images/poster.webp', 16 / 9],
    ['images/poster-portrait.webp', 390 / 844],
  ] as const
  for (const [relativePath, expectedRatio] of imageExpectations) {
    const absolutePath = join(directoryPath, relativePath)
    if (!(await pathExists(absolutePath))) {
      continue
    }
    try {
      const dimensions = inspectWebp(await readFile(absolutePath))
      const actualRatio = dimensions.width / dimensions.height
      if (Math.abs(actualRatio - expectedRatio) > 0.025) {
        issues.push(
          issue(
            'error',
            'IMAGE_ASPECT_RATIO',
            `${dimensions.width} × ${dimensions.height} 不符合所需画幅。`,
            { ...context, path: relativePath },
          ),
        )
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '未知图像解析错误。'
      issues.push(
        issue('error', 'IMAGE_INVALID', message, {
          ...context,
          path: relativePath,
        }),
      )
    }
  }

  const thumbnailPath = join(directoryPath, 'images/thumbnail.webp')
  if (await pathExists(thumbnailPath)) {
    try {
      const dimensions = inspectWebp(await readFile(thumbnailPath))
      if (dimensions.width < 240 || dimensions.height < 180) {
        issues.push(
          issue(
            'error',
            'THUMBNAIL_TOO_SMALL',
            `缩略图 ${dimensions.width} × ${dimensions.height} 低于最小可用尺寸。`,
            { ...context, path: 'images/thumbnail.webp' },
          ),
        )
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '未知图像解析错误。'
      issues.push(
        issue('error', 'IMAGE_INVALID', message, {
          ...context,
          path: 'images/thumbnail.webp',
        }),
      )
    }
  }

  const backgroundBytes = await Promise.all(
    ['backgrounds/landscape.webp', 'backgrounds/portrait.webp'].map(
      async (relativePath) =>
        (await pathExists(join(directoryPath, relativePath)))
          ? (await stat(join(directoryPath, relativePath))).size
          : 0,
    ),
  )
  const backgroundTotal = backgroundBytes.reduce(
    (total, bytes) => total + bytes,
    0,
  )
  if (backgroundTotal > 2 * MEBIBYTE) {
    issues.push(
      issue(
        'error',
        'BACKGROUND_PAIR_CEILING',
        `横竖背景合计 ${backgroundTotal} B 超过 2 MiB 上限。`,
        context,
      ),
    )
  } else if (backgroundTotal > 1.2 * MEBIBYTE) {
    issues.push(
      issue(
        'warning',
        'BACKGROUND_PAIR_TARGET',
        `横竖背景合计 ${backgroundTotal} B 超过 1.2 MiB 目标。`,
        context,
      ),
    )
  }

  let packageBytes = 0
  for (const relativePath of expectedRuntimePaths) {
    const absolutePath = join(directoryPath, relativePath)
    if (await pathExists(absolutePath)) {
      packageBytes += (await stat(absolutePath)).size
    }
  }
  if (packageBytes > ANIMAL_PACKAGE_HARD_CEILING_BYTES) {
    issues.push(
      issue(
        'error',
        'PACKAGE_CEILING',
        `运行时包 ${packageBytes} B 超过 23 MiB 上限。`,
        context,
      ),
    )
  } else if (packageBytes > ANIMAL_PACKAGE_TARGET_BYTES) {
    issues.push(
      issue(
        'warning',
        'PACKAGE_TARGET',
        `运行时包 ${packageBytes} B 超过 14 MiB 目标。`,
        context,
      ),
    )
  }

  return issues
}

export async function validateContent(
  packages: readonly LoadedAnimalDefinition[],
  collection: AnimalCollection = mainCollection,
): Promise<ValidationIssue[]> {
  const packageIssues = await Promise.all(
    packages.map((loaded) => validatePublishedPackage(loaded)),
  )
  const definitions = packages.map(({ definition }) => definition)
  return [
    ...packageIssues.flat(),
    ...validateCollection(collection, definitions),
    ...(await validateNarrationPublicationAuthorization(repositoryRoot) ? [] : [issue(
      'error',
      'NARRATION_PUBLICATION_AUTHORIZATION_INVALID',
      '公开发布授权没有精确绑定当前旁白文件与比较场景元数据。',
      { path: 'src/content/narration-publication-authorization.json' },
    )]),
  ]
}
