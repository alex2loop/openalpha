/** What the office's art is drawn from or reads, each with its licence and a link. */
export interface SourceCredit {
  readonly name: string
  readonly licence: string
  readonly url: string
}

export const OPENSTREETMAP_CREDIT: SourceCredit = {
  name: '© OpenStreetMap contributors',
  licence: 'ODbL',
  url: 'https://www.openstreetmap.org/copyright',
}

export const OPEN_METEO_CREDIT: SourceCredit = {
  name: 'Open-Meteo.com',
  licence: 'CC BY 4.0',
  url: 'https://open-meteo.com/',
}

export const LUCIDE_CREDIT: SourceCredit = {
  name: 'Lucide',
  licence: 'ISC',
  url: 'https://lucide.dev',
}

/** One photographer's Wikimedia Commons photos, by Commons page id; used as drawing references,
 *  none ships. */
interface PhotoCredit {
  readonly author: string
  readonly licence: string
  readonly pages: readonly number[]
}

export function commonsPageUrl(pageId: number): string {
  return `https://commons.wikimedia.org/?curid=${pageId}`
}

export const PHOTO_CREDITS: readonly PhotoCredit[] = [
  { author: 'Adam Jones', licence: 'CC BY 2.0', pages: [134067021] },
  { author: 'Andy C', licence: 'CC BY-SA 3.0', pages: [8658063] },
  { author: 'Biodin', licence: 'CC BY-SA 3.0', pages: [28802643] },
  { author: 'Busition', licence: 'CC BY 4.0', pages: [176158761] },
  { author: 'CaptJayRuffins', licence: 'CC BY-SA 4.0', pages: [73653399] },
  { author: 'David Ackerman', licence: 'CC BY 2.0', pages: [139613687] },
  { author: 'David McKelvey', licence: 'CC BY 2.0', pages: [105760704] },
  { author: 'Diego Delso', licence: 'CC BY-SA 3.0', pages: [30089027, 30089036] },
  { author: 'Dietmar Rabich', licence: 'CC BY-SA 4.0', pages: [30454359, 125644831] },
  { author: 'Duyenphan0298', licence: 'CC BY-SA 4.0', pages: [106354584] },
  { author: 'Elvert Barnes', licence: 'CC BY-SA 2.0', pages: [20214454] },
  { author: 'Epicgenius', licence: 'CC BY-SA 4.0', pages: [86742880] },
  { author: 'Gary Todd', licence: 'CC0', pages: [108935342] },
  { author: 'Gigi alt', licence: 'CC BY-SA 3.0', pages: [21845395] },
  { author: 'Giorgio Galeotti', licence: 'CC BY 4.0', pages: [50934532] },
  { author: 'GV', licence: 'CC BY-SA 3.0', pages: [93905450] },
  { author: 'hijirin', licence: 'CC BY 3.0', pages: [53460841] },
  { author: 'Hisi21', licence: 'CC BY-SA 3.0', pages: [31493151] },
  { author: 'Jean-Etienne Minh-Duy Poirrier', licence: 'CC BY-SA 2.0', pages: [127208456] },
  { author: 'Jean-Marie Hullot', licence: 'CC BY 3.0', pages: [34592371] },
  { author: 'Jim.henderson', licence: 'CC BY 4.0', pages: [100093134] },
  { author: 'Jim.henderson', licence: 'CC BY-SA 4.0', pages: [86879200] },
  { author: 'Jim.henderson', licence: 'Public domain', pages: [12475969] },
  { author: 'Ken Lund', licence: 'CC BY-SA 2.0', pages: [84810017] },
  { author: 'King of Hearts', licence: 'CC BY-SA 3.0', pages: [21073689] },
  { author: 'Lu The Vy', licence: 'CC0', pages: [122475757] },
  { author: 'Marc Mongenet', licence: 'CC BY-SA 4.0', pages: [192255173] },
  { author: 'Martin Furtschegger', licence: 'CC BY 3.0', pages: [54823056] },
  {
    author: 'Metropolitan Transportation Authority of the State of New York',
    licence: 'CC BY 2.0',
    pages: [33086217],
  },
  { author: 'Mkoff', licence: 'CC BY-SA 4.0', pages: [48705102, 200427125] },
  { author: 'Nick-philly', licence: 'CC BY-SA 4.0', pages: [84618900] },
  { author: 'Phương Huy', licence: 'CC0', pages: [147525102, 147157032] },
  { author: 'RG72', licence: 'CC BY-SA 4.0', pages: [98773046, 98861245, 98670489, 98670910] },
  { author: 'Rudolph.A.Furtado', licence: 'CC0', pages: [30723703] },
  { author: 'stanislav baranov', licence: 'CC BY-SA 2.0', pages: [139727705] },
  { author: 'Steffen Schmitz', licence: 'CC BY-SA 4.0', pages: [88858180] },
  { author: 'Syced', licence: 'CC0', pages: [134022463] },
  { author: 'Timback', licence: 'CC BY-SA 4.0', pages: [86375078] },
  { author: 'Tri Nguyen', licence: 'CC BY 2.0', pages: [29738457, 127208419, 127208428] },
  {
    author: 'trungydang',
    licence: 'CC BY 3.0',
    pages: [58727100, 58812039, 57962449, 58914895, 56705865, 57666463, 56918694],
  },
  { author: '源義信', licence: 'CC BY 4.0', pages: [143674772] },
]
