/** The Vietnam pack: the city the office stands in, and the office's own day. */
export const VN_PACK = Object.freeze({
  id: 'vn',
  city: 'TP. Hồ Chí Minh',
  officeHours: { open: 7, close: 21 },
  officeLife: {
    nap: [720, 780],
    coffee: [780, 810],
    yawn: [900, 915],
    dessert: { dow: 5, at: 960, stayMin: 10 },
  },
} as const)
