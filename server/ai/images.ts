// Curated photo library the model may use (docs/SPEC.md §15.4). Every id is checked by scripts/check-images.mjs.
// URL form: https://images.unsplash.com/<id>?auto=format&fit=crop&w=<width>&q=80

export interface CatalogImage {
  id: string;
  topic: string;
  description: string;
}

export const IMAGE_CATALOG: CatalogImage[] = [
  // food & drink
  { id: 'photo-1495474472287-4d71bcdd2085', topic: 'food', description: 'coffee cup on wooden table' },
  { id: 'photo-1509042239860-f550ce710b93', topic: 'food', description: 'latte art in a cafe' },
  { id: 'photo-1504674900247-0877df9cc836', topic: 'food', description: 'colorful plated dish from above' },
  { id: 'photo-1414235077428-338989a2e8c0', topic: 'food', description: 'fine dining restaurant table' },
  { id: 'photo-1517248135467-4c7edcad34c4', topic: 'food', description: 'modern restaurant interior' },
  { id: 'photo-1555396273-367ea4eb4db5', topic: 'food', description: 'cozy restaurant terrace' },
  // office, SaaS, tech
  { id: 'photo-1498050108023-c5249f4df085', topic: 'tech', description: 'laptop with code on a desk' },
  { id: 'photo-1461749280684-dccba630e2f6', topic: 'tech', description: 'source code on a monitor' },
  { id: 'photo-1519389950473-47ba0277781c', topic: 'tech', description: 'team working on laptops' },
  { id: 'photo-1460925895917-afdab827c52f', topic: 'tech', description: 'analytics dashboard on a laptop' },
  { id: 'photo-1551288049-bebda4e38f71', topic: 'tech', description: 'charts and data dashboard' },
  { id: 'photo-1522071820081-009f0129c71c', topic: 'business', description: 'team collaborating around a table' },
  { id: 'photo-1551434678-e076c223a692', topic: 'business', description: 'open office with people working' },
  { id: 'photo-1497366216548-37526070297c', topic: 'business', description: 'bright modern office space' },
  { id: 'photo-1556761175-5973dc0f32e7', topic: 'business', description: 'business meeting' },
  { id: 'photo-1454165804606-c3d57bc86b40', topic: 'business', description: 'desk with documents and laptop' },
  // people
  { id: 'photo-1494790108377-be9c29b29330', topic: 'people', description: 'smiling woman portrait' },
  { id: 'photo-1507003211169-0a1dd7228f2d', topic: 'people', description: 'man portrait' },
  { id: 'photo-1438761681033-6461ffad8d80', topic: 'people', description: 'woman portrait close-up' },
  { id: 'photo-1500648767791-00dcc994a43e', topic: 'people', description: 'man portrait close-up' },
  { id: 'photo-1534528741775-53994a69daeb', topic: 'people', description: 'woman portrait, studio light' },
  { id: 'photo-1472099645785-5658abf4ff4e', topic: 'people', description: 'man in a blazer portrait' },
  // fitness & health
  { id: 'photo-1517836357463-d25dfeac3438', topic: 'fitness', description: 'weights in a gym' },
  { id: 'photo-1534438327276-14e5300c3a48', topic: 'fitness', description: 'gym interior with equipment' },
  { id: 'photo-1571019613454-1cb2f99b2d8b', topic: 'fitness', description: 'person training' },
  { id: 'photo-1506126613408-eca07ce68773', topic: 'fitness', description: 'yoga at sunrise' },
  { id: 'photo-1576091160399-112ba8d25d1d', topic: 'health', description: 'doctor with a tablet' },
  { id: 'photo-1505751172876-fa1923c5c528', topic: 'health', description: 'stethoscope, medical' },
  // travel & nature
  { id: 'photo-1506905925346-21bda4d32df4', topic: 'nature', description: 'mountain peaks above clouds' },
  { id: 'photo-1469474968028-56623f02e42e', topic: 'nature', description: 'sunlit valley landscape' },
  { id: 'photo-1501785888041-af3ef285b470', topic: 'nature', description: 'lake with mountains' },
  { id: 'photo-1507525428034-b723cf961d3e', topic: 'travel', description: 'tropical beach' },
  { id: 'photo-1476514525535-07fb3b4ae5f1', topic: 'travel', description: 'boat on a mountain lake' },
  { id: 'photo-1488646953014-85cb44e25828', topic: 'travel', description: 'travel planning with map' },
  // city & architecture
  { id: 'photo-1449824913935-59a10b8d2000', topic: 'city', description: 'city street with buildings' },
  { id: 'photo-1480714378408-67cf0d13bc1b', topic: 'city', description: 'city skyline at dusk' },
  { id: 'photo-1486406146926-c627a92ad1ab', topic: 'city', description: 'glass office towers' },
  // education
  { id: 'photo-1503676260728-1c00da094a0b', topic: 'education', description: 'student writing in a notebook' },
  { id: 'photo-1524178232363-1fb2b075b655', topic: 'education', description: 'classroom lecture' },
  { id: 'photo-1481627834876-b7833e8f5570', topic: 'education', description: 'library bookshelves' },
  // shopping & products
  { id: 'photo-1441986300917-64674bd600d8', topic: 'shopping', description: 'clothing store interior' },
  { id: 'photo-1483985988355-763728e1935b', topic: 'shopping', description: 'woman with shopping bags' },
  { id: 'photo-1445205170230-053b83016050', topic: 'shopping', description: 'fashion clothes on a rack' },
  { id: 'photo-1523275335684-37898b6baf30', topic: 'product', description: 'minimal watch product shot' },
  { id: 'photo-1542291026-7eec264c27ff', topic: 'product', description: 'red sneaker product shot' },
  { id: 'photo-1505740420928-5e560c06d30e', topic: 'product', description: 'headphones product shot' },
  // real estate & interiors
  { id: 'photo-1512917774080-9991f1c4c750', topic: 'real-estate', description: 'modern villa exterior' },
  { id: 'photo-1600596542815-ffad4c1539a9', topic: 'real-estate', description: 'family house with lawn' },
  { id: 'photo-1564013799919-ab600027ffc6', topic: 'real-estate', description: 'house exterior at dusk' },
  { id: 'photo-1502672260266-1c1ef2d93688', topic: 'real-estate', description: 'bright apartment living room' },
  { id: 'photo-1560448204-e02f11c3d0e2', topic: 'real-estate', description: 'stylish interior living room' },
  // cars
  { id: 'photo-1492144534655-ae79c964c9d7', topic: 'cars', description: 'sports car on a road' },
  { id: 'photo-1511919884226-fd3cad34687c', topic: 'cars', description: 'classic car detail' },
  // abstract backgrounds
  { id: 'photo-1557683316-973673baf926', topic: 'abstract', description: 'purple-blue gradient' },
  { id: 'photo-1579546929518-9e396f3cc809', topic: 'abstract', description: 'colorful soft gradient' },
  { id: 'photo-1558591710-4b4a1ae0f04d', topic: 'abstract', description: 'abstract paint texture' },
  { id: 'photo-1618005182384-a83a8bd57fbe', topic: 'abstract', description: 'abstract 3D shapes' },
];

export function imageUrl(id: string, width = 1200): string {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=80`;
}

/** Rendered into the system prompt. */
export function imageLibraryPrompt(): string {
  const byTopic = new Map<string, CatalogImage[]>();
  for (const image of IMAGE_CATALOG) {
    const list = byTopic.get(image.topic) ?? [];
    list.push(image);
    byTopic.set(image.topic, list);
  }
  const lines: string[] = [];
  for (const [topic, images] of byTopic) {
    lines.push(`${topic}:`);
    for (const image of images) lines.push(`  ${image.id} — ${image.description}`);
  }
  return lines.join('\n');
}
