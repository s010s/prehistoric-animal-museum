import type { AnimalCollection } from '../types'

export const mainCollection = {
  id: 'main',
  animalIds: [
    'stegosaurus',
    'pteranodon',
    'pachycephalosaurus',
    'ankylosaurus',
    'regaliceratops',
    'ichthyosaur',
    'opabinia',
    'tyrannosaurus-rex',
    'rhamphorhynchus',
    'anurognathus',
    'hallucigenia',
    'triceratops',
    'apatosaurus',
    'livyatan',
    'sarcosuchus',
    'plesiosaurus',
    'gigantoraptor',
    'parasaurolophus',
    'tupandactylus',
    'therizinosaurus',
    'mammoth',
    'gallimimus',
    'megalodon',
    'tullimonstrum',
    'phorusrhacos',
    'maiasaura',
    'sauropelta',
    'allosaurus-pandras',
    'meganeura',
    'sordes',
    'dilophosaurus',
    'dimetrodon',
    'mosasaurus',
    'spinosaurus',
    'quetzalcoatlus',
    'xiphactinus',
    'lystrosaurus',
    'baryonyx',
    'ammonite',
    'dallasaurus',
    'archaeopteryx',
    'carnotaurus',
    'styxosaurus',
    'anomalocaris',
    'dakosaurus',
  ],
  defaultAnimalId: 'stegosaurus',
  loop: true,
} satisfies AnimalCollection

export function wrapCollectionIndex(index: number, length: number): number {
  if (!Number.isInteger(index)) {
    throw new Error('集合索引必须是整数。')
  }
  if (!Number.isInteger(length) || length < 1) {
    throw new Error('集合必须至少包含一个动物。')
  }

  return ((index % length) + length) % length
}

export function stepCollection(
  collection: AnimalCollection,
  currentAnimalId: string,
  offset: number,
): string {
  if (!Number.isInteger(offset)) {
    throw new Error('集合移动量必须是整数。')
  }

  const currentIndex = collection.animalIds.indexOf(currentAnimalId)
  if (currentIndex === -1) {
    throw new Error(`动物 “${currentAnimalId}” 不在集合 “${collection.id}” 中。`)
  }

  const requestedIndex = currentIndex + offset
  const nextIndex = collection.loop
    ? wrapCollectionIndex(requestedIndex, collection.animalIds.length)
    : Math.max(0, Math.min(requestedIndex, collection.animalIds.length - 1))

  const nextAnimalId = collection.animalIds[nextIndex]
  if (!nextAnimalId) {
    throw new Error(`集合 “${collection.id}” 无法解析索引 ${nextIndex}。`)
  }

  return nextAnimalId
}

export function previousAnimalId(
  collection: AnimalCollection,
  currentAnimalId: string,
): string {
  return stepCollection(collection, currentAnimalId, -1)
}

export function nextAnimalId(
  collection: AnimalCollection,
  currentAnimalId: string,
): string {
  return stepCollection(collection, currentAnimalId, 1)
}
